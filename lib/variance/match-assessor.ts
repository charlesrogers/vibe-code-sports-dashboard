/**
 * Match Variance Assessment — evaluates upcoming fixtures for regression edges
 *
 * Combines home and away team variance profiles to determine
 * if regression favors one side, and whether the edge is large enough to bet.
 */

import type { TeamVariance } from "./calculator";

export interface MatchVarianceAssessment {
  homeTeam: string;
  awayTeam: string;

  homeVariance: TeamVariance;
  awayVariance: TeamVariance;

  // Net edge
  varianceEdge: number; // positive = regression favors home
  edgeSide: "home" | "away" | "neutral";
  edgeMagnitude: "strong" | "moderate" | "weak" | "none";

  // Bet recommendation
  hasBet: boolean; // only true if edge >= 4% AND confidence high enough
  betSide: string | null; // "home" | "away" | null
  betReasoning: string; // natural language explanation
  confidence: number; // 0-1
}

function directionSign(v: TeamVariance): number {
  // "improve" means team will do BETTER than recent results -> positive for them
  // "decline" means team will do WORSE -> negative for them
  if (v.regressionDirection === "improve") return 1;
  if (v.regressionDirection === "decline") return -1;
  return 0;
}

function classifyMagnitude(
  edge: number
): MatchVarianceAssessment["edgeMagnitude"] {
  const abs = Math.abs(edge);
  if (abs >= 0.15) return "strong";
  if (abs >= 0.08) return "moderate";
  if (abs >= 0.04) return "weak";
  return "none";
}

function buildReasoning(
  homeVariance: TeamVariance,
  awayVariance: TeamVariance,
  edgeSide: "home" | "away" | "neutral",
  varianceEdge: number,
  hasBet: boolean
): string {
  if (!hasBet) {
    if (Math.abs(varianceEdge) < 0.04) {
      return `No significant variance edge between ${homeVariance.team} and ${awayVariance.team}. Both teams are performing relatively in line with expectations, or their regression signals cancel out.`;
    }
    return `Edge of ${(Math.abs(varianceEdge) * 100).toFixed(1)}% detected favoring ${edgeSide === "home" ? homeVariance.team : awayVariance.team}, but confidence is too low to recommend a bet.`;
  }

  const favored =
    edgeSide === "home" ? homeVariance.team : awayVariance.team;
  const opposed =
    edgeSide === "home" ? awayVariance.team : homeVariance.team;
  const favoredV = edgeSide === "home" ? homeVariance : awayVariance;
  const opposedV = edgeSide === "home" ? awayVariance : homeVariance;

  const parts: string[] = [];
  parts.push(
    `Variance edge: ${(Math.abs(varianceEdge) * 100).toFixed(1)}% favoring ${favored}.`
  );

  if (
    favoredV.regressionDirection === "improve" &&
    opposedV.regressionDirection === "decline"
  ) {
    parts.push(
      `${favored} has been underperforming xG and should improve, while ${opposed} has been overperforming and should regress down.`
    );
  } else if (favoredV.regressionDirection === "improve") {
    parts.push(
      `${favored} has been underperforming xG (${favoredV.totalVariance > 0 ? "+" : ""}${favoredV.totalVariance.toFixed(1)} goal variance) and is due for positive regression.`
    );
  } else if (opposedV.regressionDirection === "decline") {
    parts.push(
      `${opposed} has been overperforming xG (${opposedV.totalVariance > 0 ? "+" : ""}${opposedV.totalVariance.toFixed(1)} goal variance) and is due for negative regression.`
    );
  }

  if (favoredV.dominantType === "defense_underperf") {
    parts.push(
      `${favored}'s defensive underperformance is the most reliable regression signal.`
    );
  }
  if (opposedV.dominantType === "attack_overperf") {
    parts.push(
      `${opposed}'s attack overperformance is fragile and likely unsustainable.`
    );
  }

  return parts.join(" ");
}

export function assessMatch(
  homeVariance: TeamVariance,
  awayVariance: TeamVariance
): MatchVarianceAssessment {
  // Compute edge: home regression benefit minus away regression benefit
  const homeEdge =
    homeVariance.regressionConfidence * directionSign(homeVariance);
  const awayEdge =
    awayVariance.regressionConfidence * directionSign(awayVariance);
  const varianceEdge = homeEdge - awayEdge;

  let edgeSide: MatchVarianceAssessment["edgeSide"] = "neutral";
  if (varianceEdge > 0.02) edgeSide = "home";
  else if (varianceEdge < -0.02) edgeSide = "away";

  const edgeMagnitude = classifyMagnitude(varianceEdge);

  const maxConfidence = Math.max(
    homeVariance.regressionConfidence,
    awayVariance.regressionConfidence
  );
  const hasBet =
    Math.abs(varianceEdge) >= 0.04 && maxConfidence >= 0.6;

  const betSide = hasBet ? edgeSide : null;
  const confidence = hasBet
    ? Math.min(maxConfidence, Math.abs(varianceEdge) * 5)
    : 0;

  const betReasoning = buildReasoning(
    homeVariance,
    awayVariance,
    edgeSide,
    varianceEdge,
    hasBet
  );

  return {
    homeTeam: homeVariance.team,
    awayTeam: awayVariance.team,
    homeVariance,
    awayVariance,
    varianceEdge: Math.round(varianceEdge * 1000) / 1000,
    edgeSide,
    edgeMagnitude,
    hasBet,
    betSide: betSide === "neutral" ? null : betSide,
    betReasoning,
    confidence: Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100,
  };
}
