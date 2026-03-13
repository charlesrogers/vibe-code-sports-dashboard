/**
 * Permutation Test — Null distribution for significance testing
 *
 * Tests: "Does the model's bet selection add value?"
 * Null hypothesis: the model has no edge in selecting which matches to bet on.
 *
 * Method: Given N bets actually placed and a pool of M total matches the model
 * could have bet on, we randomly select N matches from the pool. This breaks the
 * model→bet association while preserving the market structure.
 *
 * When no pool is provided, falls back to shuffling CLV assignments across bets
 * (breaks which bets had positive vs negative CLV).
 */

import type { BetRecord } from "../signals/types";

export interface PermutationResult {
  /** Observed test statistic */
  observed: number;
  /** p-value: fraction of permutations >= observed */
  pValue: number;
  /** Mean of null distribution */
  nullMean: number;
  /** Std dev of null distribution */
  nullStd: number;
  /** Z-score: (observed - nullMean) / nullStd */
  zScore: number;
  /** Number of permutations */
  nPermutations: number;
}

/**
 * Permutation test for ROI significance.
 *
 * If a pool of all potential bets is provided, tests whether the model's
 * selection from that pool produces better ROI than random selection.
 * If no pool is provided, shuffles profit outcomes across bets to test
 * whether the match-to-profit assignment matters.
 */
export function permutationTestROI(
  bets: BetRecord[],
  nPermutations: number = 5000,
  seed?: number,
  /** Pool of ALL potential bets (placed + not placed). If provided, uses selection-shuffle. */
  pool?: BetRecord[],
): PermutationResult {
  const n = bets.length;
  if (n === 0) {
    return { observed: 0, pValue: 1, nullMean: 0, nullStd: 0, zScore: 0, nPermutations };
  }

  const rng = createRNG(seed ?? 42);

  // Observed ROI
  const observedProfit = bets.reduce((s, b) => s + b.profit, 0);
  const observedROI = observedProfit / n;

  const nullDist: number[] = [];

  if (pool && pool.length >= n) {
    // ─── Selection-shuffle method (correct null) ──────────────────────
    // Randomly select N bets from the full pool. This tests whether the
    // model's bet selection adds value vs random bet selection.
    for (let r = 0; r < nPermutations; r++) {
      // Fisher-Yates partial shuffle to pick N items from pool
      const indices = Array.from({ length: pool.length }, (_, i) => i);
      for (let i = 0; i < n; i++) {
        const j = i + Math.floor(rng() * (indices.length - i));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      let profit = 0;
      for (let i = 0; i < n; i++) {
        profit += pool[indices[i]].profit;
      }
      nullDist.push(profit / n);
    }
  } else {
    // ─── Profit-shuffle fallback ──────────────────────────────────────
    // Shuffle profit values across bets (breaks match→profit association).
    const profits = bets.map(b => b.profit);

    for (let r = 0; r < nPermutations; r++) {
      const shuffled = [...profits];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      nullDist.push(shuffled.reduce((s, v) => s + v, 0) / n);
    }
  }

  // p-value: fraction of null dist >= observed
  const countAbove = nullDist.filter(v => v >= observedROI).length;
  const pValue = countAbove / nPermutations;

  const nullMean = nullDist.reduce((s, v) => s + v, 0) / nPermutations;
  const nullVariance = nullDist.reduce((s, v) => s + (v - nullMean) ** 2, 0) / (nPermutations - 1);
  const nullStd = Math.sqrt(nullVariance);
  const zScore = nullStd > 0 ? (observedROI - nullMean) / nullStd : 0;

  return {
    observed: observedROI,
    pValue,
    nullMean,
    nullStd,
    zScore,
    nPermutations,
  };
}

/**
 * Permutation test for CLV significance.
 */
export function permutationTestCLV(
  bets: BetRecord[],
  nPermutations: number = 5000,
  seed?: number,
): PermutationResult {
  const n = bets.length;
  if (n === 0) {
    return { observed: 0, pValue: 1, nullMean: 0, nullStd: 0, zScore: 0, nPermutations };
  }

  const rng = createRNG(seed ?? 42);

  const observedCLV = bets.reduce((s, b) => s + b.clv, 0) / n;
  const clvValues = bets.map(b => b.clv);

  const nullDist: number[] = [];

  for (let r = 0; r < nPermutations; r++) {
    // Shuffle CLV values across bets (breaks signal-CLV association)
    const shuffled = [...clvValues];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    nullDist.push(shuffled.reduce((s, v) => s + v, 0) / n);
  }

  const countAbove = nullDist.filter(v => v >= observedCLV).length;
  const pValue = countAbove / nPermutations;
  const nullMean = nullDist.reduce((s, v) => s + v, 0) / nPermutations;
  const nullVariance = nullDist.reduce((s, v) => s + (v - nullMean) ** 2, 0) / (nPermutations - 1);
  const nullStd = Math.sqrt(nullVariance);
  const zScore = nullStd > 0 ? (observedCLV - nullMean) / nullStd : 0;

  return { observed: observedCLV, pValue, nullMean, nullStd, zScore, nPermutations };
}

function createRNG(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatPermutationResult(label: string, r: PermutationResult): string {
  const fmtPct = (v: number) => `${(v * 100).toFixed(1)}%`;
  return `  ${label.padEnd(8)} observed=${r.observed >= 0 ? "+" : ""}${fmtPct(r.observed)}  p=${r.pValue.toFixed(3)}  z=${r.zScore.toFixed(2)}  null μ=${fmtPct(r.nullMean)}  null σ=${fmtPct(r.nullStd)}`;
}
