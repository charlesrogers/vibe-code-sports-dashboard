/**
 * Paper Trade Settler — Settle pending bets using match results + Pinnacle closing odds
 *
 * Data sources (in priority order):
 * 1. Fotmob leagues API — real-time results (no lag)
 * 2. Local football-data-cache JSON (has pinnacleCloseHome etc. from bulk-download-odds.mjs)
 * 3. Live fetch from football-data.co.uk CSV (PSH/PSD/PSA = Pinnacle odds at kickoff)
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { loadLedger, saveLedger } from "./storage";
import type { PaperBet } from "./types";
import { fetchMatchesWithOdds, type League } from "../football-data-uk";
import { normalizeTeamName } from "../team-mapping";

const dataDir = join(process.cwd(), "data", "football-data-cache");

/** Map paper-trade league IDs to football-data.co.uk league keys */
const LEAGUE_MAP: Record<string, League> = {
  epl: "epl",
  "la-liga": "la-liga",
  "serie-a": "serie-a",
  bundesliga: "bundesliga",
  championship: "championship",
  "serie-b": "serie-b",
  "ligue-1": "ligue-1",
  // UCL: Fotmob-only (football-data.co.uk doesn't cover European competitions)
};

/** Fotmob league IDs for real-time results */
const FOTMOB_LEAGUE_IDS: Record<string, number> = {
  epl: 47,
  championship: 48,
  "serie-a": 55,
  "la-liga": 87,
  bundesliga: 54,
  "serie-b": 86,
  "ligue-1": 53,
  ucl: 42,
};

interface MatchResult {
  homeTeam: string;
  awayTeam: string;
  date: string;
  homeGoals: number;
  awayGoals: number;
  pinnacleCloseHome: number;
  pinnacleCloseDraw: number;
  pinnacleCloseAway: number;
  pinnacleCloseOver25: number;
  pinnacleCloseUnder25: number;
}

// ─── Team name canonicalization ──────────────────────────────────────────────
// Maps any team name variant (MI, Fotmob, football-data.co.uk CSV) to canonical form
// so "Betis" ≈ "Real Betis", "Man City" ≈ "Manchester City", "Celta" ≈ "Celta Vigo"

// Raw football-data.co.uk CSV abbreviations → canonical
// (download-2526.ts stores these raw; they're not in team-mapping.ts)
const UK_CSV_ALIASES: Record<string, string> = {
  "Nott'm Forest": "Nottingham Forest",
  "Sheffield Utd": "Sheffield United",
  "Sheff Wed": "Sheffield Wednesday",
  "Sheffield Wed": "Sheffield Wednesday",
  "Man City": "Manchester City",
  "Man United": "Manchester United",
  "Wolves": "Wolverhampton Wanderers",
  "Ath Madrid": "Atletico Madrid",
  "Ath Bilbao": "Athletic Bilbao",
  "Betis": "Real Betis",
  "Sociedad": "Real Sociedad",
  "Celta": "Celta Vigo",
  "Vallecano": "Rayo Vallecano",
  "Alaves": "Deportivo Alaves",
  "Dortmund": "Borussia Dortmund",
  "Leverkusen": "Bayer Leverkusen",
  "M'gladbach": "Borussia Monchengladbach",
  "Ein Frankfurt": "Eintracht Frankfurt",
};

function toCanonical(name: string): string {
  // 1. Direct CSV alias lookup
  if (UK_CSV_ALIASES[name]) return UK_CSV_ALIASES[name];
  // 2. Try each source mapping — team-mapping.ts resolves to canonical
  for (const source of ["mi", "fotmob", "footballData"] as const) {
    const canonical = normalizeTeamName(name, source);
    if (canonical !== name) return canonical;
  }
  // Already canonical or unknown — return as-is
  return name;
}

