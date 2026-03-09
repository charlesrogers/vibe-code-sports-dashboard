import { NextRequest, NextResponse } from "next/server";
import { fetchOpenFootballMatches, fetchUpcomingFixtures, type League } from "@/lib/openfootball";
import { fitDixonColes, predictMatch } from "@/lib/models/dixon-coles";
import { derive1X2, deriveOverUnder, deriveBTTS } from "@/lib/betting/markets";
import { calculateEloRatings } from "@/lib/models/elo";
import { DixonColesParams } from "@/lib/types";

const modelCache = new Map<string, { params: DixonColesParams; eloMap: Map<string, number>; time: number }>();

async function getModel(league: League) {
  const cached = modelCache.get(league);
  if (cached && Date.now() - cached.time < 3600000) return cached;
  const seasons = league === "serieB" ? ["2025-26", "2024-25"] : ["2025-26", "2024-25"];
  const matches = await fetchOpenFootballMatches(seasons, league);
  const params = fitDixonColes(matches);
  const elo = calculateEloRatings(matches);
  const eloMap = new Map(elo.map((e) => [e.team, e.rating]));
  const result = { params, eloMap, time: Date.now() };
  modelCache.set(league, result);
  return result;
}

export async function GET(request: NextRequest) {
  const league = (request.nextUrl.searchParams.get("league") || "serieA") as League;

  try {
    const [model, fixtures] = await Promise.all([
      getModel(league),
      fetchUpcomingFixtures("2025-26", league),
    ]);

    const { params, eloMap } = model;

    const predictions = fixtures
      .filter((f) => f.homeTeam in params.attack && f.awayTeam in params.attack)
      .map((f) => {
        const grid = predictMatch(f.homeTeam, f.awayTeam, params);
        const probs = derive1X2(grid);
        const ou25 = deriveOverUnder(grid, 2.5);
        const ou15 = deriveOverUnder(grid, 1.5);
        const ou35 = deriveOverUnder(grid, 3.5);
        const btts = deriveBTTS(grid);

        let expHome = 0, expAway = 0;
        for (let h = 0; h < grid.length; h++) {
          for (let a = 0; a < grid[h].length; a++) {
            expHome += h * grid[h][a];
            expAway += a * grid[h][a];
          }
        }

        const fairOdds = (p: number) => p > 0.01 ? Math.round((1 / p) * 100) / 100 : 99;

        return {
          date: f.date,
          round: f.round,
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          homeElo: eloMap.get(f.homeTeam) || 1500,
          awayElo: eloMap.get(f.awayTeam) || 1500,
          expHome: Math.round(expHome * 100) / 100,
          expAway: Math.round(expAway * 100) / 100,
          probs: {
            home: Math.round(probs.home * 1000) / 10,
            draw: Math.round(probs.draw * 1000) / 10,
            away: Math.round(probs.away * 1000) / 10,
          },
          fairOdds: {
            home: fairOdds(probs.home),
            draw: fairOdds(probs.draw),
            away: fairOdds(probs.away),
          },
          over15: Math.round(ou15.over * 1000) / 10,
          over25: Math.round(ou25.over * 1000) / 10,
          over35: Math.round(ou35.over * 1000) / 10,
          bttsYes: Math.round(btts.yes * 1000) / 10,
        };
      });

    const byRound: Record<number, typeof predictions> = {};
    for (const p of predictions) {
      const r = p.round || 0;
      if (!byRound[r]) byRound[r] = [];
      byRound[r].push(p);
    }

    return NextResponse.json({
      league,
      fixtures: predictions,
      byRound,
      totalFixtures: predictions.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
