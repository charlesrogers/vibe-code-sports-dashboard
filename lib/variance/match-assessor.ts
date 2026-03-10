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
  hasBet: boolean;
  betSide: string | null; // "home" | "away" | null
  betReasoning: string; // natural language explanation
  confidence: number; // 0-1
  betGrade: "A" | "B" | "C" | null; // A = classic Ted, B = solid, C = marginal

  // Ted's filters
  passReasons: string[];
  positiveFactors: string[];
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
  hasBet: boolean,
  passReasons: string[] = []
): string {
  if (!hasBet) {
    if (Math.abs(varianceEdge) < 0.04) {
      return `No significant variance edge between ${homeVariance.team} and ${awayVariance.team}. Both teams are performing relatively in line with expectations, or their regression signals cancel out.`;
    }
    const reasonText = passReasons.length > 0
      ? ` PASS: ${passReasons.join("; ")}.`
      : " Confidence too low to recommend a bet.";
    return `Edge of ${(Math.abs(varianceEdge) * 100).toFixed(1)}% detected favoring ${edgeSide === "home" ? homeVariance.team : awayVariance.team}.${reasonText}`;
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

export interface AssessMatchOptions {
  legacy?: boolean; // When true, use v1 logic (count-based grading, no P3 dedup, no N10)
}

export function assessMatch(
  homeVariance: TeamVariance,
  awayVariance: TeamVariance,
  opts?: AssessMatchOptions
): MatchVarianceAssessment {
  const legacy = opts?.legacy ?? false;
  // Compute edge: how much regression favors one side vs the other
  const homeRegressionBenefit =
    (-homeVariance.totalVariance / 100) * homeVariance.regressionConfidence;
  const awayRegressionBenefit =
    (-awayVariance.totalVariance / 100) * awayVariance.regressionConfidence;

  // Net edge: positive = regression favors home
  const varianceEdge = homeRegressionBenefit - awayRegressionBenefit;

  let edgeSide: MatchVarianceAssessment["edgeSide"] = "neutral";
  if (varianceEdge > 0.02) edgeSide = "home";
  else if (varianceEdge < -0.02) edgeSide = "away";

  const edgeMagnitude = classifyMagnitude(varianceEdge);

  const favoredVariance = varianceEdge > 0 ? homeVariance : awayVariance;
  const opposedVariance = varianceEdge > 0 ? awayVariance : homeVariance;

  // ========================================
  // POSITIVE CRITERIA — "when TO bet" (Ted)
  // Need at least 1 positive factor to even consider a bet.
  // More factors = higher grade.
  // ========================================
  const positiveFactors: string[] = [];

  // P1. Classic Ted: good team (positive xGD) with bad actual results.
  //     "Blackburn: -7 GD from a respectable +6.67 xGD" — THE sweet spot.
  if (
    favoredVariance.regressionDirection === "improve" &&
    (favoredVariance.qualityTier === "good" || favoredVariance.qualityTier === "elite")
  ) {
    positiveFactors.push(
      `${favoredVariance.team} has strong underlying quality (${favoredVariance.qualityTier} xGD) but results haven't caught up`
    );
  }

  // P2. Defense underperformance on the favored side — Ted's most reliable signal.
  //     "Teams conceding way more than their xGA are almost guaranteed to see improvement."
  if (favoredVariance.dominantType === "defense_underperf") {
    positiveFactors.push(
      `${favoredVariance.team}'s variance is driven by defensive underperformance — the most reliable regression signal`
    );
  }

  // P3. Opponent overperforming (will regress DOWN against our side) — double signal.
  //     Both sides regress in our favor.
  //     NOTE: Only count P3 if the opponent's decline is NOT already captured by
  //     P4 (attack_overperf) or P5 (defense_overperf). P3/P4/P5 are correlated —
  //     counting all three inflates Grade B artificially.
  //     In legacy mode, we skip deduplication (original v1 behavior).
  const opponentDeclineSpecific = legacy
    ? false
    : (opposedVariance.dominantType === "attack_overperf" ||
       opposedVariance.dominantType === "defense_overperf");
  if (
    opposedVariance.regressionDirection === "decline" &&
    !opponentDeclineSpecific
  ) {
    positiveFactors.push(
      `${opposedVariance.team} is overperforming and due to regress down`
    );
  }

  // P4. Opponent's overperformance is attack-based — fragile, will break.
  //     "The ball's going to stop going in."
  if (opposedVariance.dominantType === "attack_overperf") {
    positiveFactors.push(
      `${opposedVariance.team}'s scoring is unsustainably above xG — fragile attack overperformance`
    );
  }

  // P5. Opponent is defensive overperformer — their luck is about to crack.
  //     "When the dam breaks, it breaks hard."
  if (opposedVariance.dominantType === "defense_overperf") {
    positiveFactors.push(
      `${opposedVariance.team}'s defensive overperformance is unsustainable — the dam will break`
    );
  }

  // P6. Large gap (8+ goals) — very strong signal regardless of decomposition.
  //     Ted: "8+ goals = this is likely mispriced."
  if (Math.abs(favoredVariance.totalVariance) >= 8) {
    positiveFactors.push(
      `${favoredVariance.team} has an extreme variance gap (${Math.abs(favoredVariance.totalVariance).toFixed(1)} goals) — almost certainly mispriced`
    );
  }

  // P7. Average or better team underperforming — they're decent but unlucky.
  if (
    favoredVariance.regressionDirection === "improve" &&
    favoredVariance.qualityTier === "average"
  ) {
    positiveFactors.push(
      `${favoredVariance.team} is average quality but underperforming — some regression expected`
    );
  }

  // ========================================
  // NEGATIVE CRITERIA — "when NOT to bet" (Ted)
  // Any negative = PASS.
  // ========================================
  const passReasons: string[] = [];

  // N1. Edge too small
  if (Math.abs(varianceEdge) < 0.04) {
    passReasons.push("Edge below 4% threshold — no significant variance gap");
  }

  // N2. Favored side has neutral signal (no real variance to exploit)
  if (favoredVariance.signal === "neutral") {
    passReasons.push("Favored side has no meaningful variance signal");
  }

  // N3. Low confidence
  if (favoredVariance.regressionConfidence < 0.6) {
    passReasons.push("Regression confidence too low");
  }

  // N4. Ted: Don't bet on genuinely bad teams just because they have variance
  if (
    favoredVariance.qualityTier === "bad" &&
    favoredVariance.regressionDirection === "improve"
  ) {
    passReasons.push(
      `${favoredVariance.team} has genuinely poor xGD — they're not unlucky, they're bad`
    );
  }

  // N5. Ted: Bad team with attack underperformance — weak signal on a weak team
  if (
    favoredVariance.regressionDirection === "improve" &&
    favoredVariance.dominantType === "attack_underperf" &&
    favoredVariance.qualityTier === "bad"
  ) {
    passReasons.push(
      `${favoredVariance.team}'s attack underperformance is on a genuinely weak team`
    );
  }

  // N6. Ted: Both teams are chaotic — coin flip with extra chaos
  if (
    Math.abs(homeVariance.totalVariance) > 5 &&
    Math.abs(awayVariance.totalVariance) > 5 &&
    homeVariance.regressionDirection !== awayVariance.regressionDirection &&
    Math.abs(varianceEdge) < 0.08
  ) {
    passReasons.push(
      "Both teams have large variance in opposite directions — chaotic matchup"
    );
  }

  // N7. Ted: Persistent defiance on the favored side
  if (favoredVariance.persistentDefiance) {
    passReasons.push(
      `${favoredVariance.team} has persistently defied the model (15+ matches) — trust the anomaly`
    );
  }

  // N8. Ted: Favored side's good results built on fragile attack overperformance
  if (
    favoredVariance.regressionDirection === "decline" &&
    favoredVariance.dominantType === "attack_overperf"
  ) {
    passReasons.push(
      `${favoredVariance.team}'s good results are built on fragile attack overperformance`
    );
  }

  // N9. No positive factors at all — Ted requires a thesis, not just absence of negatives.
  //     "The line is correct for me" = no reason to bet.
  if (positiveFactors.length === 0 && passReasons.length === 0) {
    passReasons.push(
      "No positive variance thesis — Ted requires a clear reason to bet, not just no reason to pass"
    );
  }

  // N10. Draw-prone matchup filter (v2 only — not in legacy mode).
  //      When the quality gap between teams is tiny (< 0.3 xGD/match), draws are
  //      much more likely (~30%+ in EPL). The Ted model picks a side but has zero
  //      draw awareness, so these bets hit draws at a catastrophic rate.
  //      Ted himself avoids tight matchups — "when two average teams play, the
  //      line is usually right."
  if (!legacy) {
    const qualityGap = Math.abs(
      homeVariance.xGDPerMatch - awayVariance.xGDPerMatch
    );
    if (qualityGap < 0.3 && edgeMagnitude !== "strong") {
      passReasons.push(
        `Draw-prone matchup: quality gap only ${qualityGap.toFixed(2)} xGD/match — high draw probability makes side bets unreliable`
      );
    }
  }

  // ========================================
  // DECISION + GRADING
  // ========================================
  const hasBet = passReasons.length === 0 && positiveFactors.length > 0;

  let betGrade: MatchVarianceAssessment["betGrade"] = null;
  if (hasBet) {
    if (legacy) {
      // V1: Simple count-based grading
      if (positiveFactors.length >= 3) betGrade = "A";
      else if (positiveFactors.length >= 2) betGrade = "B";
      else betGrade = "C";
    } else {
      // V2: Grade by SIGNAL DIMENSIONS, not raw factor count.
      // Dimensions: (1) favored team quality signal (P1/P7), (2) favored variance type (P2/P6),
      // (3) opponent regression signal (P3/P4/P5).
      // This prevents correlated factors (e.g. P3+P5) from double-counting.
      let dimensions = 0;
      const hasFavoredQuality = positiveFactors.some(
        (f) => f.includes("underlying quality") || f.includes("average quality")
      );
      if (hasFavoredQuality) dimensions++;
      const hasFavoredVarianceType = positiveFactors.some(
        (f) => f.includes("defensive underperformance") || f.includes("extreme variance gap")
      );
      if (hasFavoredVarianceType) dimensions++;
      const hasOpponentSignal = positiveFactors.some(
        (f) => f.includes("due to regress") || f.includes("unsustainable") || f.includes("fragile")
      );
      if (hasOpponentSignal) dimensions++;

      if (dimensions >= 3) betGrade = "A";
      else if (dimensions >= 2) betGrade = "B";
      else betGrade = "C";
    }
  }

  const betSide = hasBet ? edgeSide : null;
  const confidence = hasBet
    ? Math.min(favoredVariance.regressionConfidence, 0.95)
    : 0;

  const betReasoning = buildReasoning(
    homeVariance,
    awayVariance,
    edgeSide,
    varianceEdge,
    hasBet,
    passReasons
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
    betGrade,
    passReasons,
    positiveFactors,
  };
}
