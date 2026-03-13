/**
 * Shared Bet Evaluator
 *
 * Extracts the market evaluation loop from backtest-eval.ts.
 * Given precomputed matches + filter config, produces BetRecord[].
 */

import type { MatchPrediction } from "../mi-model/types";
import type { TeamHistory } from "../mi-picks/ted-filters";
import type { BetRecord } from "../signals/types";
import type { PrecomputedMatch } from "./data-loader";
import { VARIANCE_LOOKBACK } from "./data-loader";

// ─── Filter Configuration ───────────────────────────────────────────────────

export interface EvalConfig {
  minEdge: number;
  maxOdds: number | null;
  noDraws: boolean;
  /** Market filter: "all", "ah", "1x2", "sides", "unders", "overs", "totals" */
  markets: string;
  /** Variance filter: min goals gap to qualify as regression candidate */
  varianceMinGap: number;
  /** Skip first N matchdays per season */
  skipEarlyMatchdays: number;
  /** Congestion filter: days window */
  congestionDays: number;
  /** Congestion filter: max matches in window */
  congestionMatchCount: number;
  /** Defiance filter: consecutive matches threshold */
  defianceStreak: number;
  /** Enable variance filter */
  varianceFilter: boolean;
  /** Enable congestion filter */
  congestionFilter: boolean;
  /** Enable defiance filter */
  defianceFilter: boolean;
}

export const DEFAULT_EVAL_CONFIG: EvalConfig = {
  minEdge: 0.07,
  maxOdds: 2.0,
  noDraws: true,
  markets: "all",
  varianceMinGap: 3.0,
  skipEarlyMatchdays: 5,
  congestionDays: 8,
  congestionMatchCount: 3,
  defianceStreak: 10,
  varianceFilter: true,
  congestionFilter: true,
  defianceFilter: true,
};

// ─── Market Filter ──────────────────────────────────────────────────────────

export function wantMarket(type: "1X2" | "AH" | "OU25", selection: string, markets: string): boolean {
  if (!markets || markets === "all") return true;
  const m = markets.toLowerCase();
  if (m === "ah") return type === "AH";
  if (m === "1x2") return type === "1X2";
  if (m === "sides") return type === "1X2" || type === "AH";
  if (m === "unders") return selection === "Under 2.5";
  if (m === "overs") return selection === "Over 2.5";
  if (m === "totals") return type === "OU25";
  return true;
}

// ─── Congestion Check ───────────────────────────────────────────────────────

function isCongested(
  team: string,
  matchDate: string,
  teamMatchDates: Record<string, string[]>,
  config: EvalConfig,
): boolean {
  const dates = teamMatchDates[team] || [];
  const idx = dates.indexOf(matchDate);
  if (idx < 2) return false;
  const d8ago = new Date(new Date(matchDate).getTime() - config.congestionDays * 86400000)
    .toISOString().split("T")[0];
  let count = 0;
  for (let i = idx - 1; i >= 0 && dates[i] >= d8ago; i--) count++;
  return count >= config.congestionMatchCount - 1;
}

// ─── Variance Check ─────────────────────────────────────────────────────────

function isRegressionCandidate(
  hist: TeamHistory,
  varianceMinGap: number,
): boolean {
  if (hist.matches.length < VARIANCE_LOOKBACK) return false;
  const recent = hist.matches.slice(-VARIANCE_LOOKBACK);
  const gaGap = recent.reduce((s, m) => s + (m.actualGA - m.expectedGA), 0);
  const gfGap = recent.reduce((s, m) => s + (m.actualGF - m.expectedGF), 0);
  return Math.abs(gaGap) >= varianceMinGap || Math.abs(gfGap) >= varianceMinGap;
}

// ─── Skip Counter ───────────────────────────────────────────────────────────

export interface SkipCounts {
  early: number;
  variance: number;
  congestion: number;
  defiance: number;
}

// ─── Core Evaluator ─────────────────────────────────────────────────────────

/**
 * Evaluate precomputed matches against filters, produce BetRecord[].
 * This is the core loop extracted from backtest-eval.ts.
 */