/** Build a canonical key for matching across data sources */
function matchKey(date: string, home: string, away: string): string {
  return `${date}_${toCanonical(home)}_${toCanonical(away)}`;
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
        const key = matchKey(m.date, m.homeTeam, m.awayTeam);
        results.set(key, {
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          date: m.date,
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
        const key = matchKey(m.date, m.homeTeam, m.awayTeam);
        results.set(key, {
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          date: m.date,
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

/** Fetch real-time results from Fotmob leagues API */
async function fetchFotmobResults(league: string): Promise<Map<string, MatchResult>> {
  const results = new Map<string, MatchResult>();
  const fotmobId = FOTMOB_LEAGUE_IDS[league];
  if (!fotmobId) return results;

  try {
    const res = await fetch(
      `https://www.fotmob.com/api/leagues?id=${fotmobId}&ccode3=USA`,
      { headers: { "User-Agent": "Mozilla/5.0 (sports-dashboard settler)" } },
    );
    if (!res.ok) {
      console.warn(`[settler] Fotmob HTTP ${res.status} for league ${league}`);
      return results;
    }

    const data = await res.json();
    const allMatches = data?.fixtures?.allMatches || [];

    for (const m of allMatches) {
      if (!m.status?.finished) continue;

      const scoreStr = m.status?.scoreStr || "";
      const parts = scoreStr.split(" - ");
      if (parts.length !== 2) continue;

      const homeGoals = parseInt(parts[0]);
      const awayGoals = parseInt(parts[1]);
      if (isNaN(homeGoals) || isNaN(awayGoals)) continue;

      const homeName = m.home?.name || "";
      const awayName = m.away?.name || "";
      if (!homeName || !awayName) continue;

      // Fotmob dates: extract from status.utcTime (ISO) or id pattern
      let matchDate = "";
      if (m.status?.utcTime) {
        matchDate = m.status.utcTime.split("T")[0];
      }
      if (!matchDate) continue;

      const key = matchKey(matchDate, homeName, awayName);
      results.set(key, {
        homeTeam: homeName,
        awayTeam: awayName,
        date: matchDate,
        homeGoals,
        awayGoals,
        // Fotmob doesn't provide Pinnacle closing odds — these get overlaid from football-data
        pinnacleCloseHome: 0,
        pinnacleCloseDraw: 0,
        pinnacleCloseAway: 0,
        pinnacleCloseOver25: 0,
        pinnacleCloseUnder25: 0,
      });
    }

    console.log(`[settler] Fotmob: ${results.size} finished matches for ${league}`);
  } catch (e) {
    console.warn(`[settler] Fotmob fetch failed for ${league}:`, e);
  }

  return results;
}

/** Load results: Fotmob (real-time) → cache → football-data.co.uk (closing odds) */
async function loadResults(league: string): Promise<Map<string, MatchResult>> {
  // 1. Start with Fotmob real-time results (no lag)
  const fotmob = await fetchFotmobResults(league);

  // 2. Load local cache (has closing odds if previously downloaded)
  const cache = loadCacheResults(league);

  // 3. Merge: Fotmob results + cache closing odds overlay
  const merged = new Map<string, MatchResult>();

  // Add all Fotmob results first
  for (const [key, result] of fotmob) {
    merged.set(key, result);
  }

  // Overlay cache data: add missing matches and overlay closing odds
  for (const [key, cacheResult] of cache) {
    const existing = merged.get(key);
    if (existing) {
      // Overlay closing odds from cache onto Fotmob result
      if (cacheResult.pinnacleCloseHome > 0) {
        existing.pinnacleCloseHome = cacheResult.pinnacleCloseHome;
        existing.pinnacleCloseDraw = cacheResult.pinnacleCloseDraw;
        existing.pinnacleCloseAway = cacheResult.pinnacleCloseAway;
        existing.pinnacleCloseOver25 = cacheResult.pinnacleCloseOver25;
        existing.pinnacleCloseUnder25 = cacheResult.pinnacleCloseUnder25;
      }
    } else {
      merged.set(key, cacheResult);
    }
  }

  // 4. If still missing closing odds, try football-data.co.uk live fetch
  let hasAnyCloseOdds = false;
  for (const [, r] of merged) {
    if (r.pinnacleCloseHome > 0) { hasAnyCloseOdds = true; break; }
  }

  if (!hasAnyCloseOdds) {
    console.log(`[settler] No closing odds for ${league}, fetching from football-data.co.uk...`);
    const fresh = await fetchFreshResults(league);
    for (const [key, freshResult] of fresh) {
      const existing = merged.get(key);
      if (existing && freshResult.pinnacleCloseHome > 0) {
        existing.pinnacleCloseHome = freshResult.pinnacleCloseHome;
        existing.pinnacleCloseDraw = freshResult.pinnacleCloseDraw;
        existing.pinnacleCloseAway = freshResult.pinnacleCloseAway;
        existing.pinnacleCloseOver25 = freshResult.pinnacleCloseOver25;
        existing.pinnacleCloseUnder25 = freshResult.pinnacleCloseUnder25;
      } else if (!existing) {
        merged.set(key, freshResult);
      }
    }
  }

  return merged;
}

/** Extract 1X2 selection from AH selection (e.g. "Home -0.5" → "Home") */
function ahSide(selection: string): string {
  const m = selection.match(/^(Home|Away)/);
  return m ? m[1] : "";
}

export async function settlePendingBets(): Promise<{ settled: number; results: { id: string; status: string; profit: number }[] }> {
  const ledger = await loadLedger();
  const today = new Date().toISOString().split("T")[0];

  const pending = ledger.bets.filter(b => {
    if (b.status !== "pending") return false;
    // If we have kickoff time, settle 3h after kickoff
    if (b.kickoffTime) {
      return Date.now() - new Date(b.kickoffTime).getTime() > 3 * 60 * 60 * 1000;
    }
    // Otherwise settle any match from today or earlier (Fotmob skips unfinished matches)
    return b.matchDate <= today;
  });
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

    const key = matchKey(bet.matchDate, bet.homeTeam, bet.awayTeam);
    const result = results.get(key);
    if (!result) {
      console.log(`[settler] No result for: ${bet.matchDate} ${bet.homeTeam} vs ${bet.awayTeam} (key: ${key})`);
      continue;
    }

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
