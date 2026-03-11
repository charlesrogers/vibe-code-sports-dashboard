/**
 * Paper Trade Logger — Creates PaperBet records from MI picks
 */

import { generatePicks } from "../mi-picks/picks-engine";
import { appendBets } from "./storage";
import type { PaperBet } from "./types";

export async function logPicks(leagues?: string[]): Promise<{ added: number; skipped: number }> {
  const { picks } = await generatePicks(leagues);
  const betPicks = picks.filter(p => p.tedVerdict === "BET");

  const newBets: PaperBet[] = [];

  for (const pick of betPicks) {
    for (const vb of pick.valueBets) {
      const id = `${pick.date}_${pick.homeTeam}_vs_${pick.awayTeam}_${vb.marketType}_${vb.selection}`.replace(/\s+/g, "_");

      newBets.push({
        id,
        createdAt: new Date().toISOString(),
        matchDate: pick.date,
        league: pick.league,
        homeTeam: pick.homeTeam,
        awayTeam: pick.awayTeam,
        marketType: vb.marketType,
        selection: vb.selection,
        ...(vb.ahLine != null && { ahLine: vb.ahLine }),
        stake: 1,
        modelProb: vb.modelProb,
        marketOdds: vb.marketOdds,
        edge: vb.edge,
        confidenceGrade: pick.grade,
        status: "pending",
      });
    }
  }

  return appendBets(newBets);
}
