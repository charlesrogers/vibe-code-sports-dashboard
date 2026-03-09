/**
 * Variance Calculator — Ted Knutson's variance betting model
 *
 * Identifies the gap between xG (expected goals) and actual results,
 * then classifies regression signals and confidence levels.
 */

import type { TeamXg } from "../types";

export interface TeamVariance {
  team: string;
  matches: number;

  // Raw data
  xG: number;
  goals: number;
  xGA: number;
  goalsConceded: number;
  xGD: number;
  actualGD: number;

  // Variance (positive = overperforming results)
  attackVariance: number; // goals - xG
  defenseVariance: number; // goalsConceded - xGA (positive = leaking goals vs expectation)
  totalVariance: number; // actualGD - xGD

  // Percentage ratios
  attackVariancePct: number; // goals / xG ratio
  defenseVariancePct: number; // goalsConceded / xGA ratio

  // Signal classification
  signal:
    | "strong_positive"
    | "weak_positive"
    | "neutral"
    | "weak_negative"
    | "strong_negative";
  // positive = results better than xG (will regress DOWN)
  // negative = results worse than xG (will regress UP)

  dominantType:
    | "attack_overperf"
    | "attack_underperf"
    | "defense_overperf"
    | "defense_underperf"
    | "balanced";

  // Regression confidence 0-1
  regressionConfidence: number;
  regressionDirection: "improve" | "decline" | "stable";
  explanation: string;
}

function classifySignal(
  totalVariance: number
): TeamVariance["signal"] {
  const abs = Math.abs(totalVariance);
  if (abs < 3) return "neutral";
  // positive totalVariance = actualGD > xGD = overperforming = positive signal
  if (totalVariance > 0) {
    return abs >= 5 ? "strong_positive" : "weak_positive";
  }
  return abs >= 5 ? "strong_negative" : "weak_negative";
}

function classifyDominantType(
  attackVariance: number,
  defenseVariance: number,
  attackVariancePct: number,
  defenseVariancePct: number
): TeamVariance["dominantType"] {
  const absAtk = Math.abs(attackVariance);
  const absDef = Math.abs(defenseVariance);

  // Check if roughly balanced
  if (absAtk < 2 && absDef < 2) return "balanced";

  if (absAtk > absDef) {
    // Attack is dominant variance source
    return attackVariance > 0 ? "attack_overperf" : "attack_underperf";
  }
  // Defense is dominant variance source
  // defenseVariance > 0 means conceding MORE than expected = underperforming defensively
  return defenseVariance > 0 ? "defense_underperf" : "defense_overperf";
}

function computeRegressionConfidence(
  totalVariance: number,
  dominantType: TeamVariance["dominantType"],
  matches: number
): number {
  const gap = Math.abs(totalVariance);
  let confidence = 0.5;

  if (gap > 5) confidence += 0.2;
  if (gap > 8) confidence += 0.1;

  if (dominantType === "defense_underperf") confidence += 0.15;
  if (dominantType === "attack_overperf") confidence -= 0.1;

  if (matches >= 10) confidence += 0.1;
  if (matches < 5) confidence -= 0.15;

  return Math.max(0, Math.min(1, confidence));
}

function buildExplanation(v: {
  team: string;
  signal: TeamVariance["signal"];
  dominantType: TeamVariance["dominantType"];
  attackVariance: number;
  defenseVariance: number;
  attackVariancePct: number;
  defenseVariancePct: number;
  regressionDirection: TeamVariance["regressionDirection"];
  regressionConfidence: number;
}): string {
  const parts: string[] = [];

  if (v.signal === "neutral") {
    return `${v.team} is performing roughly in line with xG expectations. No strong regression signal.`;
  }

  const overOrUnder =
    v.signal.includes("positive") ? "overperforming" : "underperforming";
  parts.push(`${v.team} is ${overOrUnder} their xG.`);

  if (v.dominantType === "attack_overperf") {
    parts.push(
      `Attack overperformance (${(v.attackVariancePct * 100).toFixed(0)}% conversion) is FRAGILE and likely to regress.`
    );
  } else if (v.dominantType === "defense_underperf") {
    parts.push(
      `Defensive underperformance (conceding ${(v.defenseVariancePct * 100).toFixed(0)}% of xGA) is the MOST RELIABLE regression signal.`
    );
  } else if (v.dominantType === "attack_underperf") {
    parts.push(
      `Attack underperformance (${(v.attackVariancePct * 100).toFixed(0)}% conversion) suggests goals will increase.`
    );
  } else if (v.dominantType === "defense_overperf") {
    parts.push(
      `Defensive overperformance (conceding only ${(v.defenseVariancePct * 100).toFixed(0)}% of xGA) may not be sustainable.`
    );
  }

  if (v.regressionDirection === "improve") {
    parts.push(`Expect results to IMPROVE.`);
  } else if (v.regressionDirection === "decline") {
    parts.push(`Expect results to DECLINE.`);
  }

  parts.push(
    `Regression confidence: ${(v.regressionConfidence * 100).toFixed(0)}%.`
  );

  return parts.join(" ");
}

export function calculateTeamVariance(team: TeamXg): TeamVariance {
  const xG = team.xGFor;
  const goals = team.goalsFor;
  const xGA = team.xGAgainst;
  const goalsConceded = team.goalsAgainst;
  const xGD = xG - xGA;
  const actualGD = goals - goalsConceded;
  const matches = team.matches;

  const attackVariance = goals - xG;
  const defenseVariance = goalsConceded - xGA; // positive = leaking more than expected
  const totalVariance = actualGD - xGD;

  const attackVariancePct = xG > 0 ? goals / xG : 1;
  const defenseVariancePct = xGA > 0 ? goalsConceded / xGA : 1;

  const signal = classifySignal(totalVariance);
  const dominantType = classifyDominantType(
    attackVariance,
    defenseVariance,
    attackVariancePct,
    defenseVariancePct
  );
  const regressionConfidence = computeRegressionConfidence(
    totalVariance,
    dominantType,
    matches
  );

  // If overperforming (positive signal) -> will regress DOWN -> decline
  // If underperforming (negative signal) -> will regress UP -> improve
  let regressionDirection: TeamVariance["regressionDirection"] = "stable";
  if (signal.includes("positive")) regressionDirection = "decline";
  else if (signal.includes("negative")) regressionDirection = "improve";

  const explanation = buildExplanation({
    team: team.team,
    signal,
    dominantType,
    attackVariance,
    defenseVariance,
    attackVariancePct,
    defenseVariancePct,
    regressionDirection,
    regressionConfidence,
  });

  return {
    team: team.team,
    matches,
    xG: Math.round(xG * 100) / 100,
    goals,
    xGA: Math.round(xGA * 100) / 100,
    goalsConceded,
    xGD: Math.round(xGD * 100) / 100,
    actualGD,
    attackVariance: Math.round(attackVariance * 100) / 100,
    defenseVariance: Math.round(defenseVariance * 100) / 100,
    totalVariance: Math.round(totalVariance * 100) / 100,
    attackVariancePct: Math.round(attackVariancePct * 100) / 100,
    defenseVariancePct: Math.round(defenseVariancePct * 100) / 100,
    signal,
    dominantType,
    regressionConfidence: Math.round(regressionConfidence * 100) / 100,
    regressionDirection,
    explanation,
  };
}

export function calculateAllVariance(teams: TeamXg[]): TeamVariance[] {
  return teams
    .map(calculateTeamVariance)
    .sort(
      (a, b) =>
        Math.abs(b.totalVariance) - Math.abs(a.totalVariance)
    );
}
