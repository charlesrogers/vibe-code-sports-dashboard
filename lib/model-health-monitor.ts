/**
 * Model Health Monitor — CLV×P&L quadrant analysis
 *
 * The stop/go signal. Takes settled paper bets, returns a health report
 * that tells Charles whether the model is good enough to bet.
 *
 * Quadrants:
 *   GREEN  = CLV > 0 && P&L > 0 → "Edge confirmed by results"
 *   YELLOW = CLV > 0 && P&L ≤ 0 → "Variance — keep betting"
 *   ORANGE = CLV ≤ 0 && P&L > 0 → "Lucky — reduce stakes"
 *   RED    = CLV ≤ 0 && P&L ≤ 0 → "Stop betting"
 */

import type { PaperBet } from "./paper-trade/types";
import { computeStats } from "./paper-trade/stats";
import { detectDrift } from "./paper-trade/drift-detector";

// ─── Interfaces ──────────────────────────────────────────────────────────────

export type Quadrant = "GREEN" | "YELLOW" | "ORANGE" | "RED";

export interface ModelHealthReport {
  quadrant: Quadrant;
  quadrantLabel: string;
  summary: string;
  clv: {
    mean: number;
    std: number;
    tStat: number;
    pValue: number;
    n: number;
    ci95: [number, number];
    isSignificant: boolean;
  };
  pnl: {
    actual: number;
    expected: number;
    shortfallZ: number;
    shortfallProb: number;
  };
  redFlags: {
    type: "clv_negative_streak" | "clv_declining" | "league_divergence" | "insufficient_sample";
    message: string;
    severity: "info" | "warning" | "critical";
  }[];
  diagnostics: {
    byLeague: Record<string, { n: number; clv: number; roi: number }>;
    byMarket: Record<string, { n: number; clv: number; roi: number }>;
    byOddsBucket: { label: string; n: number; clv: number; roi: number }[];
    clvTrend: { slope: number; isDecaying: boolean };
    staleRatings: boolean;
    pipelineIssues: string[];
  } | null;
}

// ─── Statistical helpers ─────────────────────────────────────────────────────

/** Approximate two-sided p-value from t statistic using normal approximation */
function twoSidedPValue(tStat: number, _df: number): number {
  // Normal CDF approximation (Abramowitz & Stegun 26.2.17)
  const x = Math.abs(tStat);
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989422804014327; // 1/sqrt(2pi)
  const p = d * Math.exp(-x * x / 2) *
    (t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
  return 2 * p;
}

/** Normal CDF approximation */
function normalCDF(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327;
  const p = d * Math.exp(-x * x / 2) *
    (t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429)))));
  return x >= 0 ? 1 - p : p;
}

