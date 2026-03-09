import { NextRequest, NextResponse } from "next/server";
import { fetchMatchesWithOdds, findValueBets, type ValueBet, type League as UKLeague } from "@/lib/football-data-uk";
import { fetchOpenFootballMatches, type League } from "@/lib/openfootball";
import { fitDixonColes, predictMatch } from "@/lib/models/dixon-coles";
import { derive1X2, deriveOverUnder } from "@/lib/betting/markets";
import { DixonColesParams } from "@/lib/types";

const paramCache = new Map<string, { params: DixonColesParams; time: number }>();

async function getParams(season: string, league: League): Promise<DixonColesParams> {
  const key = `${league}:${season}`;
  const cached = paramCache.get(key);
  if (cached && Date.now() - cached.time < 3600000) return cached.params;
  const seasons = [season];
  const prev = getPriorSeason(season);
  if (prev) seasons.push(prev);
  const matches = await fetchOpenFootballMatches(seasons, league);
  const params = fitDixonColes(matches);
  paramCache.set(key, { params, time: Date.now() });
  return params;
}

function getPriorSeason(s: string): string | null {
  const map: Record<string, string> = {
    "2025-26": "2024-25", "2024-25": "2023-24", "2023-24": "2022-23",
    "2022-23": "2021-22", "2021-22": "2020-21", "2020-21": "2019-20",
  };
  return map[s] || null;
}

export async function GET(request: NextRequest) {
  const season = request.nextUrl.searchParams.get("season") || "2025-26";
  const league = (request.nextUrl.searchParams.get("league") || "serieA") as League;
  const minEdge = parseFloat(request.nextUrl.searchParams.get("minEdge") || "0.03");

  try {
    const [params, oddsMatches] = await Promise.all([
      getParams(season, league),
      fetchMatchesWithOdds(season, league as UKLeague),
    ]);

    const valueBets: ValueBet[] = [];

    for (const m of oddsMatches) {
      if (!(m.homeTeam in params.attack) || !(m.awayTeam in params.attack)) continue;

      const grid = predictMatch(m.homeTeam, m.awayTeam, params);
      const probs1X2 = derive1X2(grid);
      const ou25 = deriveOverUnder(grid, 2.5);

      const modelProbs = {
        home: probs1X2.home,
        draw: probs1X2.draw,
        away: probs1X2.away,
        over25: ou25.over,
        under25: ou25.under,
      };

      const bets = findValueBets(modelProbs, m, minEdge);

      for (const bet of bets) {
        bet.date = m.date;
        bet.homeTeam = m.homeTeam;
        bet.awayTeam = m.awayTeam;

        if (m.result) {
          const totalGoals = m.homeGoals + m.awayGoals;
          if (bet.market === "Home") bet.result = m.result === "H" ? "W" : "L";
          else if (bet.market === "Draw") bet.result = m.result === "D" ? "W" : "L";
          else if (bet.market === "Away") bet.result = m.result === "A" ? "W" : "L";
          else if (bet.market === "Over 2.5") bet.result = totalGoals > 2.5 ? "W" : "L";
          else if (bet.market === "Under 2.5") bet.result = totalGoals < 2.5 ? "W" : "L";
        }
      }

      valueBets.push(...bets);
    }

    const settled = valueBets.filter((b) => b.result);
    const wins = settled.filter((b) => b.result === "W");
    const totalStaked = settled.length;
    const totalReturn = wins.reduce((s, b) => s + b.marketOdds, 0);
    const roi = totalStaked > 0 ? ((totalReturn - totalStaked) / totalStaked) * 100 : 0;

    return NextResponse.json({
      season,
      league,
      minEdge,
      valueBets: valueBets.sort((a, b) => b.edge - a.edge),
      summary: {
        totalBets: valueBets.length,
        settledBets: settled.length,
        wins: wins.length,
        losses: settled.length - wins.length,
        hitRate: settled.length > 0 ? Math.round((wins.length / settled.length) * 1000) / 10 : 0,
        roi: Math.round(roi * 10) / 10,
        avgEdge: valueBets.length > 0
          ? Math.round((valueBets.reduce((s, b) => s + b.edge, 0) / valueBets.length) * 1000) / 10
          : 0,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
