/**
 * Ted Knutson Bet Selection Filters
 *
 * Extracted from scripts/backtest-eval.ts for reuse in the live picks engine.
 * Filters: variance regression, fixture congestion, early season, defiance.
 */

import type { MIModelParams } from "../mi-model/types";
import { isPostInternationalBreak } from "./international-breaks";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TeamMatchRecord {
  date: string;
  expectedGF: number;
  actualGF: number;
  expectedGA: number;
  actualGA: number;
  /** Match-level xG from Understat (when available) */
  matchXGF?: number;
  matchXGA?: number;
}

export interface TeamHistory {
  matches: TeamMatchRecord[];
  defianceCount: number;
  lastDefianceDir: "over" | "under" | null;
}

export interface TedFilterConfig {
  varianceLookback: number;      // last N matches per team (default 10)
  varianceMinGap: number;        // min goals gap to qualify as regression candidate (default 3.0)
  defianceStreak: number;        // consecutive matches defying model (default 8)
  skipEarlyMatchdays: number;    // skip first N matchdays per season (default 5)
  congestionDays: number;        // window in days to check (default 8)
  congestionMatchCount: number;  // max matches in window before filtering (default 3)
  maxOdds: number;               // odds cap (default 2.5)
  minEdge: number;               // min CLV edge (default 0.07)
  noDraws: boolean;              // exclude draw bets (default true)
  internationalBreakFilter: boolean; // skip post-international-break matchdays (default false)
  skipLateMatchdays: number;  // skip matchdays after this threshold (0 = off)
}

export const DEFAULT_TED_CONFIG: TedFilterConfig = {
  varianceLookback: 10,
  varianceMinGap: 3.0,
  defianceStreak: 10,
  skipEarlyMatchdays: 5,
  congestionDays: 8,
  congestionMatchCount: 3,
  maxOdds: 2.0,  // backtest: 2.0 = +2.0% ROI vs 2.5 = +0.3%, 3.0 = -1.7%
  minEdge: 0.07,
  noDraws: true,
  internationalBreakFilter: false,
  skipLateMatchdays: 0,  // display-only: backtest shows GW 30+ = -1.3% ROI, but user decides
};

export interface TedFilterResult {
  pass: boolean;
  reason: "early_season" | "late_season" | "congestion" | "no_variance" | "defiance" | "international_break" | "low_pass_rate" | null;
}

// ─── Team History Builder ───────────────────────────────────────────────────

/**
 * Build team history from played matches + MI model params.
 * Returns per-team history tracking expected vs actual goals.
 */
export function buildTeamHistory(
  playedMatches: any[],
  params: MIModelParams,
  config: TedFilterConfig = DEFAULT_TED_CONFIG,
): { teamHistory: Record<string, TeamHistory>; teamMatchDates: Record<string, string[]>; seasonMatchdayCount: number } {
  const teamHistory: Record<string, TeamHistory> = {};
  const teamMatchDates: Record<string, string[]> = {};

  function getHist(team: string): TeamHistory {
    if (!teamHistory[team]) teamHistory[team] = { matches: [], defianceCount: 0, lastDefianceDir: null };
    return teamHistory[team];
  }

  // Build match-date index for congestion check
  for (const m of playedMatches) {
    if (!teamMatchDates[m.homeTeam]) teamMatchDates[m.homeTeam] = [];
    if (!teamMatchDates[m.awayTeam]) teamMatchDates[m.awayTeam] = [];
    teamMatchDates[m.homeTeam].push(m.date);
    teamMatchDates[m.awayTeam].push(m.date);
  }

  // Count unique matchdays for season tracking
  const matchdayDates = [...new Set(playedMatches.map((m: any) => m.date))].sort();
  const seasonMatchdayCount = matchdayDates.length;

  // Process each match to build history
  // Use direct lambda computation instead of full predictMatch (50x faster — no score grid)
  for (const m of playedMatches) {
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const homeRating = params.teams[m.homeTeam];
    const awayRating = params.teams[m.awayTeam];
    if (!homeRating || !awayRating) continue;

    // Compute expected goals directly from Dixon-Coles formula
    const expHome = homeRating.attack * awayRating.defense * params.homeAdvantage * params.avgGoalRate;
    const expAway = awayRating.attack * homeRating.defense * params.avgGoalRate;

    const hh = getHist(m.homeTeam);
    const ah = getHist(m.awayTeam);

    hh.matches.push({
      date: m.date,
      expectedGF: expHome,
      actualGF: m.homeGoals,
      expectedGA: expAway,
      actualGA: m.awayGoals,
    });
    ah.matches.push({
      date: m.date,
      expectedGF: expAway,
      actualGF: m.awayGoals,
      expectedGA: expHome,
      actualGA: m.homeGoals,
    });

    // Trim to lookback window
    if (hh.matches.length > config.varianceLookback) hh.matches.shift();
    if (ah.matches.length > config.varianceLookback) ah.matches.shift();

    // Update defiance tracking
    for (const [team, expTotal, actTotal] of [
      [m.homeTeam, expHome + expAway, m.homeGoals + m.awayGoals],
      [m.awayTeam, expAway + expHome, m.awayGoals + m.homeGoals],
    ] as [string, number, number][]) {
      const th = getHist(team);
      const dir = actTotal > expTotal ? "over" as const : "under" as const;
      if (th.lastDefianceDir === dir) {
        th.defianceCount++;
      } else {
        th.defianceCount = 1;
        th.lastDefianceDir = dir;
      }
    }
  }

  return { teamHistory, teamMatchDates, seasonMatchdayCount };
}

