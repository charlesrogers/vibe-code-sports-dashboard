import { NextRequest, NextResponse } from "next/server";
import { fetchMatchesWithOdds, findValueBets, type MatchWithOdds, type ValueBet } from "@/lib/football-data-uk";
import { fetchOpenFootballMatches } from "@/lib/openfootball";
import { fitDixonColes, predictMatch } from "@/lib/models/dixon-coles";
import { derive1X2, deriveOverUnder } from "@/lib/betting/markets";
import { DixonColesParams } from "@/lib/types";

let cachedParams: DixonColesParams | null = null;
let lastFit = 0;

async function getParams(): Promise<DixonColesParams> {
  if (cachedParams && Date.now() - lastFit < 3600000) return cachedParams;
  const matches = await fetchOpenFootballMatches();
  cachedParams = fitDixonColes(matches);
  lastFit = Date.now();
  return cachedParams;
}

export async function GET(request: NextRequest) {
  const season = request.nextUrl.searchParams.get("season") || "2024-25";
  const minEdge = parseFloat(request.nextUrl.searchParams.get("minEdge") || "0.03");

  try {
    const [params, oddsMatches] = await Promise.all([
      getParams(),
      fetchMatchesWithOdds(season),
    ]);

    const valueBets: ValueBet[] = [];

    for (const m of oddsMatches) {
      // Check if both teams exist in model
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

      // Determine actual result for backtesting
      for (const bet of bets) {
        bet.date = m.date;
        bet.homeTeam = m.homeTeam;
        bet.awayTeam = m.awayTeam;

        // Check if bet would have won
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

    // Calculate P&L summary
    const settled = valueBets.filter((b) => b.result);
    const wins = settled.filter((b) => b.result === "W");
    const totalStaked = settled.length;
    const totalReturn = wins.reduce((s, b) => s + b.marketOdds, 0);
    const roi = totalStaked > 0 ? ((totalReturn - totalStaked) / totalStaked) * 100 : 0;

    return NextResponse.json({
      season,
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
