/**
 * Bootstrap Simulation Engine
 *
 * N=5000 resamples → distribution of ROI, CLV, hit rate, max drawdown.
 * Produces 95% CI, p-value (H0: ROI ≤ 0).
 */

import type { BetRecord } from "../signals/types";

export interface BootstrapResult {
  /** Original sample statistic */
  observed: number;
  /** Mean of bootstrap distribution */
  mean: number;
  /** Standard error (std dev of bootstrap distribution) */
  se: number;
  /** 95% confidence interval [lower, upper] */
  ci95: [number, number];
  /** p-value: P(bootstrap stat >= 0 | H0: true mean <= 0) */
  pValue: number;
  /** Full distribution (sorted) */
  distribution: number[];
}

export interface BootstrapReport {
  roi: BootstrapResult;
  clv: BootstrapResult;
  hitRate: BootstrapResult;
  maxDrawdown: BootstrapResult;
  nBets: number;
  nResamples: number;
}

// ─── Core Bootstrap ─────────────────────────────────────────────────────────

/**
 * Simple non-parametric bootstrap (i.i.d. resampling).
 * For bets within the same matchday, use block-bootstrap instead.
 */
export function bootstrap(
  bets: BetRecord[],
  nResamples: number = 5000,
  seed?: number,
): BootstrapReport {
  const n = bets.length;
  if (n === 0) {
    const empty: BootstrapResult = { observed: 0, mean: 0, se: 0, ci95: [0, 0], pValue: 1, distribution: [] };
    return { roi: empty, clv: empty, hitRate: empty, maxDrawdown: empty, nBets: 0, nResamples };
  }

  // Use seeded PRNG for reproducibility
  const rng = createRNG(seed ?? 42);

  const roiDist: number[] = [];
  const clvDist: number[] = [];
  const hitDist: number[] = [];
  const ddDist: number[] = [];

  for (let r = 0; r < nResamples; r++) {
    // Resample with replacement
    const sample: BetRecord[] = [];
    for (let i = 0; i < n; i++) {
      sample.push(bets[Math.floor(rng() * n)]);
    }

    const totalProfit = sample.reduce((s, b) => s + b.profit, 0);
    const roi = totalProfit / sample.length;
    const clv = sample.reduce((s, b) => s + b.clv, 0) / sample.length;
    const hitRate = sample.filter(b => b.won).length / sample.length;
    const dd = computeMaxDrawdown(sample);

    roiDist.push(roi);
    clvDist.push(clv);
    hitDist.push(hitRate);
    ddDist.push(dd);
  }

  const observedROI = bets.reduce((s, b) => s + b.profit, 0) / n;
  const observedCLV = bets.reduce((s, b) => s + b.clv, 0) / n;
  const observedHit = bets.filter(b => b.won).length / n;
  const observedDD = computeMaxDrawdown(bets);

  return {
    roi: computeBootstrapResult(observedROI, roiDist),
    clv: computeBootstrapResult(observedCLV, clvDist),
    hitRate: computeBootstrapResult(observedHit, hitDist),
    maxDrawdown: computeBootstrapResult(observedDD, ddDist),
    nBets: n,
    nResamples,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeBootstrapResult(observed: number, distribution: number[]): BootstrapResult {
  distribution.sort((a, b) => a - b);
  const n = distribution.length;
  const mean = distribution.reduce((s, v) => s + v, 0) / n;
  const variance = distribution.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const se = Math.sqrt(variance);

  // Percentile method for CI
  const ci95Lower = distribution[Math.floor(n * 0.025)];
  const ci95Upper = distribution[Math.floor(n * 0.975)];

  // One-sided p-value: P(stat <= 0)
  const countBelowZero = distribution.filter(v => v <= 0).length;
  const pValue = countBelowZero / n;

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

/** Simple seeded PRNG (xoshiro128**) for reproducibility */
function createRNG(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Grouped Bootstrap ──────────────────────────────────────────────────────

export interface GroupedBootstrapReport {
  group: string;
  report: BootstrapReport;
}

/**
 * Run bootstrap for each group (league or season) in the bets.
 * Returns per-group reports sorted by group name.
 */
export function bootstrapByGroup(
  bets: BetRecord[],
  groupFn: (b: BetRecord) => string,
  nResamples: number = 5000,
  seed?: number,
  minBets: number = 30,
): GroupedBootstrapReport[] {
  const groups = new Map<string, BetRecord[]>();
  for (const b of bets) {
    const key = groupFn(b);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(b);
  }

  const reports: GroupedBootstrapReport[] = [];
  for (const [group, groupBets] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (groupBets.length < minBets) continue;
    reports.push({ group, report: bootstrap(groupBets, nResamples, seed) });
  }
  return reports;
}

export function formatGroupedBootstrap(label: string, reports: GroupedBootstrapReport[]): string {
  const lines: string[] = [];
  lines.push(`  ${label}:`);
  lines.push(`  ${"─".repeat(90)}`);
  lines.push(`  ${"Group".padEnd(16)} ${"N".padStart(5)}  ${"ROI".padStart(8)}  ${"95% CI".padStart(20)}  ${"p-val".padStart(6)}  ${"CLV".padStart(8)}  ${"CLV p".padStart(6)}`);
  lines.push(`  ${"─".repeat(90)}`);

  for (const { group, report } of reports) {
    const roi = report.roi;
    const clv = report.clv;
    const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
    lines.push(
      `  ${group.padEnd(16)} ${String(report.nBets).padStart(5)}  ${fmtPct(roi.observed).padStart(8)}  [${fmtPct(roi.ci95[0])}, ${fmtPct(roi.ci95[1])}]`.padEnd(60) +
      `  p=${roi.pValue.toFixed(3).padStart(5)}  ${fmtPct(clv.observed).padStart(8)}  p=${clv.pValue.toFixed(3).padStart(5)}`
    );
  }
  return lines.join("\n");
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatBootstrapReport(report: BootstrapReport): string {
  const lines: string[] = [];
  lines.push(`  Bootstrap Analysis (n=${report.nBets}, resamples=${report.nResamples}):`);
  lines.push(`  ${"─".repeat(70)}`);
  lines.push(formatResult("ROI", report.roi, true));
  lines.push(formatResult("CLV", report.clv, true));
  lines.push(formatResult("Hit Rate", report.hitRate, true));
  lines.push(formatResult("Max Drawdown", report.maxDrawdown, false));
  return lines.join("\n");
}

function formatResult(label: string, r: BootstrapResult, isPct: boolean): string {
  const fmt = (v: number) => isPct ? `${(v * 100).toFixed(1)}%` : v.toFixed(1);
  const sign = (v: number) => v >= 0 ? "+" : "";
  return `  ${label.padEnd(15)} ${sign(r.observed)}${fmt(r.observed).padStart(7)}  [95% CI: ${sign(r.ci95[0])}${fmt(r.ci95[0])}, ${sign(r.ci95[1])}${fmt(r.ci95[1])}]  p=${r.pValue.toFixed(3)}  SE=${fmt(r.se)}`;
}