// ─── Filter Application ─────────────────────────────────────────────────────

/**
 * Check if a team is a regression candidate (xG diverges from actual goals).
 */
export function isRegressionCandidate(
  hist: TeamHistory,
  config: TedFilterConfig = DEFAULT_TED_CONFIG,
): boolean {
  if (hist.matches.length < config.varianceLookback) return false;
  const recent = hist.matches.slice(-config.varianceLookback);
  const gaGap = recent.reduce((s, m) => s + (m.actualGA - m.expectedGA), 0);
  const gfGap = recent.reduce((s, m) => s + (m.actualGF - m.expectedGF), 0);
  return Math.abs(gaGap) >= config.varianceMinGap || Math.abs(gfGap) >= config.varianceMinGap;
}

/**
 * Check if a team has fixture congestion (N matches in D days).
 */
export function isCongested(
  team: string,
  matchDate: string,
  teamMatchDates: Record<string, string[]>,
  config: TedFilterConfig = DEFAULT_TED_CONFIG,
): boolean {
  const dates = teamMatchDates[team] || [];
  const cutoff = new Date(new Date(matchDate).getTime() - config.congestionDays * 86400000)
    .toISOString().split("T")[0];
  const recentCount = dates.filter(d => d >= cutoff && d < matchDate).length;
  return recentCount >= config.congestionMatchCount - 1; // -1 because current match is the Nth
}

/**
 * Apply all Ted filters to a match. Returns pass/fail with reason.
 */
export function applyTedFilters(
  homeTeam: string,
  awayTeam: string,
  matchDate: string,
  teamHistory: Record<string, TeamHistory>,
  teamMatchDates: Record<string, string[]>,
  seasonMatchday: number,
  config: TedFilterConfig = DEFAULT_TED_CONFIG,
): TedFilterResult {
  // 1. Skip early season
  if (seasonMatchday <= config.skipEarlyMatchdays) {
    return { pass: false, reason: "early_season" };
  }

  // 1b. Skip late season (dead rubbers, rotation, motivation asymmetry)
  if (config.skipLateMatchdays > 0 && seasonMatchday > config.skipLateMatchdays) {
    return { pass: false, reason: "late_season" };
  }

  // 2. International break filter
  if (config.internationalBreakFilter && isPostInternationalBreak(matchDate)) {
    return { pass: false, reason: "international_break" };
  }

  // 3. Congestion filter
  if (isCongested(homeTeam, matchDate, teamMatchDates, config) ||
      isCongested(awayTeam, matchDate, teamMatchDates, config)) {
    return { pass: false, reason: "congestion" };
  }

  // 4. Variance filter — at least one team must be a regression candidate
  const homeHist = teamHistory[homeTeam];
  const awayHist = teamHistory[awayTeam];
  const homeRegression = homeHist ? isRegressionCandidate(homeHist, config) : false;
  const awayRegression = awayHist ? isRegressionCandidate(awayHist, config) : false;
  if (!homeRegression && !awayRegression) {
    return { pass: false, reason: "no_variance" };
  }

  // 5. Defiance filter
  const homeDefiant = homeHist && homeHist.defianceCount >= config.defianceStreak;
  const awayDefiant = awayHist && awayHist.defianceCount >= config.defianceStreak;
  if (homeDefiant || awayDefiant) {
    return { pass: false, reason: "defiance" };
  }

  return { pass: true, reason: null };
}