/** Simple linear regression: returns slope */
function linearSlope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += ys[i];
    sumXY += i * ys[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

// ─── Core Monitor ────────────────────────────────────────────────────────────

export function computeModelHealth(bets: PaperBet[]): ModelHealthReport {
  const activeBets = bets.filter(b => b.status !== "superseded");
  const settled = activeBets.filter(b => b.status !== "pending");
  const withCLV = settled.filter(b => b.clv != null);

  // ── CLV statistics ──
  const n = withCLV.length;
  const clvValues = withCLV.map(b => b.clv!);
  const clvMean = n > 0 ? clvValues.reduce((s, v) => s + v, 0) / n : 0;
  const clvVariance = n > 1
    ? clvValues.reduce((s, v) => s + (v - clvMean) ** 2, 0) / (n - 1)
    : 0;
  const clvStd = Math.sqrt(clvVariance);
  const se = n > 0 ? clvStd / Math.sqrt(n) : 1;
  const tStat = se > 0 ? clvMean / se : 0;
  const pValue = n > 2 ? twoSidedPValue(tStat, n - 1) : 1;
  const ci95Lower = clvMean - 1.96 * se;
  const ci95Upper = clvMean + 1.96 * se;

  // ── P&L statistics ──
  const totalProfit = settled.reduce((s, b) => s + (b.profit || 0), 0);
  const perBetProfits = settled.map(b => (b.profit || 0));
  const expectedProfit = withCLV.reduce((s, b) => {
    const clv = b.clv || 0;
    const odds = b.marketOdds || 2;
    const stake = b.stake || 20;
    return s + clv * (odds - 1) * stake;
  }, 0);

  // Shortfall z-score
  const profitStd = perBetProfits.length > 1
    ? Math.sqrt(perBetProfits.reduce((s, p) => {
        const mean = totalProfit / perBetProfits.length;
        return s + (p - mean) ** 2;
      }, 0) / (perBetProfits.length - 1))
    : 1;
  const shortfallSE = profitStd * Math.sqrt(perBetProfits.length);
  const shortfallZ = shortfallSE > 0 ? (totalProfit - expectedProfit) / shortfallSE : 0;
  const shortfallProb = normalCDF(shortfallZ);

  // ── Quadrant ──
  const clvPositive = clvMean > 0;
  const pnlPositive = totalProfit > 0;

  let quadrant: Quadrant;
  let quadrantLabel: string;
  if (clvPositive && pnlPositive) {
    quadrant = "GREEN";
    quadrantLabel = "Edge confirmed by results";
  } else if (clvPositive && !pnlPositive) {
    quadrant = "YELLOW";
    quadrantLabel = "Variance — keep betting";
  } else if (!clvPositive && pnlPositive) {
    quadrant = "ORANGE";
    quadrantLabel = "Lucky — reduce stakes, investigate";
  } else {
    quadrant = "RED";
    quadrantLabel = "Stop betting — model is mispricing";
  }

  // ── Red flags ──
  const redFlags: ModelHealthReport["redFlags"] = [];

  // Insufficient sample
  if (n < 100) {
    redFlags.push({
      type: "insufficient_sample",
      message: `${n} bets with CLV data — need ~300 for reliable significance`,
      severity: "info",
    });
  }

  // CLV negative streak by ISO week
  if (withCLV.length >= 21) { // at least 3 weeks of data
    const weeklyMap = new Map<string, number[]>();
    for (const b of withCLV) {
      const d = new Date(b.matchDate);
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
      const key = `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
      if (!weeklyMap.has(key)) weeklyMap.set(key, []);
      weeklyMap.get(key)!.push(b.clv!);
    }
    const weeklyAvgs = [...weeklyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, vals]) => vals.reduce((s, v) => s + v, 0) / vals.length);

    // Check for 3+ consecutive negative weeks
    let negStreak = 0;
    let maxNegStreak = 0;
    for (const avg of weeklyAvgs) {
      if (avg < 0) { negStreak++; maxNegStreak = Math.max(maxNegStreak, negStreak); }
      else { negStreak = 0; }
    }
    if (maxNegStreak >= 3) {
      redFlags.push({
        type: "clv_negative_streak",
        message: `${maxNegStreak} consecutive weeks of negative CLV`,
        severity: "critical",
      });
    }

    // CLV declining (linear regression on weekly averages)
    const slope = linearSlope(weeklyAvgs);
    if (slope < -0.005) { // -0.5% per week
      redFlags.push({
        type: "clv_declining",
        message: `CLV declining ${(slope * 100).toFixed(2)}%/week — monitor for edge decay`,
        severity: "warning",
      });
    }
  }

  // League divergence
  const stats = computeStats(bets);
  const leagueEntries = Object.entries(stats.byLeague).filter(([, v]) => v.n >= 5);
  if (leagueEntries.length >= 2) {
    const clvs = leagueEntries.map(([, v]) => v.clv);
    const maxCLV = Math.max(...clvs);
    const minCLV = Math.min(...clvs);
    if (maxCLV - minCLV > 5) { // 5% divergence
      const worst = leagueEntries.reduce((a, b) => a[1].clv < b[1].clv ? a : b);
      redFlags.push({
        type: "league_divergence",
        message: `League CLV divergence: ${(maxCLV - minCLV).toFixed(1)}pp — ${worst[0]} underperforming at ${worst[1].clv.toFixed(1)}%`,
        severity: "warning",
      });
    }
  }

  // ── Diagnostics (populated for ORANGE/RED) ──
  let diagnostics: ModelHealthReport["diagnostics"] = null;
  if (quadrant === "ORANGE" || quadrant === "RED") {
    // Odds bucket analysis
    const buckets = [
      { label: "1.0-1.3", min: 1.0, max: 1.3 },
      { label: "1.3-1.5", min: 1.3, max: 1.5 },
      { label: "1.5-1.7", min: 1.5, max: 1.7 },
      { label: "1.7-2.0", min: 1.7, max: 2.0 },
    ];
    const byOddsBucket = buckets.map(({ label, min, max }) => {
      const inBucket = settled.filter(b => b.marketOdds >= min && b.marketOdds < max);
      const bucketCLV = inBucket.filter(b => b.clv != null);
      const avgCLV = bucketCLV.length > 0
        ? bucketCLV.reduce((s, b) => s + (b.clv || 0), 0) / bucketCLV.length * 100
        : 0;
      const profit = inBucket.reduce((s, b) => s + (b.profit || 0), 0);
      const staked = inBucket.reduce((s, b) => s + (b.stake || 20), 0);
      return {
        label,
        n: inBucket.length,
        clv: Math.round(avgCLV * 100) / 100,
        roi: staked > 0 ? Math.round(profit / staked * 10000) / 100 : 0,
      };
    });

    // CLV trend (weekly)
    const weeklyMap = new Map<string, number[]>();
    for (const b of withCLV) {
      const d = new Date(b.matchDate);
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
      const key = `${d.getFullYear()}-W${String(week).padStart(2, "0")}`;
      if (!weeklyMap.has(key)) weeklyMap.set(key, []);
      weeklyMap.get(key)!.push(b.clv!);
    }
    const weeklyAvgs = [...weeklyMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, vals]) => vals.reduce((s, v) => s + v, 0) / vals.length);
    const slope = linearSlope(weeklyAvgs);

    // Stale ratings check
    const latestBetDate = settled.length > 0
      ? new Date(Math.max(...settled.map(b => new Date(b.matchDate).getTime())))
      : new Date();
    const oldestAcceptable = new Date(latestBetDate.getTime() - 14 * 86400000);
    const staleRatings = settled.length > 0 &&
      new Date(settled[settled.length - 1].createdAt) < oldestAcceptable;

    // Pipeline issues from drift detector
    const drift = detectDrift(bets);
    const pipelineIssues = drift.actions;

    diagnostics = {
      byLeague: Object.fromEntries(
        Object.entries(stats.byLeague).map(([k, v]) => [k, { n: v.n, clv: v.clv, roi: v.roi }])
      ),
      byMarket: Object.fromEntries(
        Object.entries(stats.byMarketType).map(([k, v]) => [k, { n: v.n, clv: v.clv, roi: v.roi }])
      ),
      byOddsBucket,
      clvTrend: { slope: Math.round(slope * 10000) / 10000, isDecaying: slope < -0.005 },
      staleRatings,
      pipelineIssues,
    };
  }

  // ── Summary ──
  const clvPct = (clvMean * 100).toFixed(1);
  const pValueStr = pValue < 0.001 ? "<0.001" : pValue.toFixed(3);
  let summary: string;
  if (n === 0) {
    summary = "No settled bets with CLV data yet.";
  } else if (quadrant === "GREEN") {
    summary = `CLV +${clvPct}% across ${n} bets (p=${pValueStr}), P&L +${totalProfit.toFixed(1)}u — edge is real.`;
  } else if (quadrant === "YELLOW") {
    summary = `CLV +${clvPct}% is positive but P&L is ${totalProfit.toFixed(1)}u — variance, not model failure.`;
  } else if (quadrant === "ORANGE") {
    summary = `P&L is positive but CLV is ${clvPct}% — running hot, reduce stakes.`;
  } else {
    summary = `CLV ${clvPct}% and P&L ${totalProfit.toFixed(1)}u — stop betting until model is fixed.`;
  }

  return {
    quadrant,
    quadrantLabel,
    summary,
    clv: {
      mean: Math.round(clvMean * 10000) / 10000,
      std: Math.round(clvStd * 10000) / 10000,
      tStat: Math.round(tStat * 1000) / 1000,
      pValue: Math.round(pValue * 10000) / 10000,
      n,
      ci95: [Math.round(ci95Lower * 10000) / 10000, Math.round(ci95Upper * 10000) / 10000],
      isSignificant: pValue < 0.05,
    },
    pnl: {
      actual: Math.round(totalProfit * 100) / 100,
      expected: Math.round(expectedProfit * 100) / 100,
      shortfallZ: Math.round(shortfallZ * 1000) / 1000,
      shortfallProb: Math.round(shortfallProb * 10000) / 10000,
    },
    redFlags,
    diagnostics,
  };
}