export function evaluateBets(
  precomputed: PrecomputedMatch[],
  teamHistories: Record<string, Record<string, TeamHistory>>,
  teamMatchDates: Record<string, string[]>,
  config: EvalConfig = DEFAULT_EVAL_CONFIG,
): { bets: BetRecord[]; skipped: Record<string, SkipCounts> } {
  const bets: BetRecord[] = [];
  const skipped: Record<string, SkipCounts> = {};

  for (const pm of precomputed) {
    const m = pm.match;
    const pred = pm.pred;
    const lid = pm.leagueId;

    if (!skipped[lid]) skipped[lid] = { early: 0, variance: 0, congestion: 0, defiance: 0 };

    // Skip early season
    if (pm.seasonMatchday <= config.skipEarlyMatchdays) {
      skipped[lid].early++;
      continue;
    }

    // Congestion filter
    if (config.congestionFilter) {
      if (isCongested(m.homeTeam, m.date, teamMatchDates, config) ||
          isCongested(m.awayTeam, m.date, teamMatchDates, config)) {
        skipped[lid].congestion++;
        continue;
      }
    }

    // Variance filter
    if (config.varianceFilter) {
      const homeHist = teamHistories[lid]?.[m.homeTeam];
      const awayHist = teamHistories[lid]?.[m.awayTeam];
      const homeReg = homeHist ? isRegressionCandidate(homeHist, config.varianceMinGap) : false;
      const awayReg = awayHist ? isRegressionCandidate(awayHist, config.varianceMinGap) : false;
      if (!homeReg && !awayReg) {
        skipped[lid].variance++;
        continue;
      }
    }

    // Defiance filter
    if (config.defianceFilter) {
      const homeHist = teamHistories[lid]?.[m.homeTeam];
      const awayHist = teamHistories[lid]?.[m.awayTeam];
      const homeDef = homeHist && homeHist.defianceCount >= config.defianceStreak;
      const awayDef = awayHist && awayHist.defianceCount >= config.defianceStreak;
      if (homeDef || awayDef) {
        skipped[lid].defiance++;
        continue;
      }
    }

    const totalGoals = m.homeGoals + m.awayGoals;

    // ─── 1X2 ──────────────────────────────────────────────────────────
    if (pm.closing1X2) {
      const sides = [
        { sel: "Home", mp: pred.probs1X2.home, cp: pm.closing1X2.home, odds: m.pinnacleCloseHome, won: m.homeGoals > m.awayGoals },
        { sel: "Away", mp: pred.probs1X2.away, cp: pm.closing1X2.away, odds: m.pinnacleCloseAway, won: m.awayGoals > m.homeGoals },
        { sel: "Draw", mp: pred.probs1X2.draw, cp: pm.closing1X2.draw, odds: m.pinnacleCloseDraw, won: m.homeGoals === m.awayGoals },
      ];
      for (const s of sides) {
        if (config.noDraws && s.sel === "Draw") continue;
        if (!wantMarket("1X2", s.sel, config.markets)) continue;
        const clv = s.mp - s.cp;
        if (clv <= config.minEdge) continue;
        if (config.maxOdds && s.odds > config.maxOdds) continue;
        bets.push({
          league: lid, season: pm.season, date: m.date,
          homeTeam: m.homeTeam, awayTeam: m.awayTeam,
          marketType: "1X2", selection: s.sel,
          modelProb: s.mp, closingImpliedProb: s.cp,
          clv, closingOdds: s.odds,
          homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
          won: s.won, profit: s.won ? s.odds - 1 : -1,
        });
      }
    }

    // ─── AH ───────────────────────────────────────────────────────────
    if (pm.closingAH && pm.ahLine != null && wantMarket("AH", "", config.markets)) {
      const ahKey = String(pm.ahLine);
      const modelAH = pred.asianHandicap[ahKey];
      if (modelAH) {
        const goalDiff = m.homeGoals - m.awayGoals;
        const ahSides = [
          { sel: `Home AH ${pm.ahLine >= 0 ? "+" : ""}${pm.ahLine}`, mp: modelAH.home, cp: pm.closingAH.prob1, odds: pm.ahHome!, result: goalDiff + pm.ahLine },
          { sel: `Away AH ${-pm.ahLine >= 0 ? "+" : ""}${-pm.ahLine}`, mp: modelAH.away, cp: pm.closingAH.prob2, odds: pm.ahAway!, result: -(goalDiff + pm.ahLine) },
        ];
        for (const s of ahSides) {
          const clv = s.mp - s.cp;
          if (clv <= config.minEdge) continue;
          if (config.maxOdds && s.odds > config.maxOdds) continue;
          const won = s.result > 0;
          const push = s.result === 0;
          bets.push({
            league: lid, season: pm.season, date: m.date,
            homeTeam: m.homeTeam, awayTeam: m.awayTeam,
            marketType: "AH", selection: s.sel,
            modelProb: s.mp, closingImpliedProb: s.cp,
            clv, closingOdds: s.odds,
            homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
            won, profit: push ? 0 : won ? s.odds - 1 : -1,
          });
        }
      }
    }

    // ─── O/U 2.5 ──────────────────────────────────────────────────────
    if (pm.closingOU) {
      const modelOU = pred.overUnder["2.5"];
      if (modelOU) {
        const ouSides = [
          { sel: "Over 2.5", mp: modelOU.over, cp: pm.closingOU.prob1, odds: pm.closeOver!, won: totalGoals > 2.5 },
          { sel: "Under 2.5", mp: modelOU.under, cp: pm.closingOU.prob2, odds: pm.closeUnder!, won: totalGoals < 2.5 },
        ];
        for (const s of ouSides) {
          if (!wantMarket("OU25", s.sel, config.markets)) continue;
          const clv = s.mp - s.cp;
          if (clv <= config.minEdge) continue;
          if (config.maxOdds && s.odds > config.maxOdds) continue;
          bets.push({
            league: lid, season: pm.season, date: m.date,
            homeTeam: m.homeTeam, awayTeam: m.awayTeam,
            marketType: "OU25", selection: s.sel,
            modelProb: s.mp, closingImpliedProb: s.cp,
            clv, closingOdds: s.odds,
            homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
            won: s.won, profit: s.won ? s.odds - 1 : -1,
          });
        }
      }
    }
  }

  return { bets, skipped };
}

// ─── Summary Statistics ─────────────────────────────────────────────────────

export interface BetSummary {
  n: number;
  clv: number;
  roi: number;
  hitRate: number;
  avgOdds: number;
  profit: number;
}

export function summarizeBets(bets: BetRecord[]): BetSummary {
  if (bets.length === 0) return { n: 0, clv: 0, roi: 0, hitRate: 0, avgOdds: 0, profit: 0 };
  const wins = bets.filter(b => b.won).length;
  const totalProfit = bets.reduce((s, b) => s + b.profit, 0);
  return {
    n: bets.length,
    clv: bets.reduce((s, b) => s + b.clv, 0) / bets.length,
    roi: totalProfit / bets.length,
    hitRate: wins / bets.length,
    avgOdds: bets.reduce((s, b) => s + b.closingOdds, 0) / bets.length,
    profit: totalProfit,
  };
}

export function fmtPct(v: number): string {
  const s = (v * 100).toFixed(1);
  return v >= 0 ? `+${s}%` : `${s}%`;
}
