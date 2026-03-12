/**
 * Paper Trade Settler — Settle pending bets using match results + Pinnacle closing odds
 *
 * Data sources (in priority order):
 * 1. Local football-data-cache JSON (has pinnacleCloseHome etc. from bulk-download-odds.mjs)
 * 2. Live fetch from football-data.co.uk CSV (PSH/PSD/PSA = Pinnacle odds at kickoff)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { loadLedger, saveLedger } from "./storage";
import type { PaperBet } from "./types";
import { fetchMatchesWithOdds, type League } from "../football-data-uk";

const dataDir = join(process.cwd(), "data", "football-data-cache");

/** Map paper-trade league IDs to football-data.co.uk league keys */
const LEAGUE_MAP: Record<string, League> = {
  epl: "epl",
  "la-liga": "la-liga",
  "serie-a": "serie-a",
  bundesliga: "bundesliga",
  championship: "championship",
};

interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  pinnacleCloseHome: number;
  pinnacleCloseDraw: number;
  pinnacleCloseAway: number;
  pinnacleCloseOver25: number;
  pinnacleCloseUnder25: number;
}

/** Load results from local cache */
function loadCacheResults(league: string): Map<string, MatchResult> {
  const results = new Map<string, MatchResult>();
  for (const season of ["2025-26", "2024-25"]) {
    const fp = join(dataDir, `${league}-${season}.json`);
    if (!existsSync(fp)) continue;
    try {
      const data = JSON.parse(readFileSync(fp, "utf-8"));
      for (const m of data.matches || []) {
        if (m.homeGoals == null) continue;
        const key = `${m.date}_${m.homeTeam}_${m.awayTeam}`;
        results.set(key, {
          homeGoals: m.homeGoals,
          awayGoals: m.awayGoals,
          pinnacleCloseHome: m.pinnacleCloseHome || 0,
          pinnacleCloseDraw: m.pinnacleCloseDraw || 0,
          pinnacleCloseAway: m.pinnacleCloseAway || 0,
          pinnacleCloseOver25: m.pinnacleCloseOver25 || 0,
          pinnacleCloseUnder25: m.pinnacleCloseUnder25 || 0,
        });
      }
    } catch { continue; }
  }
  return results;
}

/** Fetch fresh results from football-data.co.uk CSV — includes Pinnacle closing odds */
async function fetchFreshResults(league: string): Promise<Map<string, MatchResult>> {
  const results = new Map<string, MatchResult>();
  const fdLeague = LEAGUE_MAP[league];
  if (!fdLeague) return results;

  for (const season of ["2025-26", "2024-25"]) {
    try {
      const matches = await fetchMatchesWithOdds(season, fdLeague);
      console.log(`[settler] Fetched ${matches.length} matches from football-data.co.uk: ${league} ${season}`);
      for (const m of matches) {
        if (m.homeGoals == null) continue;
        const key = `${m.date}_${m.homeTeam}_${m.awayTeam}`;
        results.set(key, {
          homeGoals: m.homeGoals,
          awayGoals: m.awayGoals,
          pinnacleCloseHome: m.pinnacleCloseHome || 0,
          pinnacleCloseDraw: m.pinnacleCloseDraw || 0,
          pinnacleCloseAway: m.pinnacleCloseAway || 0,
          pinnacleCloseOver25: m.pinnacleCloseOver25 || 0,
          pinnacleCloseUnder25: m.pinnacleCloseUnder25 || 0,
        });
      }
    } catch (e) {
      console.warn(`[settler] Failed to fetch fresh data for ${league} ${season}:`, e);
    }
  }
  return results;
}

/** Load results: try cache first, then live fetch to fill gaps */
async function loadResults(league: string): Promise<Map<string, MatchResult>> {
  const cache = loadCacheResults(league);

  // Check if cache has closing odds for any match
  let hasCacheCloseOdds = false;
  for (const [, r] of cache) {
    if (r.pinnacleCloseHome > 0) { hasCacheCloseOdds = true; break; }
  }

  if (hasCacheCloseOdds) return cache;

  // Cache lacks closing odds — fetch fresh from football-data.co.uk
  console.log(`[settler] Cache missing closing odds for ${league}, fetching fresh data...`);
  const fresh = await fetchFreshResults(league);

  // Merge: cache results + fresh closing odds
  for (const [key, freshResult] of fresh) {
    const cached = cache.get(key);
    if (cached) {
      // Overlay closing odds from fresh fetch onto cache results
      if (freshResult.pinnacleCloseHome > 0) {
        cached.pinnacleCloseHome = freshResult.pinnacleCloseHome;
        cached.pinnacleCloseDraw = freshResult.pinnacleCloseDraw;
        cached.pinnacleCloseAway = freshResult.pinnacleCloseAway;
        cached.pinnacleCloseOver25 = freshResult.pinnacleCloseOver25;
        cached.pinnacleCloseUnder25 = freshResult.pinnacleCloseUnder25;
      }
    } else {
      cache.set(key, freshResult);
    }
  }

  return cache;
}

