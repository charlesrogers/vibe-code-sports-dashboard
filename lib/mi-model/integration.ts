/**
 * MI + Variance Integration — combines market-implied model edges with xG variance signals
 *
 * Signal matrix (from MI-POISSON-SPEC.md section 7):
 *   MI says bet + Variance says bet → "strong" (highest confidence)
 *   MI says bet + Variance neutral  → "moderate" (follow MI)
 *   MI neutral  + Variance says bet → "variance_only" (Ted's "ME bet")
 *   Both say no                     → null (PASS)
 */

import type { ValueBet, MatchPrediction } from "./types";
import type { MatchVarianceAssessment } from "../variance/match-assessor";

export interface CombinedAssessment {
  homeTeam: string;
  awayTeam: string;

  // MI model output
  miPrediction: MatchPrediction | null;
  miValueBets: ValueBet[];
  miHasBet: boolean;
  miBestSelection: string | null;
  miBestEdge: number;

  // Variance model output
  varianceAssessment: MatchVarianceAssessment | null;
  varianceHasBet: boolean;
  varianceBetSide: string | null;
  varianceEdge: number;
  varianceGrade: string | null;

  // Combined signal
  combinedSignal: "strong" | "moderate" | "model_only" | "variance_only" | null;
  finalBets: ValueBet[];
  reasoning: string;
}

export interface IntegrationConfig {
  /** Minimum MI edge to consider it a bet (default 0.03) */
  miMinEdge: number;
  /** Minimum combined edge for final output (default 0.03) */
  finalMinEdge: number;
  /** Boost factor when both signals agree (default 1.0 = no boost, just tag) */
  agreementBoost: number;
}

export const DEFAULT_INTEGRATION_CONFIG: IntegrationConfig = {
  miMinEdge: 0.03,
  finalMinEdge: 0.03,
  agreementBoost: 1.0,
};

/**
 * Determine if a variance bet side aligns with an MI value bet selection.
 * Variance produces "home"/"away", MI produces "home"/"draw"/"away"/"over2.5" etc.
 */
function sidesAgree(varianceSide: string | null, miSelection: string): boolean {
  if (!varianceSide) return false;
  // Direct match: variance says "home" and MI says "home"
  if (varianceSide === miSelection) return true;
  // Variance says "away" and MI says "away"
  if (varianceSide === "away" && miSelection === "away") return true;
  return false;
}

/**
 * Determine if a variance bet side conflicts with an MI value bet selection.
 */
function sidesConflict(varianceSide: string | null, miSelection: string): boolean {
  if (!varianceSide) return false;
  // Variance says "home" but MI says "away", or vice versa
  if (varianceSide === "home" && miSelection === "away") return true;
  if (varianceSide === "away" && miSelection === "home") return true;
  return false;
}

/**
 * Combine MI model predictions with variance assessment for a single match.
 */
