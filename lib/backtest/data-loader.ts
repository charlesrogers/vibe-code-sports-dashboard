/**
 * Shared Backtest Data Loader
 *
 * Extracts data loading from backtest-eval.ts for reuse across:
 * - backtest-eval.ts
 * - param-sweep.ts
 * - test-signal.ts
 * - alpha-decomposition.ts
 *
 * Loads solver snapshots, match data, team histories, GK data.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { predictMatch, predictMatchFromLambdas } from "../mi-model/predictor";
import { devigOdds1X2, devigOdds2Way } from "../mi-model/data-prep";
import type { MIModelParams, MatchPrediction } from "../mi-model/types";
import type { TeamHistory } from "../mi-picks/ted-filters";
import type { BetRecord, MatchData, MatchOdds } from "../signals/types";

// ─── Constants ──────────────────────────────────────────────────────────────

export const PROJECT_ROOT = join(import.meta.dirname || __dirname, "../..");
export const DATA_DIR = join(PROJECT_ROOT, "data/football-data-cache");
export const CACHE_DIR = join(PROJECT_ROOT, "data", "backtest", "solver-cache");
export const GK_HISTORY_DIR = join(PROJECT_ROOT, "data", "backtest", "gk-history");

export const LEAGUES = [
  { id: "epl", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "la-liga", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "bundesliga", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "serie-a", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "ligue-1", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "championship", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
];

export const TEST_SEASON_START = "2022";
export const EMBARGO_DAYS = 3;
export const VARIANCE_LOOKBACK = 10;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GKHistoryEntry {
  player: string;
  team: string;
  goalsPrevented: number;
  goalsPreventedPer90: number;
  matchesPlayed: number;
}

export interface PrecomputedMatch {
  match: any;              // raw match record
  pred: MatchPrediction;
  leagueId: string;
  season: string;
  seasonMatchday: number;
  /** Devigged closing 1X2 probs */
  closing1X2: { home: number; draw: number; away: number } | null;
  /** Devigged closing AH probs */
  closingAH: { prob1: number; prob2: number } | null;
  ahLine: number | null;
  ahHome: number | null;
  ahAway: number | null;
  /** Devigged closing O/U probs */
  closingOU: { prob1: number; prob2: number } | null;
  closeOver: number | null;
  closeUnder: number | null;
}

export interface LeagueData {
  leagueId: string;
  trainMatches: any[];
  testMatches: any[];
  rawMatches: any[];
  matchdayDates: string[];
  snapshots: Map<string, MIModelParams>;
}

export interface MatchXGRecord {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeXG: number;
  awayXG: number;
  homeGoals: number;
  awayGoals: number;
}

export interface LoadedData {
  precomputed: PrecomputedMatch[];
  leagueData: LeagueData[];
  teamMatchDates: Record<string, string[]>;
  teamHistories: Record<string, Record<string, TeamHistory>>;
  /** Team histories built with real match-level xG (when available) */
  teamHistoriesXG: Record<string, Record<string, TeamHistory>>;
  gkHistory: Map<string, Map<string, Map<string, GKHistoryEntry>>>;
  /** Match-level xG data keyed by "date_homeTeam_awayTeam" */
  matchXG: Map<string, MatchXGRecord>;
}

// ─── Solver Snapshot Loader ─────────────────────────────────────────────────

export function loadSnapshots(leagueId: string): Map<string, MIModelParams> {
  const map = new Map<string, MIModelParams>();
  if (!existsSync(CACHE_DIR)) return map;
  const prefix = `${leagueId}_`;
  const files = readdirSync(CACHE_DIR).filter(f => f.startsWith(prefix) && f.endsWith(".json"));
  for (const f of files) {
    const parts = f.replace(".json", "").split("_");
    const date = parts[1];
    try {
      const params = JSON.parse(readFileSync(join(CACHE_DIR, f), "utf-8")) as MIModelParams;
      map.set(date, params);
    } catch { /* skip corrupt */ }
  }
  return map;
}

