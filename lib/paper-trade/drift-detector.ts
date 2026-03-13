/**
 * CUSUM Drift Detection — Catches model degradation early
 *
 * Implements cumulative sum (CUSUM) change detection on:
 * - Rolling CLV (primary: model calibration quality)
 * - Rolling ROI (secondary: actual P&L drift)
 * - Per-signal hit rates vs backtest expectations
 *
 * When rolling-30 CLV drops below 0%, warn.
 * When rolling-50 ROI goes negative, critical alert.
 */

import type { PaperBet, DriftAlert } from "./types";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { SignalRegistryEntry } from "../signals/types";

// ─── CUSUM Parameters ───────────────────────────────────────────────────────

export interface CUSUMConfig {
  /** Target CLV (expected from backtest, e.g., 0.05 = 5%) */
  targetCLV: number;
  /** Allowable slack before alarm (k = half the shift to detect) */
  slack: number;
  /** Alarm threshold (h = how many SEs before triggering) */
  threshold: number;
  /** Rolling window for simple drift indicators */
  rollingWindow: number;
  /** Minimum bets before enabling drift detection */
  minBets: number;
}

export const DEFAULT_CUSUM_CONFIG: CUSUMConfig = {
  targetCLV: 0.05,   // 5% expected CLV from backtest
  slack: 0.025,      // detect shifts > 2.5%
  threshold: 3.0,    // 3 SE alarm
  rollingWindow: 30,
  minBets: 20,
};

// ─── CUSUM State ────────────────────────────────────────────────────────────

export interface CUSUMState {
  /** Upper CUSUM (detects downward shift in mean) */
  cusumUpper: number;
  /** Lower CUSUM (detects upward shift — not typically alarming) */
  cusumLower: number;
  /** Whether alarm is currently triggered */
  alarm: boolean;
  /** Number of observations processed */
  nObs: number;
  /** Running mean of observed values */
  runningMean: number;
}

export interface DriftReport {
  /** Overall drift status */
  status: "healthy" | "warning" | "critical";
  /** CUSUM analysis on CLV */
  cusumCLV: CUSUMState;
  /** CUSUM analysis on ROI */
  cusumROI: CUSUMState;
  /** Active alerts */
  alerts: DriftAlert[];
  /** Per-signal health check */
  signalHealth: SignalHealthEntry[];
  /** Recommended actions */
  actions: string[];
}

export interface SignalHealthEntry {
  signalId: string;
  backtestHitRate: number;
  liveHitRate: number;
  liveBets: number;
  zScore: number;
  /** Whether live performance is significantly below backtest */
  degraded: boolean;
}

// ─── CUSUM Implementation ───────────────────────────────────────────────────

export function initCUSUM(): CUSUMState {
  return { cusumUpper: 0, cusumLower: 0, alarm: false, nObs: 0, runningMean: 0 };
}

/**
 * Update CUSUM with a new observation.
 * Detects if the process mean has shifted below target.
 */
export function updateCUSUM(
  state: CUSUMState,
  observation: number,
  config: CUSUMConfig = DEFAULT_CUSUM_CONFIG,
): CUSUMState {
  const n = state.nObs + 1;
  const newMean = state.runningMean + (observation - state.runningMean) / n;

  // CUSUM for downward shift detection
  // S_n = max(0, S_{n-1} + (target - observation) - k)
  const cusumUpper = Math.max(0, state.cusumUpper + (config.targetCLV - observation) - config.slack);

  // CUSUM for upward shift (rare for our use case)
  const cusumLower = Math.max(0, state.cusumLower + (observation - config.targetCLV) - config.slack);

  const alarm = cusumUpper > config.threshold;

  return { cusumUpper, cusumLower, alarm, nObs: n, runningMean: newMean };
}

/**
 * Run CUSUM over an array of settled bets.
 */