/**
 * Get a human-readable explanation for a Ted filter result.
 */
export function tedReasonLabel(reason: TedFilterResult["reason"]): string {
  switch (reason) {
    case "early_season": return "Early season — insufficient data";
    case "late_season": return "Late season — dead rubber window (GW 30+)";
    case "congestion": return "Fixture congestion — team playing 3+ in 8 days";
    case "no_variance": return "No regression candidate — no xG divergence";
    case "defiance": return "Persistent model defiance — structural mismatch";
    case "international_break": return "Post-international break — unpredictable matchday";
    case "low_pass_rate": return "Low historical win rate — below threshold";
    default: return "";
  }
}

/**
 * Get variance summary for a team (for display on picks page).
 */
export function getVarianceSummary(
  team: string,
  teamHistory: Record<string, TeamHistory>,
  config: TedFilterConfig = DEFAULT_TED_CONFIG,
): { isCandidate: boolean; gfGap: number; gaGap: number; direction: string } | null {
  const hist = teamHistory[team];
  if (!hist || hist.matches.length < config.varianceLookback) return null;
  const recent = hist.matches.slice(-config.varianceLookback);
  const gaGap = recent.reduce((s, m) => s + (m.actualGA - m.expectedGA), 0);
  const gfGap = recent.reduce((s, m) => s + (m.actualGF - m.expectedGF), 0);
  const isCandidate = Math.abs(gaGap) >= config.varianceMinGap || Math.abs(gfGap) >= config.varianceMinGap;

  let direction = "neutral";
  if (Math.abs(gaGap) >= config.varianceMinGap) {
    direction = gaGap > 0 ? "defensive regression (conceding too many)" : "defensive overperformance";
  } else if (Math.abs(gfGap) >= config.varianceMinGap) {
    direction = gfGap > 0 ? "offensive overperformance" : "offensive regression (scoring too few)";
  }

  return { isCandidate, gfGap: Math.round(gfGap * 10) / 10, gaGap: Math.round(gaGap * 10) / 10, direction };
}

// ─── Pass Rate Filter ─────────────────────────────────────────────────────

export interface PassRateEntry {
  n: number;
  hitRate: number;
  roi: number;
  clv: number;
}

/** Lookup table: "league|marketType|direction" → backtest stats */
let passRateCache: Record<string, PassRateEntry> | null = null;

/**
 * Load the pass rate lookup table from data/backtest/pass-rates.json.
 * Generated by: npx tsx scripts/backtest-eval.ts --ted --pass-rates
 */
export function loadPassRates(): Record<string, PassRateEntry> {
  if (passRateCache) return passRateCache;
  try {
    const fs = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const fp = join(process.cwd(), "data", "backtest", "pass-rates.json");
    if (fs.existsSync(fp)) {
      passRateCache = JSON.parse(fs.readFileSync(fp, "utf-8"));
      return passRateCache!;
    }
  } catch { /* no pass rates available */ }
  return {};
}

/** Normalize bet selection to direction key: Home/Away/Draw/Over/Under */
function selectionDirection(selection: string): string {
  if (selection.startsWith("Home")) return "Home";
  if (selection.startsWith("Away")) return "Away";
  if (selection === "Draw") return "Draw";
  if (selection === "Over 2.5") return "Over";
  if (selection === "Under 2.5") return "Under";
  return selection;
}

/**
 * Check if a (league, marketType, selection) combo passes the historical win rate threshold.
 * Returns null if no data available (permissive — bet is allowed).
 */
export function checkPassRate(
  league: string,
  marketType: string,
  selection: string,
  minHitRate: number = 0.50,
): { pass: boolean; hitRate: number | null; n: number } {
  const rates = loadPassRates();
  const dir = selectionDirection(selection);
  const key = `${league}|${marketType}|${dir}`;
  const entry = rates[key];
  if (!entry || entry.n < 10) return { pass: true, hitRate: null, n: 0 }; // no data → allow
  return {
    pass: entry.hitRate >= minHitRate,
    hitRate: entry.hitRate,
    n: entry.n,
  };
}
