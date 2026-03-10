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

  // Team quality — xGD per match tells you if they're actually good or bad
  // Ted: "xGD is the single best measure of true team quality"
  xGDPerMatch: number;
  qualityTier: "elite" | "good" | "average" | "poor" | "bad";

  // Persistent defiance — if variance hasn't corrected in 15+ matches, reduce trust
  persistentDefiance: boolean;

  // Double variance — attack overperf + defense underperf simultaneously
  // The GD may look roughly right but BOTH components are fragile (Ted: "apparent stability is an illusion")
  doubleVariance: boolean;

  // Last-10 rolling window (optional — populated when available)
  last10XGDPerMatch?: number;
  trendDivergence?: number; // last10 - fullSeason xGD/match (positive = improving)

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

/**
 * Classify team quality with optional venue offset.
 *
 * Home xGD is naturally inflated (~0.3 higher than neutral) and away xGD
 * is deflated. Without adjustment, home teams get systematically upgraded
 * (e.g. an "average" home team looks "good"), which inflates P1 triggers
 * and causes the model to over-recommend home bets.
 *
 * Offsets: home -0.3, away +0.2 (asymmetric because home advantage is
 * stronger than away disadvantage in xG terms).
 */
function classifyQuality(
  xGDPerMatch: number,
  venue?: "home" | "away"
): TeamVariance["qualityTier"] {
  let adjusted = xGDPerMatch;
  if (venue === "home") adjusted -= 0.3;
  else if (venue === "away") adjusted += 0.2;

  if (adjusted >= 1.0) return "elite";
  if (adjusted >= 0.3) return "good";
  if (adjusted >= -0.3) return "average";
  if (adjusted >= -0.8) return "poor";
  return "bad";
}

function computeRegressionConfidence(
  totalVariance: number,
  dominantType: TeamVariance["dominantType"],
  matches: number,
  qualityTier: TeamVariance["qualityTier"],
  persistentDefiance: boolean
): number {
  const gap = Math.abs(totalVariance);
  let confidence = 0.5;

  // Gap size boosts confidence
  if (gap > 5) confidence += 0.2;
  if (gap > 8) confidence += 0.1;

  // Defense underperf is the most reliable signal (Ted's key teaching)
  if (dominantType === "defense_underperf") confidence += 0.15;
  // Attack overperf is fragile — reduce confidence
  if (dominantType === "attack_overperf") confidence -= 0.1;

  // Sample size
  if (matches >= 10) confidence += 0.1;
  if (matches < 5) confidence -= 0.15;

  // Ted: persistent defiance (15+ matches without correcting) = reduce trust
  if (persistentDefiance) confidence -= 0.2;

  // Ted: consider underlying team quality
  // A "bad" team (terrible xGD) underperforming is less likely variance,
  // more likely they're just genuinely bad. Reduce confidence.
  if (qualityTier === "bad") confidence -= 0.15;
  if (qualityTier === "poor") confidence -= 0.05;

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
  qualityTier: TeamVariance["qualityTier"];
  persistentDefiance: boolean;
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

  // Ted: team quality context — a bad team underperforming isn't variance, they're just bad
  if (v.qualityTier === "bad") {
    parts.push(
      `⚠️ CAUTION: ${v.team} has genuinely poor underlying quality (bad xGD). Variance may not be luck — they may just be this bad.`
    );
  } else if (v.qualityTier === "poor") {
    parts.push(
      `Note: ${v.team} has below-average underlying quality (poor xGD). Regression signal is weaker.`
    );
  }

  // Ted: persistent defiance warning
  if (v.persistentDefiance) {
    parts.push(
      `⚠️ PERSISTENT DEFIANCE: 15+ matches without correction. Ted says reduce confidence — some teams just defy the model.`
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

export interface VarianceOptions {
  venue?: "home" | "away";
  legacy?: boolean; // When true, use v1 logic (no venue offset)
  last10Xg?: TeamXg; // Last-10 rolling window xG data (optional)
}

export function calculateTeamVariance(
  team: TeamXg,
  venueOrOpts?: "home" | "away" | VarianceOptions
): TeamVariance {
  const opts: VarianceOptions =
    typeof venueOrOpts === "string" ? { venue: venueOrOpts } :
    venueOrOpts ?? {};
  const venue = opts.legacy ? undefined : opts.venue;
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

  // Team quality — xGD per match is the best single measure
  const xGDPerMatch = matches > 0 ? xGD / matches : 0;
  const qualityTier = classifyQuality(xGDPerMatch, venue);

  // Persistent defiance: if 15+ matches and variance hasn't corrected,
  // the team may just be what they are (not variance, just reality)
  const persistentDefiance = matches >= 15 && Math.abs(totalVariance) > 5;

  // Double variance: attack overperf + defense underperf simultaneously
  // e.g. Wrexham: 33 goals from 25.21 xG AND 28 conceded from 18.58 xGA
  // The GD looks roughly right but both components are fragile
  const doubleVariance = attackVariance > 2 && defenseVariance > 2;

  let regressionConfidence = computeRegressionConfidence(
    totalVariance,
    dominantType,
    matches,
    qualityTier,
    persistentDefiance
  );

  // Last-10 rolling window: compute trend divergence if provided
  let last10XGDPerMatch: number | undefined;
  let trendDivergence: number | undefined;
  if (opts.last10Xg) {
    const l10 = opts.last10Xg;
    const l10XGD = l10.xGFor - l10.xGAgainst;
    last10XGDPerMatch = l10.matches > 0
      ? Math.round((l10XGD / l10.matches) * 100) / 100
      : 0;
    trendDivergence = Math.round((last10XGDPerMatch - xGDPerMatch) * 100) / 100;

    // Adjust regression confidence based on trend divergence
    // Large positive divergence (> 0.3) = team improving recently -> boost confidence
    // Large negative divergence (< -0.3) = team declining recently -> reduce confidence
    if (trendDivergence > 0.3) {
      regressionConfidence += 0.1;
    } else if (trendDivergence < -0.3) {
      regressionConfidence -= 0.1;
    }
    regressionConfidence = Math.max(0, Math.min(1, regressionConfidence));
  }

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
    qualityTier,
    persistentDefiance,
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
    xGDPerMatch: Math.round(xGDPerMatch * 100) / 100,
    qualityTier,
    persistentDefiance,
    doubleVariance,
    last10XGDPerMatch,
    trendDivergence,
    regressionConfidence: Math.round(regressionConfidence * 100) / 100,
    regressionDirection,
    explanation,
  };
}

export function calculateAllVariance(teams: TeamXg[]): TeamVariance[] {
  return teams
    .map((t) => calculateTeamVariance(t))
    .sort(
      (a, b) =>
        Math.abs(b.totalVariance) - Math.abs(a.totalVariance)
    );
}