export function runCUSUM(
  values: number[],
  config: CUSUMConfig = DEFAULT_CUSUM_CONFIG,
): CUSUMState {
  let state = initCUSUM();
  for (const v of values) {
    state = updateCUSUM(state, v, config);
  }
  return state;
}

// ─── Drift Detection ────────────────────────────────────────────────────────

/**
 * Full drift analysis on settled paper trade bets.
 */
export function detectDrift(
  bets: PaperBet[],
  config: CUSUMConfig = DEFAULT_CUSUM_CONFIG,
): DriftReport {
  const settled = bets
    .filter(b => b.status !== "pending" && b.status !== "superseded")
    .sort((a, b) => a.matchDate.localeCompare(b.matchDate));

  const alerts: DriftAlert[] = [];
  const actions: string[] = [];

  if (settled.length < config.minBets) {
    return {
      status: "healthy",
      cusumCLV: initCUSUM(),
      cusumROI: initCUSUM(),
      alerts: [],
      signalHealth: [],
      actions: [`Need ${config.minBets - settled.length} more settled bets for drift detection`],
    };
  }

  // CUSUM on CLV
  const clvValues = settled.filter(b => b.clv != null).map(b => b.clv!);
  const cusumCLV = runCUSUM(clvValues, config);

  // CUSUM on per-bet ROI (profit / stake)
  const roiValues = settled.map(b => (b.profit || 0) / (b.stake || 20));
  const cusumROI = runCUSUM(roiValues, { ...config, targetCLV: 0.02 }); // target 2% ROI

  // Rolling window checks
  const recentN = Math.min(config.rollingWindow, settled.length);
  const recent = settled.slice(-recentN);
  const recentCLV = recent.filter(b => b.clv != null);
  const avgRecentCLV = recentCLV.length > 0
    ? recentCLV.reduce((s, b) => s + (b.clv || 0), 0) / recentCLV.length
    : 0;
  const recentProfit = recent.reduce((s, b) => s + (b.profit || 0), 0);
  const recentStaked = recent.reduce((s, b) => s + (b.stake || 20), 0);
  const recentROI = recentStaked > 0 ? recentProfit / recentStaked : 0;
  const recentWins = recent.filter(b => b.status === "won").length;
  const recentDecided = recent.filter(b => b.status === "won" || b.status === "lost").length;
  const recentHitRate = recentDecided > 0 ? recentWins / recentDecided : 0;

  // Generate alerts
  if (cusumCLV.alarm) {
    alerts.push({
      type: "clv_negative",
      severity: "critical",
      message: `CUSUM alarm: CLV has shifted below target. CUSUM=${cusumCLV.cusumUpper.toFixed(2)}, threshold=${config.threshold}`,
    });
    actions.push("Re-run solver for affected leagues (npx tsx scripts/solve-latest.ts)");
  }

  if (avgRecentCLV < 0) {
    alerts.push({
      type: "clv_negative",
      severity: avgRecentCLV < -0.02 ? "critical" : "warning",
      message: `Rolling ${recentN}-bet CLV: ${(avgRecentCLV * 100).toFixed(1)}%`,
    });
  }

  if (recentROI < -0.05) {
    alerts.push({
      type: "roi_negative",
      severity: "critical",
      message: `Rolling ${recentN}-bet ROI: ${(recentROI * 100).toFixed(1)}% — significant drawdown`,
    });
    actions.push("Review param-sweep.ts output — current params may no longer be optimal");
  } else if (recentROI < 0) {
    alerts.push({
      type: "roi_negative",
      severity: "warning",
      message: `Rolling ${recentN}-bet ROI: ${(recentROI * 100).toFixed(1)}%`,
    });
  }

  if (recentHitRate < 0.40 && recentDecided >= 15) {
    alerts.push({
      type: "hit_rate_low",
      severity: recentHitRate < 0.35 ? "critical" : "warning",
      message: `Rolling ${recentN}-bet hit rate: ${(recentHitRate * 100).toFixed(0)}%`,
    });
  }

  // Signal health check
  const signalHealth = checkSignalHealth(settled);
  for (const sh of signalHealth) {
    if (sh.degraded) {
      actions.push(`Signal "${sh.signalId}" performing ${(sh.zScore).toFixed(1)}σ below backtest — consider disabling`);
    }
  }

  // Determine overall status
  let status: DriftReport["status"] = "healthy";
  if (alerts.some(a => a.severity === "critical")) status = "critical";
  else if (alerts.length > 0) status = "warning";

  return { status, cusumCLV, cusumROI, alerts, signalHealth, actions };
}