/** Extract 1X2 selection from AH selection (e.g. "Home -0.5" → "Home") */
function ahSide(selection: string): string {
  const m = selection.match(/^(Home|Away)/);
  return m ? m[1] : "";
}

export async function settlePendingBets(): Promise<{ settled: number; results: { id: string; status: string; profit: number }[] }> {
  const ledger = await loadLedger();
  const today = new Date().toISOString().split("T")[0];

  const pending = ledger.bets.filter(b => b.status === "pending" && b.matchDate < today);
  if (pending.length === 0) return { settled: 0, results: [] };

  console.log(`[settler] Settling ${pending.length} pending bets...`);

  // Load results for each league (with fresh fetch fallback)
  const leagueResults = new Map<string, Map<string, MatchResult>>();
  const leaguesNeeded = [...new Set(pending.map(b => b.league))];
  for (const league of leaguesNeeded) {
    leagueResults.set(league, await loadResults(league));
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
    const stake = bet.stake || 20;

    // ─── Determine outcome ────────────────────────────────────────────────
    if (bet.marketType === "1X2") {
      const actual = result.homeGoals > result.awayGoals ? "Home"
        : result.awayGoals > result.homeGoals ? "Away" : "Draw";
      bet.status = bet.selection === actual ? "won" : "lost";
      bet.profit = bet.status === "won"
        ? Math.round(stake * (odds - 1) * 100) / 100
        : -stake;
    } else if (bet.marketType === "AH") {
      // Asian Handicap settlement — selection format: "Home -0.5", "Away +1.0"
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
    } else if (bet.marketType === "OU25") {
      const totalGoals = result.homeGoals + result.awayGoals;
      if (bet.selection === "Over 2.5") {
        bet.status = totalGoals > 2.5 ? "won" : "lost";
      } else {
        bet.status = totalGoals < 2.5 ? "won" : "lost";
      }
      bet.profit = bet.status === "won"
        ? Math.round(stake * (odds - 1) * 100) / 100
        : -stake;
    }

    // ─── Compute CLV from Pinnacle closing odds ──────────────────────────
    if (bet.marketType === "1X2") {
      // Direct 1X2 closing odds
      if (result.pinnacleCloseHome > 0 && result.pinnacleCloseDraw > 0 && result.pinnacleCloseAway > 0) {
        const closeMap: Record<string, number> = {
          Home: result.pinnacleCloseHome,
          Draw: result.pinnacleCloseDraw,
          Away: result.pinnacleCloseAway,
        };
        const closeOdds = closeMap[bet.selection];
        if (closeOdds) {
          bet.closingOdds = closeOdds;
          bet.clv = (1 / closeOdds) - (1 / bet.marketOdds); // positive = beat the close
        }
      }
    } else if (bet.marketType === "AH") {
      // AH CLV: derive from 1X2 closing odds as approximate
      // If the AH side is "Home", use pinnacleCloseHome implied probability
      // This is directionally correct — if close moved toward Home, AH Home close also moved
      if (result.pinnacleCloseHome > 0 && result.pinnacleCloseAway > 0) {
        const side = ahSide(bet.selection);
        const close1X2 = side === "Home" ? result.pinnacleCloseHome : result.pinnacleCloseAway;
        if (close1X2 > 0) {
          // Use 1X2 implied as proxy for AH direction
          const closeImplied = 1 / close1X2;
          const pickImplied = 1 / bet.marketOdds;
          bet.clv = closeImplied - pickImplied;
          // Don't set closingOdds for AH since it's an approximation
        }
      }
    } else if (bet.marketType === "OU25") {
      // O/U 2.5 closing odds
      if (result.pinnacleCloseOver25 > 0 && result.pinnacleCloseUnder25 > 0) {
        const closeOdds = bet.selection === "Over 2.5"
          ? result.pinnacleCloseOver25
          : result.pinnacleCloseUnder25;
        if (closeOdds > 0) {
          bet.closingOdds = closeOdds;
          bet.clv = (1 / closeOdds) - (1 / bet.marketOdds);
        }
      }
    }

    settledResults.push({ id: bet.id, status: bet.status, profit: bet.profit || 0 });
  }

  if (settledResults.length > 0) {
    await saveLedger(ledger);
    console.log(`[settler] Settled ${settledResults.length} bets: ${settledResults.filter(r => r.status === "won").length}W / ${settledResults.filter(r => r.status === "lost").length}L / ${settledResults.filter(r => r.status === "push").length}P`);
  }
  return { settled: settledResults.length, results: settledResults };
}
