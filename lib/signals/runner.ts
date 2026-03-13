/**
 * Signal Runner — Execute signals against backtest data
 *
 * Loads data once, applies a named signal, produces BetRecord[].
 * Used by test-signal.ts and alpha-decomposition.ts.
 */

import type { Signal, SignalInput, BetRecord, MatchOdds, MatchData } from "./types";
import type { PrecomputedMatch, LoadedData } from "../backtest/data-loader";
import type { TeamHistory } from "../mi-picks/ted-filters";
import { evaluateBets, type EvalConfig, DEFAULT_EVAL_CONFIG } from "../backtest/bet-evaluator";

// ─── Built-in Signals ───────────────────────────────────────────────────────

/** Base signal: Ted filters (variance + congestion + defiance + early skip) */
export const tedBaseSignal: Signal = {
  id: "ted-base",
  description: "Ted Knutson variance betting filters: regression candidates + congestion + defiance + early skip",
  evaluate: (input: SignalInput) => {
    // This is implemented via evaluateBets config, not per-match logic
    // Return score=1 always — the filtering is handled at the evaluator level
    return { score: 1, shouldBet: true };
  },
};

/** Odds cap signal — filter by max odds */
export const oddsCap20Signal: Signal = {
  id: "odds-cap-2.0",
  description: "Cap maximum odds at 2.0",
  evaluate: (input: SignalInput) => {
    const maxOdds = 2.0;
    const odds = [
      input.odds.pinnacleCloseHome,
      input.odds.pinnacleCloseAway,
      input.odds.pinnacleCloseDraw,
      input.odds.pinnacleCloseAHHome,
      input.odds.pinnacleCloseAHAway,
      input.odds.pinnacleCloseOver25,
      input.odds.pinnacleCloseUnder25,
    ].filter(Boolean);
    // This signal is about odds filtering, applied at bet level not match level
    return { score: 1, shouldBet: true, meta: { maxOdds } };
  },
};

/** Variance regression signal — only bet when xG diverges from actual goals */
export const varianceRegressionSignal: Signal = {
  id: "variance-regression",
  description: "Only bet regression candidates (xG divergence >= gap threshold over lookback window)",
  defaultParams: { varianceMinGap: 3.0, lookback: 10 },
  evaluate: (input: SignalInput) => {
    const gap = input.prediction.expectedGoals?.home ?? 0; // placeholder
    const homeHist = input.teamHistory[input.match.homeTeam];
    const awayHist = input.teamHistory[input.match.awayTeam];

    const checkRegression = (hist: TeamHistory | undefined, minGap: number): { isCandidate: boolean; gfGap: number; gaGap: number } => {
      if (!hist || hist.matches.length < 10) return { isCandidate: false, gfGap: 0, gaGap: 0 };
      const recent = hist.matches.slice(-10);
      const gaGap = recent.reduce((s, m) => s + (m.actualGA - m.expectedGA), 0);
      const gfGap = recent.reduce((s, m) => s + (m.actualGF - m.expectedGF), 0);
      return { isCandidate: Math.abs(gaGap) >= minGap || Math.abs(gfGap) >= minGap, gfGap, gaGap };
    };

    const homeReg = checkRegression(homeHist, 3.0);
    const awayReg = checkRegression(awayHist, 3.0);
    const isCandidate = homeReg.isCandidate || awayReg.isCandidate;

    return {
      score: isCandidate ? Math.max(
        Math.abs(homeReg.gaGap) + Math.abs(homeReg.gfGap),
        Math.abs(awayReg.gaGap) + Math.abs(awayReg.gfGap),
      ) / 10 : 0,
      shouldBet: isCandidate,
      meta: { homeGfGap: homeReg.gfGap, homeGaGap: homeReg.gaGap, awayGfGap: awayReg.gfGap, awayGaGap: awayReg.gaGap },
    };
  },
};

/** Congestion signal — skip teams with fixture congestion */
export const congestionSignal: Signal = {
  id: "congestion-filter",
  description: "Skip matches where either team plays 3+ times in 8 days",
  evaluate: (input: SignalInput) => {
    const checkCongestion = (team: string): boolean => {
      const dates = input.teamMatchDates[team] || [];
      const cutoff = new Date(new Date(input.match.date).getTime() - 8 * 86400000).toISOString().split("T")[0];
      const recentCount = dates.filter(d => d >= cutoff && d < input.match.date).length;
      return recentCount >= 2;
    };
    const congested = checkCongestion(input.match.homeTeam) || checkCongestion(input.match.awayTeam);
    return { score: congested ? 0 : 1, shouldBet: !congested };
  },
};

/** Defiance signal — skip teams persistently defying model */
export const defianceSignal: Signal = {
  id: "defiance-filter",
  description: "Skip teams with 10+ consecutive matches defying model direction",
  defaultParams: { streak: 10 },
  evaluate: (input: SignalInput) => {
    const homeHist = input.teamHistory[input.match.homeTeam];
    const awayHist = input.teamHistory[input.match.awayTeam];
    const homeDef = homeHist && homeHist.defianceCount >= 10;
    const awayDef = awayHist && awayHist.defianceCount >= 10;
    return { score: (homeDef || awayDef) ? 0 : 1, shouldBet: !(homeDef || awayDef) };
  },
};