// ─── GK History Loader ──────────────────────────────────────────────────────

export function loadGKHistory(): Map<string, Map<string, Map<string, GKHistoryEntry>>> {
  const map = new Map<string, Map<string, Map<string, GKHistoryEntry>>>();
  if (!existsSync(GK_HISTORY_DIR)) return map;

  const files = readdirSync(GK_HISTORY_DIR).filter(f => f.endsWith(".json"));
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(GK_HISTORY_DIR, f), "utf-8"));
      const leagueId = data.league as string;
      const seasonName = data.season as string;
      const seasonKey = seasonName.split("/")[0];

      if (!map.has(leagueId)) map.set(leagueId, new Map());
      const leagueMap = map.get(leagueId)!;
      if (!leagueMap.has(seasonKey)) leagueMap.set(seasonKey, new Map());
      const teamMap = leagueMap.get(seasonKey)!;

      for (const gk of (data.keepers || []) as GKHistoryEntry[]) {
        const teamNorm = gk.team.toLowerCase().trim();
        const existing = teamMap.get(teamNorm);
        if (!existing || gk.matchesPlayed > existing.matchesPlayed) {
          teamMap.set(teamNorm, gk);
        }
      }
    } catch { /* skip corrupt */ }
  }
  return map;
}

// ─── GK Adjustment ──────────────────────────────────────────────────────────

const GK_IMPACT_PER90 = 0.12;
const MAX_GK_ADJUSTMENT = 0.15;
const MIN_GK_MATCHES = 8;

export function getGKAdjustment(
  homeTeam: string,
  awayTeam: string,
  leagueId: string,
  seasonKey: string,
  gkHistory: Map<string, Map<string, Map<string, GKHistoryEntry>>>,
): { homeGKAdj: number; awayGKAdj: number } {
  const teamMap = gkHistory.get(leagueId)?.get(seasonKey);
  if (!teamMap) return { homeGKAdj: 1.0, awayGKAdj: 1.0 };

  const findGK = (teamName: string): GKHistoryEntry | null => {
    const norm = teamName.toLowerCase().trim();
    for (const [key, gk] of teamMap) {
      if (key === norm || key.includes(norm) || norm.includes(key)) {
        return gk.matchesPlayed >= MIN_GK_MATCHES ? gk : null;
      }
    }
    return null;
  };

  const homeGK = findGK(homeTeam);
  const awayGK = findGK(awayTeam);

  let homeGKAdj = 1.0;
  let awayGKAdj = 1.0;

  if (awayGK) {
    const rawAdj = awayGK.goalsPreventedPer90 * GK_IMPACT_PER90;
    homeGKAdj = 1.0 - Math.max(-MAX_GK_ADJUSTMENT, Math.min(MAX_GK_ADJUSTMENT, rawAdj));
  }
  if (homeGK) {
    const rawAdj = homeGK.goalsPreventedPer90 * GK_IMPACT_PER90;
    awayGKAdj = 1.0 - Math.max(-MAX_GK_ADJUSTMENT, Math.min(MAX_GK_ADJUSTMENT, rawAdj));
  }

  return { homeGKAdj, awayGKAdj };
}

// ─── Match-Level xG Loader ───────────────────────────────────────────────────

const MATCH_XG_DIR = join(PROJECT_ROOT, "data", "match-xg");

/**
 * Load match-level xG from data/match-xg/{league}-{season}.json.
 * Returns a map keyed by "date_homeTeam_awayTeam" for fast lookup.
 */
export function loadMatchXG(): Map<string, MatchXGRecord> {
  const map = new Map<string, MatchXGRecord>();
  if (!existsSync(MATCH_XG_DIR)) return map;

  const files = readdirSync(MATCH_XG_DIR).filter(f => f.endsWith(".json"));
  for (const f of files) {
    try {
      const data = JSON.parse(readFileSync(join(MATCH_XG_DIR, f), "utf-8"));
      for (const m of data.matches || []) {
        const key = `${m.date}_${m.homeTeam}_${m.awayTeam}`;
        map.set(key, {
          date: m.date,
          homeTeam: m.homeTeam,
          awayTeam: m.awayTeam,
          homeXG: m.homeXG,
          awayXG: m.awayXG,
          homeGoals: m.homeGoals,
          awayGoals: m.awayGoals,
        });
      }
    } catch { /* skip corrupt */ }
  }
  return map;
}

