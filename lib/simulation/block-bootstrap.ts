/**
 * Block Bootstrap — Resample in matchday blocks
 *
 * Preserves autocorrelation: same-day bets share solver params
 * and market conditions. More conservative CIs than i.i.d. bootstrap.
 */

import type { BetRecord } from "../signals/types";
import type { BootstrapReport, BootstrapResult } from "./bootstrap";

/**
 * Block bootstrap: resample entire matchdays instead of individual bets.
 * This preserves within-day correlation structure.
 */
export function blockBootstrap(
  bets: BetRecord[],
  nResamples: number = 5000,
  seed?: number,
): BootstrapReport {
  if (bets.length === 0) {
    const empty: BootstrapResult = { observed: 0, mean: 0, se: 0, ci95: [0, 0], pValue: 1, distribution: [] };
    return { roi: empty, clv: empty, hitRate: empty, maxDrawdown: empty, nBets: 0, nResamples };
  }

  // Group bets by matchday
  const blocks = new Map<string, BetRecord[]>();
  for (const b of bets) {
    const key = b.date;
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key)!.push(b);
  }

  const blockArray = [...blocks.values()];
  const nBlocks = blockArray.length;

  const rng = createRNG(seed ?? 42);

  const roiDist: number[] = [];
  const clvDist: number[] = [];
  const hitDist: number[] = [];
  const ddDist: number[] = [];

  for (let r = 0; r < nResamples; r++) {
    // Resample blocks with replacement
    const sample: BetRecord[] = [];
    for (let i = 0; i < nBlocks; i++) {
      const block = blockArray[Math.floor(rng() * nBlocks)];
      sample.push(...block);
    }

    if (sample.length === 0) continue;

    const totalProfit = sample.reduce((s, b) => s + b.profit, 0);
    roiDist.push(totalProfit / sample.length);
    clvDist.push(sample.reduce((s, b) => s + b.clv, 0) / sample.length);
    hitDist.push(sample.filter(b => b.won).length / sample.length);
    ddDist.push(computeMaxDrawdown(sample));
  }

  const n = bets.length;
  const observedROI = bets.reduce((s, b) => s + b.profit, 0) / n;
  const observedCLV = bets.reduce((s, b) => s + b.clv, 0) / n;
  const observedHit = bets.filter(b => b.won).length / n;
  const observedDD = computeMaxDrawdown(bets);

  return {
    roi: computeResult(observedROI, roiDist),
    clv: computeResult(observedCLV, clvDist),
    hitRate: computeResult(observedHit, hitDist),
    maxDrawdown: computeResult(observedDD, ddDist),
    nBets: n,
    nResamples,
  };
}

function computeResult(observed: number, distribution: number[]): BootstrapResult {
  distribution.sort((a, b) => a - b);
  const n = distribution.length;
  if (n === 0) return { observed, mean: 0, se: 0, ci95: [0, 0], pValue: 1, distribution: [] };

  const mean = distribution.reduce((s, v) => s + v, 0) / n;
  const variance = distribution.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(n - 1, 1);
  const se = Math.sqrt(variance);
  const ci95Lower = distribution[Math.floor(n * 0.025)];
  const ci95Upper = distribution[Math.floor(n * 0.975)];
  const pValue = distribution.filter(v => v <= 0).length / n;

  return { observed, mean, se, ci95: [ci95Lower, ci95Upper], pValue, distribution };
}

function computeMaxDrawdown(bets: BetRecord[]): number {
  let cumProfit = 0;
  let peak = 0;
  let maxDD = 0;
  for (const b of bets) {
    cumProfit += b.profit;
    if (cumProfit > peak) peak = cumProfit;
    const dd = peak - cumProfit;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
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