// ─── Signal Registry ────────────────────────────────────────────────────────

const BUILT_IN_SIGNALS: Signal[] = [
  tedBaseSignal,
  oddsCap20Signal,
  varianceRegressionSignal,
  congestionSignal,
  defianceSignal,
];

export function getSignal(id: string): Signal | null {
  return BUILT_IN_SIGNALS.find(s => s.id === id) || null;
}

export function listSignals(): Signal[] {
  return [...BUILT_IN_SIGNALS];
}

// ─── Run Signal Against Data ────────────────────────────────────────────────

export interface RunResult {
  signalId: string;
  bets: BetRecord[];
  config: EvalConfig;
  runtime: number;
}

/**
 * Run eval using xG-based team histories for the variance filter.
 * This tests the "real xG" version of Ted's variance signal.
 */
export function runBaseEvalXG(
  data: LoadedData,
  configOverrides: Partial<EvalConfig> = {},
): RunResult {
  const config: EvalConfig = { ...DEFAULT_EVAL_CONFIG, ...configOverrides };
  const start = Date.now();

  // Use xG-based team histories instead of model-based
  const { bets } = evaluateBets(
    data.precomputed,
    data.teamHistoriesXG,
    data.teamMatchDates,
    config,
  );

  return {
    signalId: "ted-base-xg",
    bets,
    config,
    runtime: Date.now() - start,
  };
}

/**
 * Run the base eval (Ted filters) and produce bets.
 * This is the workhorse — all signal testing builds on this.
 */
export function runBaseEval(
  data: LoadedData,
  configOverrides: Partial<EvalConfig> = {},
): RunResult {
  const config: EvalConfig = { ...DEFAULT_EVAL_CONFIG, ...configOverrides };
  const start = Date.now();

  const { bets } = evaluateBets(
    data.precomputed,
    data.teamHistories,
    data.teamMatchDates,
    config,
  );

  return {
    signalId: "ted-base",
    bets,
    config,
    runtime: Date.now() - start,
  };
}

/**
 * Run eval with a specific signal disabled (for leave-one-out).
 * Maps signal IDs to EvalConfig changes.
 */
export function runWithoutSignal(
  data: LoadedData,
  signalId: string,
  baseConfig: Partial<EvalConfig> = {},
): RunResult {
  const overrides: Partial<EvalConfig> = { ...baseConfig };

  switch (signalId) {
    case "variance-regression":
      overrides.varianceFilter = false;
      break;
    case "congestion-filter":
      overrides.congestionFilter = false;
      break;
    case "defiance-filter":
      overrides.defianceFilter = false;
      break;
    case "odds-cap-2.0":
      overrides.maxOdds = 99;
      break;
    default:
      // Unknown signal — run base unchanged
      break;
  }

  const config: EvalConfig = { ...DEFAULT_EVAL_CONFIG, ...overrides };
  const start = Date.now();

  const { bets } = evaluateBets(
    data.precomputed,
    data.teamHistories,
    data.teamMatchDates,
    config,
  );

  return {
    signalId: `without-${signalId}`,
    bets,
    config,
    runtime: Date.now() - start,
  };
}

/**
 * Run eval with ONLY a specific signal enabled (for standalone).
 */
export function runStandaloneSignal(
  data: LoadedData,
  signalId: string,
  baseConfig: Partial<EvalConfig> = {},
): RunResult {
  // Start with all filters off
  const overrides: Partial<EvalConfig> = {
    ...baseConfig,
    varianceFilter: false,
    congestionFilter: false,
    defianceFilter: false,
    maxOdds: 99,
    noDraws: false,
  };

  // Enable only the target signal
  switch (signalId) {
    case "variance-regression":
      overrides.varianceFilter = true;
      break;
    case "congestion-filter":
      overrides.congestionFilter = true;
      break;
    case "defiance-filter":
      overrides.defianceFilter = true;
      break;
    case "odds-cap-2.0":
      overrides.maxOdds = 2.0;
      break;
    case "no-draws":
      overrides.noDraws = true;
      break;
    case "ted-base":
      // All filters on
      overrides.varianceFilter = true;
      overrides.congestionFilter = true;
      overrides.defianceFilter = true;
      overrides.maxOdds = 2.0;
      overrides.noDraws = true;
      break;
    default:
      break;
  }

  const config: EvalConfig = { ...DEFAULT_EVAL_CONFIG, ...overrides };
  const start = Date.now();

  const { bets } = evaluateBets(
    data.precomputed,
    data.teamHistories,
    data.teamMatchDates,
    config,
  );

  return {
    signalId,
    bets,
    config,
    runtime: Date.now() - start,
  };
}