/**
 * Try to find match xG with fuzzy team name matching.
 * First tries exact key, then scans for date matches with substring matching.
 */
export function findMatchXG(
  matchXG: Map<string, MatchXGRecord>,
  date: string,
  homeTeam: string,
  awayTeam: string,
): MatchXGRecord | null {
  // Exact match
  const key = `${date}_${homeTeam}_${awayTeam}`;
  if (matchXG.has(key)) return matchXG.get(key)!;

  // Fuzzy: scan for date match with substring team names
  const homeNorm = homeTeam.toLowerCase();
  const awayNorm = awayTeam.toLowerCase();
  for (const [k, v] of matchXG) {
    if (!k.startsWith(date + "_")) continue;
    const vHomeNorm = v.homeTeam.toLowerCase();
    const vAwayNorm = v.awayTeam.toLowerCase();
    if ((vHomeNorm.includes(homeNorm) || homeNorm.includes(vHomeNorm)) &&
        (vAwayNorm.includes(awayNorm) || awayNorm.includes(vAwayNorm))) {
      return v;
    }
  }
  return null;
}

// ─── Match Data Loader ──────────────────────────────────────────────────────

export function loadRawMatches(leagueId: string, seasons: string[]): any[] {
  let rawMatches: any[] = [];
  for (const season of seasons) {
    const fp = join(DATA_DIR, `${leagueId}-${season}.json`);
    if (!existsSync(fp)) continue;
    try {
      const raw = JSON.parse(readFileSync(fp, "utf-8"));
      rawMatches.push(...(raw.matches || []));
    } catch { continue; }
  }
  rawMatches.sort((a: any, b: any) => a.date.localeCompare(b.date));
  return rawMatches;
}

// ─── Team History Builder ───────────────────────────────────────────────────

export function buildTeamHistories(
  trainMatches: any[],
  precomputed: PrecomputedMatch[],
  lookback: number = VARIANCE_LOOKBACK,
): Record<string, TeamHistory> {
  const teamHistory: Record<string, TeamHistory> = {};

  function getHist(team: string): TeamHistory {
    if (!teamHistory[team]) teamHistory[team] = { matches: [], defianceCount: 0, lastDefianceDir: null };
    return teamHistory[team];
  }

  // Pre-populate from training matches
  for (const m of trainMatches) {
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const avgRate = 1.35;
    const hh = getHist(m.homeTeam);
    const ah = getHist(m.awayTeam);
    hh.matches.push({ date: m.date, expectedGF: avgRate, actualGF: m.homeGoals, expectedGA: avgRate, actualGA: m.awayGoals });
    ah.matches.push({ date: m.date, expectedGF: avgRate, actualGF: m.awayGoals, expectedGA: avgRate, actualGA: m.homeGoals });
    if (hh.matches.length > lookback) hh.matches.shift();
    if (ah.matches.length > lookback) ah.matches.shift();
  }

  // Update with test match predictions
  for (const pm of precomputed) {
    const m = pm.match;
    const pred = pm.pred;
    const hh = getHist(m.homeTeam);
    const ah = getHist(m.awayTeam);

    hh.matches.push({
      date: m.date,
      expectedGF: pred.expectedGoals.home,
      actualGF: m.homeGoals,
      expectedGA: pred.expectedGoals.away,
      actualGA: m.awayGoals,
    });
    ah.matches.push({
      date: m.date,
      expectedGF: pred.expectedGoals.away,
      actualGF: m.awayGoals,
      expectedGA: pred.expectedGoals.home,
      actualGA: m.homeGoals,
    });

    if (hh.matches.length > lookback) hh.matches.shift();
    if (ah.matches.length > lookback) ah.matches.shift();

    // Defiance tracking
    for (const [team, expG, actG] of [
      [m.homeTeam, pred.expectedGoals.home + pred.expectedGoals.away, m.homeGoals + m.awayGoals],
      [m.awayTeam, pred.expectedGoals.away + pred.expectedGoals.home, m.awayGoals + m.homeGoals],
    ] as [string, number, number][]) {
      const th = getHist(team);
      const dir = actG > expG ? "over" as const : "under" as const;
      if (th.lastDefianceDir === dir) th.defianceCount++;
      else { th.defianceCount = 1; th.lastDefianceDir = dir; }
    }
  }

  return teamHistory;
}