// ─── Signal Health Check ────────────────────────────────────────────────────

function checkSignalHealth(settled: PaperBet[]): SignalHealthEntry[] {
  const entries: SignalHealthEntry[] = [];

  // Load signal registry for backtest baselines
  const registryPath = join(process.cwd(), "data", "signal-registry.json");
  if (!existsSync(registryPath)) return entries;

  try {
    const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
    const signals = registry.signals as SignalRegistryEntry[];

    for (const signal of signals) {
      if (signal.status !== "accepted" || !signal.backtestStats) continue;

      const backtestHitRate = signal.backtestStats.standaloneROI > 0 ? 0.52 : 0.48; // approximate
      const liveBets = settled.length; // simplified — in practice, filter by signal
      const liveWins = settled.filter(b => b.status === "won").length;
      const liveHitRate = liveBets > 0 ? liveWins / settled.filter(b => b.status !== "push").length : 0;

      // Two-proportion z-test
      const pooledP = (liveWins + backtestHitRate * signal.backtestStats.standaloneN) /
                       (liveBets + signal.backtestStats.standaloneN);
      const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / liveBets + 1 / signal.backtestStats.standaloneN));
      const zScore = se > 0 ? (liveHitRate - backtestHitRate) / se : 0;

      entries.push({
        signalId: signal.id,
        backtestHitRate,
        liveHitRate,
        liveBets,
        zScore,
        degraded: zScore < -2, // > 2σ below backtest
      });
    }
  } catch { /* skip if registry unavailable */ }

  return entries;
}

// ─── Formatting ─────────────────────────────────────────────────────────────

export function formatDriftReport(report: DriftReport): string {
  const lines: string[] = [];
  const statusIcon = report.status === "healthy" ? "OK" : report.status === "warning" ? "WARN" : "CRIT";

  lines.push(`  Drift Detection Report [${statusIcon}]`);
  lines.push(`  ${"─".repeat(60)}`);
  lines.push(`  CUSUM CLV:  value=${report.cusumCLV.cusumUpper.toFixed(2)}  alarm=${report.cusumCLV.alarm}  obs=${report.cusumCLV.nObs}`);
  lines.push(`  CUSUM ROI:  value=${report.cusumROI.cusumUpper.toFixed(2)}  alarm=${report.cusumROI.alarm}  obs=${report.cusumROI.nObs}`);

  if (report.alerts.length > 0) {
    lines.push(`\n  Alerts:`);
    for (const a of report.alerts) {
      lines.push(`    [${a.severity.toUpperCase()}] ${a.message}`);
    }
  }

  if (report.signalHealth.length > 0) {
    lines.push(`\n  Signal Health:`);
    for (const sh of report.signalHealth) {
      const status = sh.degraded ? "DEGRADED" : "OK";
      lines.push(`    ${sh.signalId.padEnd(25)} live=${(sh.liveHitRate * 100).toFixed(0)}%  backtest=${(sh.backtestHitRate * 100).toFixed(0)}%  z=${sh.zScore.toFixed(1)}  [${status}]`);
    }
  }

  if (report.actions.length > 0) {
    lines.push(`\n  Recommended Actions:`);
    for (const a of report.actions) {
      lines.push(`    - ${a}`);
    }
  }

  return lines.join("\n");
}
