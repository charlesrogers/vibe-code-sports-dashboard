/**
 * Alpha Decomposition — Leave-one-out and add-one-in analysis
 *
 * For each signal: standalone ROI, marginal ROI, correlation with other signals.
 * Answers: "How much of my alpha comes from each signal?"
 */

import type { AlphaReport, BetRecord } from "./types";
import type { LoadedData } from "../backtest/data-loader";
import { runBaseEval, runBaseEvalXG, runWithoutSignal, runStandaloneSignal } from "./runner";
import { summarizeBets, fmtPct, type EvalConfig } from "../backtest/bet-evaluator";

// ─── Decomposable Signals ───────────────────────────────────────────────────

/** Signals that can be toggled on/off in the eval config */
const DECOMPOSABLE_SIGNALS = [
  "variance-regression",
  "congestion-filter",
  "defiance-filter",
  "odds-cap-2.0",
];

// ─── Alpha Decomposition ────────────────────────────────────────────────────

export function decomposeAlpha(
  data: LoadedData,
  baseConfig: Partial<EvalConfig> = {},
  verbose: boolean = true,
): AlphaReport[] {
  const reports: AlphaReport[] = [];

  if (verbose) console.log("\n  ─── ALPHA DECOMPOSITION ──────────────────────────────────────────\n");

  // 1. Run full base (all signals active)
  const baseResult = runBaseEval(data, baseConfig);
  const baseSummary = summarizeBets(baseResult.bets);

  if (verbose) {
    console.log(`  Base (all signals): n=${baseSummary.n}  ROI=${fmtPct(baseSummary.roi)}  CLV=${fmtPct(baseSummary.clv)}  Hit=${(baseSummary.hitRate * 100).toFixed(1)}%`);
    console.log();
  }

  // 2. Run without each signal (leave-one-out)
  if (verbose) console.log("  Leave-one-out analysis:");
  const leaveOneOutResults: Record<string, ReturnType<typeof summarizeBets>> = {};

  for (const signalId of DECOMPOSABLE_SIGNALS) {
    const result = runWithoutSignal(data, signalId, baseConfig);
    const summary = summarizeBets(result.bets);
    leaveOneOutResults[signalId] = summary;

    if (verbose) {
      const delta = baseSummary.roi - summary.roi;
      console.log(`    Without ${signalId.padEnd(25)} n=${String(summary.n).padStart(5)}  ROI=${fmtPct(summary.roi).padStart(7)}  delta=${fmtPct(delta).padStart(7)}`);
    }
  }

  // 3. Run each signal standalone (add-one-in)
  if (verbose) {
    console.log();
    console.log("  Standalone analysis (signal alone, no other filters):");
  }

  // Run with no filters at all as baseline
  const noFilterResult = runStandaloneSignal(data, "none", baseConfig);
  const noFilterSummary = summarizeBets(noFilterResult.bets);
  if (verbose) {
    console.log(`    No filters (baseline)          n=${String(noFilterSummary.n).padStart(5)}  ROI=${fmtPct(noFilterSummary.roi).padStart(7)}`);
  }

  for (const signalId of DECOMPOSABLE_SIGNALS) {
    const result = runStandaloneSignal(data, signalId, baseConfig);
    const summary = summarizeBets(result.bets);
    const leaveOneOut = leaveOneOutResults[signalId];

    // Compute bet overlap with base
    const baseBetKeys = new Set(baseResult.bets.map(b => `${b.date}_${b.homeTeam}_${b.selection}`));
    const standaloneBetKeys = new Set(result.bets.map(b => `${b.date}_${b.homeTeam}_${b.selection}`));
    let overlap = 0;
    for (const key of standaloneBetKeys) {
      if (baseBetKeys.has(key)) overlap++;
    }
    const overlapPct = standaloneBetKeys.size > 0 ? overlap / standaloneBetKeys.size : 0;

    if (verbose) {
      console.log(`    ${signalId.padEnd(30)} n=${String(summary.n).padStart(5)}  ROI=${fmtPct(summary.roi).padStart(7)}  CLV=${fmtPct(summary.clv).padStart(7)}  overlap=${(overlapPct * 100).toFixed(0)}%`);
    }

    reports.push({
      signalId,
      standaloneROI: summary.roi,
      standaloneCLV: summary.clv,
      standaloneN: summary.n,
      standaloneHitRate: summary.hitRate,
      marginalROI: baseSummary.roi - (leaveOneOut?.roi ?? baseSummary.roi),
      leaveOneOutDelta: baseSummary.roi - (leaveOneOut?.roi ?? baseSummary.roi),
      overlapWithBase: overlapPct,
    });
  }

  // 4. xG A/B comparison (if match-xG data is available)
  if (data.matchXG && data.matchXG.size > 0 && verbose) {
    console.log();
    console.log("  ─── xG A/B: PROXY vs REAL MATCH-LEVEL xG ──────────────────────────\n");
    const xgResult = runBaseEvalXG(data, baseConfig);
    const xgSummary = summarizeBets(xgResult.bets);
    console.log(`    Model-proxy variance:  n=${String(baseSummary.n).padStart(5)}  ROI=${fmtPct(baseSummary.roi).padStart(7)}  CLV=${fmtPct(baseSummary.clv).padStart(7)}`);
    console.log(`    Real-xG variance:      n=${String(xgSummary.n).padStart(5)}  ROI=${fmtPct(xgSummary.roi).padStart(7)}  CLV=${fmtPct(xgSummary.clv).padStart(7)}`);
    console.log(`    Δ ROI: ${fmtPct(xgSummary.roi - baseSummary.roi)}  Δ CLV: ${fmtPct(xgSummary.clv - baseSummary.clv)}`);
  }

  // 5. Summary table
  if (verbose) {
    console.log();
    console.log("  ─── SIGNAL CONTRIBUTION SUMMARY ──────────────────────────────────\n");
    console.log("  Signal                       Standalone ROI  Marginal ROI  Leave-1-Out  Overlap");
    console.log("  " + "─".repeat(85));

    for (const r of reports) {
      console.log(
        `  ${r.signalId.padEnd(30)} ${fmtPct(r.standaloneROI).padStart(13)}  ${fmtPct(r.marginalROI).padStart(12)}  ${fmtPct(r.leaveOneOutDelta).padStart(11)}  ${(r.overlapWithBase * 100).toFixed(0).padStart(6)}%`
      );
    }
    console.log();
  }

  return reports;
}