/**
 * Build team histories using real match-level xG where available.
 * Falls back to model expected goals when xG data is missing.
 */
export function buildTeamHistoriesXG(
  trainMatches: any[],
  precomputed: PrecomputedMatch[],
  matchXG: Map<string, MatchXGRecord>,
  lookback: number = VARIANCE_LOOKBACK,
): Record<string, TeamHistory> {
  const teamHistory: Record<string, TeamHistory> = {};

  function getHist(team: string): TeamHistory {
    if (!teamHistory[team]) teamHistory[team] = { matches: [], defianceCount: 0, lastDefianceDir: null };
    return teamHistory[team];
  }

  // Pre-populate from training matches (use model proxy — no xG for pre-test period)
  for (const m of trainMatches) {
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const avgRate = 1.35;
    const hh = getHist(m.homeTeam);
    const ah = getHist(m.awayTeam);

    // Try real xG first
    const xg = findMatchXG(matchXG, m.date, m.homeTeam, m.awayTeam);
    const expHome = xg ? xg.homeXG : avgRate;
    const expAway = xg ? xg.awayXG : avgRate;

    hh.matches.push({ date: m.date, expectedGF: expHome, actualGF: m.homeGoals, expectedGA: expAway, actualGA: m.awayGoals });
    ah.matches.push({ date: m.date, expectedGF: expAway, actualGF: m.awayGoals, expectedGA: expHome, actualGA: m.homeGoals });
    if (hh.matches.length > lookback) hh.matches.shift();
    if (ah.matches.length > lookback) ah.matches.shift();
  }

  // Update with test match predictions — use real xG when available
  for (const pm of precomputed) {
    const m = pm.match;
    const pred = pm.pred;
    const hh = getHist(m.homeTeam);
    const ah = getHist(m.awayTeam);

    // Use match-level xG for expected goals (the true Ted signal)
    const xg = findMatchXG(matchXG, m.date, m.homeTeam, m.awayTeam);
    const expGFHome = xg ? xg.homeXG : pred.expectedGoals.home;
    const expGFAway = xg ? xg.awayXG : pred.expectedGoals.away;

    hh.matches.push({
      date: m.date,
      expectedGF: expGFHome,
      actualGF: m.homeGoals,
      expectedGA: expGFAway,
      actualGA: m.awayGoals,
    });
    ah.matches.push({
      date: m.date,
      expectedGF: expGFAway,
      actualGF: m.awayGoals,
      expectedGA: expGFHome,
      actualGA: m.homeGoals,
    });

    if (hh.matches.length > lookback) hh.matches.shift();
    if (ah.matches.length > lookback) ah.matches.shift();

    // Defiance tracking (same logic)
    for (const [team, expG, actG] of [
      [m.homeTeam, expGFHome + expGFAway, m.homeGoals + m.awayGoals],
      [m.awayTeam, expGFAway + expGFHome, m.awayGoals + m.homeGoals],
    ] as [string, number, number][]) {
      const th = getHist(team);
      const dir = actG > expG ? "over" as const : "under" as const;
      if (th.lastDefianceDir === dir) th.defianceCount++;
      else { th.defianceCount = 1; th.lastDefianceDir = dir; }
    }
  }

  return teamHistory;
}

