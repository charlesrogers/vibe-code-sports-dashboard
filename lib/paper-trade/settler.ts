/**
 * Paper Trade Settler — Settle pending bets using football-data-cache results
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { loadLedger, saveLedger } from "./storage";
import type { PaperBet } from "./types";

const dataDir = join(process.cwd(), "data", "football-data-cache");

function loadResults(league: string): Map<string, { homeGoals: number; awayGoals: number; pinnClose1X2?: any }> {
  const results = new Map<string, any>();
  // Try current and recent seasons
  for (const season of ["2025-26", "2024-25"]) {
    const fp = join(dataDir, `${league}-${season}.json`);
    if (!existsSync(fp)) continue;
    try {
      const data = JSON.parse(readFileSync(fp, "utf-8"));
      for (const m of (data.matches || [])) {
        if (m.homeGoals == null) continue;
        const key = `${m.date}_${m.homeTeam}_${m.awayTeam}`;
        results.set(key, {
          homeGoals: m.homeGoals,
          awayGoals: m.awayGoals,
          pinnacleCloseHome: m.pinnacleCloseHome,
          pinnacleCloseDraw: m.pinnacleCloseDraw,
          pinnacleCloseAway: m.pinnacleCloseAway,
        });
      }
    } catch { continue; }
  }
  return results;
}

export async function settlePendingBets(): Promise<{ settled: number; results: { id: string; status: string; profit: number }[] }> {
  const ledger = await loadLedger();
  const today = new Date().toISOString().split("T")[0];

  const pending = ledger.bets.filter(b => b.status === "pending" && b.matchDate < today);
  if (pending.length === 0) return { settled: 0, results: [] };

  // Load results for each league
  const leagueResults = new Map<string, Map<string, any>>();
  for (const bet of pending) {
    if (!leagueResults.has(bet.league)) {
      leagueResults.set(bet.league, loadResults(bet.league));
    }
  }

  const settledResults: { id: string; status: string; profit: number }[] = [];

  for (const bet of pending) {
    const results = leagueResults.get(bet.league);
    if (!results) continue;

    const key = `${bet.matchDate}_${bet.homeTeam}_${bet.awayTeam}`;
    const result = results.get(key);
    if (!result) continue; // result not available yet

    bet.homeGoals = result.homeGoals;
    bet.awayGoals = result.awayGoals;
    bet.settledAt = new Date().toISOString();

    // Use executionOdds (post-slippage) for settlement; fall back to marketOdds for old bets
    const odds = bet.executionOdds || bet.marketOdds;
    const stake = bet.stake || 10;

    // Determine outcome — profit in dollars
    if (bet.marketType === "1X2") {
      const actual = result.homeGoals > result.awayGoals ? "Home"
        : result.awayGoals > result.homeGoals ? "Away" : "Draw";
      bet.status = bet.selection === actual ? "won" : "lost";
      bet.profit = bet.status === "won"
        ? Math.round(stake * (odds - 1) * 100) / 100
        : -stake;
    } else if (bet.marketType === "AH") {
      // Asian Handicap settlement
      // selection format: "Home -0.5", "Away +1.0", etc.
      const parts = bet.selection.match(/^(Home|Away)\s+([+-]?\d+\.?\d*)$/);
      if (parts) {
        const side = parts[1];
        const line = parseFloat(parts[2]);
        const goalDiff = result.homeGoals - result.awayGoals;
        const adjDiff = side === "Home" ? goalDiff + line : -goalDiff + line;

        if (adjDiff > 0.25) {
          bet.status = "won";
          bet.profit = Math.round(stake * (odds - 1) * 100) / 100;
        } else if (adjDiff === 0.25) {
          bet.status = "won";
          bet.profit = Math.round(stake * (odds - 1) * 0.5 * 100) / 100;
        } else if (adjDiff === 0) {
          bet.status = "push";
          bet.profit = 0;
        } else if (adjDiff === -0.25) {
          bet.status = "lost";
          bet.profit = Math.round(-stake * 0.5 * 100) / 100;
        } else {
          bet.status = "lost";
          bet.profit = -stake;
        }
      }
    }

    // Compute CLV from closing odds
    if (result.pinnacleCloseHome && result.pinnacleCloseDraw && result.pinnacleCloseAway) {
      const closeMap: Record<string, number> = {
        Home: result.pinnacleCloseHome,
        Draw: result.pinnacleCloseDraw,
        Away: result.pinnacleCloseAway,
      };
      const closeOdds = closeMap[bet.selection];
      if (closeOdds) {
        bet.closingOdds = closeOdds;
        const closingImplied = 1 / closeOdds;
        const pickImplied = 1 / bet.marketOdds;
        bet.clv = closingImplied - pickImplied; // positive = beat the close
      }
    }

    settledResults.push({ id: bet.id, status: bet.status, profit: bet.profit || 0 });
  }

  if (settledResults.length > 0) await saveLedger(ledger);
  return { settled: settledResults.length, results: settledResults };
}