export function combineSignals(
  miPrediction: MatchPrediction | null,
  miValueBets: ValueBet[],
  varianceAssessment: MatchVarianceAssessment | null,
  config: IntegrationConfig = DEFAULT_INTEGRATION_CONFIG
): CombinedAssessment {
  const homeTeam = miPrediction?.homeTeam ?? varianceAssessment?.homeTeam ?? "Unknown";
  const awayTeam = miPrediction?.awayTeam ?? varianceAssessment?.awayTeam ?? "Unknown";

  const miHasBet = miValueBets.length > 0;
  const miBestBet = miValueBets[0] ?? null; // already sorted by edge desc
  const miBestSelection = miBestBet?.selection ?? null;
  const miBestEdge = miBestBet?.edge ?? 0;

  const varianceHasBet = varianceAssessment?.hasBet ?? false;
  const varianceBetSide = varianceAssessment?.betSide ?? null;
  const varianceEdge = varianceAssessment?.varianceEdge ?? 0;
  const varianceGrade = varianceAssessment?.betGrade ?? null;

  // Determine combined signal
  let combinedSignal: CombinedAssessment["combinedSignal"] = null;
  const finalBets: ValueBet[] = [];
  const reasonParts: string[] = [];

  if (miHasBet && varianceHasBet) {
    // Both models have bets — check if they agree on direction
    const bestMi1X2 = miValueBets.find(b =>
      b.selection === "home" || b.selection === "draw" || b.selection === "away"
    );

    if (bestMi1X2 && sidesAgree(varianceBetSide, bestMi1X2.selection)) {
      // STRONG: Both models agree on the same side
      combinedSignal = "strong";
      reasonParts.push(
        `STRONG SIGNAL: Both MI model (${(bestMi1X2.edge * 100).toFixed(1)}% edge on ${bestMi1X2.selection}) ` +
        `and variance model (Grade ${varianceGrade}, ${(Math.abs(varianceEdge) * 100).toFixed(1)}% edge on ${varianceBetSide}) agree.`
      );

      // Tag all MI bets with agreement
      for (const bet of miValueBets) {
        const agrees = sidesAgree(varianceBetSide, bet.selection);
        finalBets.push({
          ...bet,
          varianceAgreement: agrees,
          combinedSignal: agrees ? "strong" : "moderate",
        });
      }
    } else if (bestMi1X2 && sidesConflict(varianceBetSide, bestMi1X2.selection)) {
      // Models disagree on 1X2 direction — caution
      combinedSignal = "moderate";
      reasonParts.push(
        `CAUTION: MI model favors ${bestMi1X2.selection} (${(bestMi1X2.edge * 100).toFixed(1)}% edge) ` +
        `but variance model favors ${varianceBetSide}. Using MI model bets with reduced confidence.`
      );

      // Still include MI bets but mark disagreement
      for (const bet of miValueBets) {
        const conflicts = sidesConflict(varianceBetSide, bet.selection);
        // Skip 1X2 bets that conflict with variance — O/U and AH can still go through
        if (conflicts) continue;
        finalBets.push({
          ...bet,
          varianceAgreement: false,
          combinedSignal: "moderate",
        });
      }

      // Also include variance-only signal
      if (finalBets.length === 0) {
        combinedSignal = "variance_only";
        reasonParts.push(
          `Falling back to variance-only: ${varianceBetSide} (Grade ${varianceGrade}).`
        );
      }
    } else {
      // MI has non-1X2 bets or no direct conflict — moderate
      combinedSignal = "moderate";
      reasonParts.push(
        `MI model found value in ${miValueBets.map(b => b.selection).join(", ")}. ` +
        `Variance model independently favors ${varianceBetSide} (Grade ${varianceGrade}).`
      );
      for (const bet of miValueBets) {
        finalBets.push({
          ...bet,
          varianceAgreement: null,
          combinedSignal: "moderate",
        });
      }
    }
  } else if (miHasBet && !varianceHasBet) {
    // MI only — "model_only" bet
    combinedSignal = "model_only";
    reasonParts.push(
      `MODEL BET: MI model finds ${miValueBets.length} value bet(s). ` +
      `Variance model sees no actionable signal` +
      (varianceAssessment ? ` (${varianceAssessment.passReasons.slice(0, 2).join("; ")}).` : ".")
    );
    for (const bet of miValueBets) {
      finalBets.push({
        ...bet,
        varianceAgreement: null,
        combinedSignal: "model_only",
      });
    }
  } else if (!miHasBet && varianceHasBet) {
    // Variance only — "variance_only" (Ted's "ME bet")
    combinedSignal = "variance_only";
    reasonParts.push(
      `VARIANCE BET (ME): No MI model edge, but variance model flags ${varianceBetSide} ` +
      `(Grade ${varianceGrade}, ${(Math.abs(varianceEdge) * 100).toFixed(1)}% edge). ` +
      `Ted's concept: follow when variance signal is strong.`
    );
    // Create a synthetic value bet from variance signal
    if (varianceBetSide === "home" || varianceBetSide === "away") {
      finalBets.push({
        matchId: `${homeTeam}-vs-${awayTeam}`,
        homeTeam,
        awayTeam,
        selection: varianceBetSide,
        modelProb: 0, // no MI prob
        marketProb: 0, // unknown
        edge: Math.abs(varianceEdge),
        varianceAgreement: true,
        combinedSignal: "variance_only",
      });
    }
  } else {
    // Neither model has a bet
    combinedSignal = null;
    reasonParts.push("PASS: Neither MI model nor variance model finds actionable value.");
  }

  // Filter final bets by minimum edge
  const filteredBets = finalBets.filter(b => b.edge >= config.finalMinEdge);

  return {
    homeTeam,
    awayTeam,
    miPrediction,
    miValueBets,
    miHasBet,
    miBestSelection,
    miBestEdge,
    varianceAssessment,
    varianceHasBet,
    varianceBetSide,
    varianceEdge,
    varianceGrade,
    combinedSignal: filteredBets.length > 0 ? combinedSignal : null,
    finalBets: filteredBets,
    reasoning: reasonParts.join(" "),
  };
}

/**
 * Format a CombinedAssessment for display.
 */
export function formatCombinedAssessment(a: CombinedAssessment): string {
  const lines: string[] = [];
  lines.push(`\n═══ ${a.homeTeam} vs ${a.awayTeam} ═══`);

  // MI summary
  if (a.miPrediction) {
    const p = a.miPrediction;
    lines.push(`  MI Model: ${p.expectedGoals.home.toFixed(2)} - ${p.expectedGoals.away.toFixed(2)} xG`);
    lines.push(`  1X2: H ${(p.probs1X2.home * 100).toFixed(1)}% | D ${(p.probs1X2.draw * 100).toFixed(1)}% | A ${(p.probs1X2.away * 100).toFixed(1)}%`);
    if (a.miValueBets.length > 0) {
      lines.push(`  MI Value: ${a.miValueBets.map(b => `${b.selection} +${(b.edge * 100).toFixed(1)}%`).join(", ")}`);
    } else {
      lines.push(`  MI Value: No edges found`);
    }
  } else {
    lines.push(`  MI Model: Not available`);
  }

  // Variance summary
  if (a.varianceAssessment) {
    const v = a.varianceAssessment;
    if (v.hasBet) {
      lines.push(`  Variance: ${v.betSide} (Grade ${v.betGrade}, ${(Math.abs(v.varianceEdge) * 100).toFixed(1)}% edge, conf ${v.confidence})`);
    } else {
      lines.push(`  Variance: No bet — ${v.passReasons.slice(0, 2).join("; ")}`);
    }
  } else {
    lines.push(`  Variance: Not available`);
  }

  // Combined signal
  lines.push(``);
  if (a.combinedSignal) {
    const signalLabel = {
      strong: "★★★ STRONG",
      moderate: "★★  MODERATE",
      model_only: "★   MODEL ONLY",
      variance_only: "★   VARIANCE ONLY",
    }[a.combinedSignal];
    lines.push(`  Signal: ${signalLabel}`);
    for (const bet of a.finalBets) {
      lines.push(`  → BET: ${bet.selection} | edge ${(bet.edge * 100).toFixed(1)}% | ${bet.combinedSignal}`);
    }
  } else {
    lines.push(`  Signal: PASS`);
  }
  lines.push(`  ${a.reasoning}`);

  return lines.join("\n");
}