// ─── Build Team Match Dates Index ───────────────────────────────────────────

export function buildTeamMatchDates(rawMatches: any[]): Record<string, string[]> {
  const teamMatchDates: Record<string, string[]> = {};
  for (const m of rawMatches) {
    if (!teamMatchDates[m.homeTeam]) teamMatchDates[m.homeTeam] = [];
    if (!teamMatchDates[m.awayTeam]) teamMatchDates[m.awayTeam] = [];
    teamMatchDates[m.homeTeam].push(m.date);
    teamMatchDates[m.awayTeam].push(m.date);
  }
  return teamMatchDates;
}

// ─── Precompute All Match Predictions ───────────────────────────────────────

export interface LoadOptions {
  leagueFilter?: string[] | null;
  gkAdjust?: boolean;
  verbose?: boolean;
  /** Calibration shrinkage factor (e.g. 0.90). Applied to all predictions. */
  calibrationShrink?: number;
}

export function loadAllData(options: LoadOptions = {}): LoadedData {
  const { leagueFilter = null, gkAdjust = false, verbose = true, calibrationShrink } = options;

  const activeLeagues = leagueFilter
    ? LEAGUES.filter(l => leagueFilter.includes(l.id))
    : LEAGUES;

  const cachedLeagues = activeLeagues.filter(l => loadSnapshots(l.id).size > 0);

  if (verbose) {
    console.log(`  Leagues with cached solves: ${cachedLeagues.map(l => l.id).join(", ")}`);
  }

  const gkHistoryData = gkAdjust ? loadGKHistory() : new Map();
  const allPrecomputed: PrecomputedMatch[] = [];
  const allLeagueData: LeagueData[] = [];
  const globalTeamMatchDates: Record<string, string[]> = {};

  for (const league of cachedLeagues) {
    const snapshots = loadSnapshots(league.id);
    const snapDates = [...snapshots.keys()].sort();
    const rawMatches = loadRawMatches(league.id, league.seasons);

    // Build team match dates
    for (const m of rawMatches) {
      if (!globalTeamMatchDates[m.homeTeam]) globalTeamMatchDates[m.homeTeam] = [];
      if (!globalTeamMatchDates[m.awayTeam]) globalTeamMatchDates[m.awayTeam] = [];
      globalTeamMatchDates[m.homeTeam].push(m.date);
      globalTeamMatchDates[m.awayTeam].push(m.date);
    }

    const trainMatches = rawMatches.filter((m: any) => m.date < `${TEST_SEASON_START}-07-01`);
    const testMatches = rawMatches.filter((m: any) => m.date >= `${TEST_SEASON_START}-07-01`);
    const matchdayDates = [...new Set(testMatches.map((m: any) => m.date))].sort();

    allLeagueData.push({ leagueId: league.id, trainMatches, testMatches, rawMatches, matchdayDates, snapshots });

    // Pre-compute predictions
    let currentParams: MIModelParams | null = null;
    let currentSeason = "";
    let seasonMatchdayCount = 0;

    for (const matchday of matchdayDates) {
      let bestSnap: string | null = null;
      for (const sd of snapDates) {
        if (sd <= matchday) bestSnap = sd;
        else break;
      }
      if (bestSnap) {
        currentParams = snapshots.get(bestSnap)!;
        if (calibrationShrink != null) {
          currentParams = { ...currentParams, calibrationShrink };
        }
      }
      if (!currentParams) continue;

      const dayMatches = rawMatches.filter((m: any) => m.date === matchday);

      // Season tracking
      const matchMonth = parseInt(matchday.slice(5, 7));
      const seasonKey = matchMonth >= 7 ? matchday.slice(0, 4) : String(parseInt(matchday.slice(0, 4)) - 1);
      if (seasonKey !== currentSeason) {
        currentSeason = seasonKey;
        seasonMatchdayCount = 0;
      }
      seasonMatchdayCount++;

      for (const m of dayMatches) {
        if (m.homeGoals == null || m.awayGoals == null) continue;
        if (!currentParams.teams[m.homeTeam] || !currentParams.teams[m.awayTeam]) continue;

        let pred: MatchPrediction;
        try { pred = predictMatch(currentParams, m.homeTeam, m.awayTeam); }
        catch { continue; }

        // GK adjustment
        if (gkAdjust) {
          const mMonth = parseInt(m.date.slice(5, 7));
          const mYear = parseInt(m.date.slice(0, 4));
          const gkSeasonKey = mMonth >= 7 ? String(mYear) : String(mYear - 1);
          const { homeGKAdj, awayGKAdj } = getGKAdjustment(
            m.homeTeam, m.awayTeam, league.id, gkSeasonKey, gkHistoryData,
          );
          if (homeGKAdj !== 1.0 || awayGKAdj !== 1.0) {
            try {
              pred = predictMatchFromLambdas(
                m.homeTeam, m.awayTeam,
                pred.lambdaHome * homeGKAdj,
                pred.lambdaAway * awayGKAdj,
                pred.lambda3,
              );
            } catch { /* fallback to unadjusted */ }
          }
        }

        // Pre-compute market data
        let closing1X2: PrecomputedMatch["closing1X2"] = null;
        if (m.pinnacleCloseHome && m.pinnacleCloseDraw && m.pinnacleCloseAway) {
          closing1X2 = devigOdds1X2(m.pinnacleCloseHome, m.pinnacleCloseDraw, m.pinnacleCloseAway);
        }

        const ahLine = m.ahCloseLine ?? m.ahLine;
        const ahHome = m.pinnacleCloseAHHome ?? m.pinnacleAHHome;
        const ahAway = m.pinnacleCloseAHAway ?? m.pinnacleAHAway;
        let closingAH: PrecomputedMatch["closingAH"] = null;
        if (ahLine != null && ahHome && ahAway) {
          closingAH = devigOdds2Way(ahHome, ahAway);
        }

        const closeOver = m.pinnacleCloseOver25 || m.pinnacleOver25;
        const closeUnder = m.pinnacleCloseUnder25 || m.pinnacleUnder25;
        let closingOU: PrecomputedMatch["closingOU"] = null;
        if (closeOver && closeUnder) {
          closingOU = devigOdds2Way(closeOver, closeUnder);
        }

        allPrecomputed.push({
          match: m,
          pred,
          leagueId: league.id,
          season: m.season || "unknown",
          seasonMatchday: seasonMatchdayCount,
          closing1X2,
          closingAH,
          ahLine,
          ahHome,
          ahAway,
          closingOU,
          closeOver: closeOver || null,
          closeUnder: closeUnder || null,
        });
      }
    }

    if (verbose) {
      console.log(`  ${league.id.toUpperCase()}: ${allPrecomputed.filter(p => p.leagueId === league.id).length} test matches pre-computed`);
    }
  }

  // Load match-level xG data
  const matchXGData = loadMatchXG();
  if (verbose && matchXGData.size > 0) {
    console.log(`  Match-level xG loaded: ${matchXGData.size} matches`);
  }

  // Build team histories per league (model-based and xG-based)
  const teamHistories: Record<string, Record<string, TeamHistory>> = {};
  const teamHistoriesXG: Record<string, Record<string, TeamHistory>> = {};
  for (const ld of allLeagueData) {
    const leaguePrecomputed = allPrecomputed.filter(p => p.leagueId === ld.leagueId);
    teamHistories[ld.leagueId] = buildTeamHistories(ld.trainMatches, leaguePrecomputed);
    teamHistoriesXG[ld.leagueId] = buildTeamHistoriesXG(ld.trainMatches, leaguePrecomputed, matchXGData);
  }

  return {
    precomputed: allPrecomputed,
    leagueData: allLeagueData,
    teamMatchDates: globalTeamMatchDates,
    teamHistories,
    teamHistoriesXG,
    gkHistory: gkHistoryData,
    matchXG: matchXGData,
  };
}
