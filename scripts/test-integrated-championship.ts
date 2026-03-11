/**
 * Integrated Championship Assessment — MI Model + Variance Model
 *
 * 1. Solve MI ratings from Championship odds data
 * 2. Predict upcoming matches
 * 3. Detect value bets (MI model edge vs market)
 * 4. Run variance model on same matches
 * 5. Combine signals for final recommendations
 */

import { readFileSync } from "fs";
import { join } from "path";

import { prepareMarketMatches } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import { computeAllPPG } from "../lib/mi-model/ppg-converter";
import { predictMatch, formatPrediction } from "../lib/mi-model/predictor";
import { detectValue, marketMatchToMarketOdds, DEFAULT_VALUE_CONFIG } from "../lib/mi-model/value-detector";
import type { ValueDetectorConfig, MarketOdds } from "../lib/mi-model/value-detector";
import { combineSignals, formatCombinedAssessment } from "../lib/mi-model/integration";
import type { MatchVarianceAssessment } from "../lib/variance/match-assessor";
import type { TeamVariance } from "../lib/variance/calculator";
import type { MISolverConfig } from "../lib/mi-model/types";

const projectRoot = join(import.meta.dirname || __dirname, "..");

// ─── Championship team xG data (from Fotmob, fetched 2026-03-10) ────────────
// Same data as championship-assess.mjs
const TEAMS: Record<string, {
  xGFor: number; xGAgainst: number; goalsFor: number; goalsAgainst: number;
  matches: number; homeGF: number; homeGA: number; homeMP: number;
  awayGF: number; awayGA: number; awayMP: number;
}> = {
  "Ipswich Town":          { xGFor: 58.85, xGAgainst: 32.18, goalsFor: 61, goalsAgainst: 35, matches: 35, homeGF: 35, homeGA: 13, homeMP: 19, awayGF: 26, awayGA: 22, awayMP: 16 },
  "Coventry City":         { xGFor: 65.74, xGAgainst: 38.92, goalsFor: 74, goalsAgainst: 38, matches: 36, homeGF: 36, homeGA: 13, homeMP: 17, awayGF: 38, awayGA: 25, awayMP: 19 },
  "Middlesbrough":         { xGFor: 48.99, xGAgainst: 33.55, goalsFor: 58, goalsAgainst: 35, matches: 36, homeGF: 26, homeGA: 12, homeMP: 17, awayGF: 32, awayGA: 23, awayMP: 19 },
  "Birmingham City":       { xGFor: 50.89, xGAgainst: 36.67, goalsFor: 46, goalsAgainst: 47, matches: 36, homeGF: 31, homeGA: 18, homeMP: 17, awayGF: 15, awayGA: 29, awayMP: 19 },
  "Southampton":           { xGFor: 59.19, xGAgainst: 42.91, goalsFor: 57, goalsAgainst: 46, matches: 35, homeGF: 26, homeGA: 14, homeMP: 17, awayGF: 31, awayGA: 32, awayMP: 18 },
  "Sheffield United":      { xGFor: 55.66, xGAgainst: 43.46, goalsFor: 51, goalsAgainst: 49, matches: 36, homeGF: 29, homeGA: 21, homeMP: 18, awayGF: 22, awayGA: 28, awayMP: 18 },
  "Millwall":              { xGFor: 50.49, xGAgainst: 43.65, goalsFor: 50, goalsAgainst: 41, matches: 36, homeGF: 26, homeGA: 21, homeMP: 18, awayGF: 24, awayGA: 20, awayMP: 18 },
  "Watford":               { xGFor: 43.76, xGAgainst: 36.27, goalsFor: 45, goalsAgainst: 41, matches: 35, homeGF: 26, homeGA: 19, homeMP: 18, awayGF: 19, awayGA: 22, awayMP: 17 },
  "West Bromwich Albion":  { xGFor: 41.69, xGAgainst: 38.09, goalsFor: 35, goalsAgainst: 53, matches: 36, homeGF: 19, homeGA: 22, homeMP: 17, awayGF: 16, awayGA: 31, awayMP: 19 },
  "Blackburn Rovers":      { xGFor: 44.71, xGAgainst: 40.28, goalsFor: 34, goalsAgainst: 47, matches: 36, homeGF: 18, homeGA: 25, homeMP: 19, awayGF: 16, awayGA: 22, awayMP: 17 },
  "Derby County":          { xGFor: 41.88, xGAgainst: 42.41, goalsFor: 54, goalsAgainst: 47, matches: 36, homeGF: 26, homeGA: 25, homeMP: 19, awayGF: 28, awayGA: 22, awayMP: 17 },
  "Queens Park Rangers":   { xGFor: 42.04, xGAgainst: 44.33, goalsFor: 46, goalsAgainst: 58, matches: 36, homeGF: 29, homeGA: 30, homeMP: 18, awayGF: 17, awayGA: 28, awayMP: 18 },
  "Portsmouth":            { xGFor: 39.51, xGAgainst: 40.53, goalsFor: 35, goalsAgainst: 45, matches: 35, homeGF: 18, homeGA: 17, homeMP: 17, awayGF: 17, awayGA: 28, awayMP: 18 },
  "Bristol City":          { xGFor: 44.61, xGAgainst: 45.83, goalsFor: 48, goalsAgainst: 46, matches: 36, homeGF: 28, homeGA: 26, homeMP: 19, awayGF: 20, awayGA: 20, awayMP: 17 },
  "Wrexham":               { xGFor: 43.64, xGAgainst: 44.93, goalsFor: 54, goalsAgainst: 45, matches: 35, homeGF: 33, homeGA: 28, homeMP: 18, awayGF: 21, awayGA: 17, awayMP: 17 },
  "Norwich City":          { xGFor: 46.39, xGAgainst: 50.39, goalsFor: 47, goalsAgainst: 44, matches: 35, homeGF: 19, homeGA: 22, homeMP: 17, awayGF: 28, awayGA: 22, awayMP: 18 },
  "Stoke City":            { xGFor: 37.66, xGAgainst: 47.42, goalsFor: 39, goalsAgainst: 36, matches: 36, homeGF: 23, homeGA: 17, homeMP: 17, awayGF: 16, awayGA: 19, awayMP: 19 },
  "Leicester City":        { xGFor: 35.99, xGAgainst: 42.09, goalsFor: 45, goalsAgainst: 48, matches: 36, homeGF: 23, homeGA: 25, homeMP: 17, awayGF: 22, awayGA: 23, awayMP: 19 },
  "Hull City":             { xGFor: 47.18, xGAgainst: 47.33, goalsFor: 51, goalsAgainst: 43, matches: 36, homeGF: 23, homeGA: 22, homeMP: 19, awayGF: 28, awayGA: 21, awayMP: 17 },
  "Preston North End":     { xGFor: 38.62, xGAgainst: 51.81, goalsFor: 42, goalsAgainst: 43, matches: 36, homeGF: 23, homeGA: 23, homeMP: 19, awayGF: 19, awayGA: 20, awayMP: 17 },
  "Oxford United":         { xGFor: 35.33, xGAgainst: 51.55, goalsFor: 31, goalsAgainst: 47, matches: 36, homeGF: 15, homeGA: 23, homeMP: 17, awayGF: 16, awayGA: 24, awayMP: 19 },
  "Sheffield Wednesday":   { xGFor: 30.45, xGAgainst: 62.83, goalsFor: 30, goalsAgainst: 61, matches: 36, homeGF: 9, homeGA: 38, homeMP: 18, awayGF: 21, awayGA: 23, awayMP: 18 },
  "Charlton Athletic":     { xGFor: 35.99, xGAgainst: 54.19, goalsFor: 34, goalsAgainst: 52, matches: 36, homeGF: 18, homeGA: 26, homeMP: 18, awayGF: 16, awayGA: 26, awayMP: 18 },
  "Luton Town":            { xGFor: 38.37, xGAgainst: 52.42, goalsFor: 29, goalsAgainst: 52, matches: 36, homeGF: 14, homeGA: 23, homeMP: 19, awayGF: 15, awayGA: 29, awayMP: 17 },
};

// ─── Upcoming Championship fixtures ──────────────────────────────────────────
// football-data.co.uk uses short team names, Fotmob uses full names
// Map Fotmob names → football-data names for team matching
const FOTMOB_TO_FD: Record<string, string> = {
  "Ipswich Town": "Ipswich",
  "Coventry City": "Coventry",
  "Middlesbrough": "Middlesbrough",
  "Birmingham City": "Birmingham",
  "Southampton": "Southampton",
  "Sheffield United": "Sheffield Utd",
  "Millwall": "Millwall",
  "Watford": "Watford",
  "West Bromwich Albion": "West Brom",
  "Blackburn Rovers": "Blackburn",
  "Derby County": "Derby",
  "Queens Park Rangers": "QPR",
  "Portsmouth": "Portsmouth",
  "Bristol City": "Bristol City",
  "Wrexham": "Wrexham",
  "Norwich City": "Norwich",
  "Stoke City": "Stoke",
  "Leicester City": "Leicester",
  "Hull City": "Hull",
  "Preston North End": "Preston",
  "Oxford United": "Oxford",
  "Sheffield Wednesday": "Sheffield Wed",
  "Charlton Athletic": "Charlton",
  "Luton Town": "Luton",
};

const FD_TO_FOTMOB = Object.fromEntries(
  Object.entries(FOTMOB_TO_FD).map(([k, v]) => [v, k])
);

const UPCOMING = [
  { home: "Coventry City", away: "Southampton", date: "2026-03-14" },
  { home: "Middlesbrough", away: "Bristol City", date: "2026-03-14" },
  { home: "Oxford United", away: "Charlton Athletic", date: "2026-03-14" },
  { home: "Birmingham City", away: "Sheffield United", date: "2026-03-14" },
  { home: "Leicester City", away: "Queens Park Rangers", date: "2026-03-14" },
  { home: "Millwall", away: "Blackburn Rovers", date: "2026-03-14" },
  { home: "Norwich City", away: "Preston North End", date: "2026-03-14" },
  { home: "Sheffield Wednesday", away: "Ipswich Town", date: "2026-03-14" },
  { home: "Stoke City", away: "Watford", date: "2026-03-14" },
  { home: "West Bromwich Albion", away: "Hull City", date: "2026-03-14" },
  { home: "Portsmouth", away: "Derby County", date: "2026-03-16" },
  { home: "Watford", away: "Wrexham", date: "2026-03-17" },
  { home: "Southampton", away: "Norwich City", date: "2026-03-18" },
  { home: "Preston North End", away: "Stoke City", date: "2026-03-20" },
];

// ─── Variance model (simplified from championship-assess.mjs) ───────────────

function r(n: number): number { return Math.round(n * 100) / 100; }

function computeVenueXG(teamName: string, venue: "h" | "a") {
  const t = TEAMS[teamName];
  if (!t) return null;

  const totalGF = t.goalsFor || 1;
  const totalGA = t.goalsAgainst || 1;
  const homeGFRatio = t.homeGF / totalGF;
  const homeGARatio = t.homeGA / totalGA;
  const awayGFRatio = t.awayGF / totalGF;
  const awayGARatio = t.awayGA / totalGA;

  const mp = venue === "h" ? t.homeMP : t.awayMP;
  const gf = venue === "h" ? t.homeGF : t.awayGF;
  const ga = venue === "h" ? t.homeGA : t.awayGA;
  const xGFor = t.xGFor * (venue === "h" ? homeGFRatio : awayGFRatio);
  const xGAgainst = t.xGAgainst * (venue === "h" ? homeGARatio : awayGARatio);

  return { mp, gf, ga, xGFor, xGAgainst };
}

function analyzeTeamVariance(teamName: string, venue: "h" | "a"): TeamVariance | null {
  const v = computeVenueXG(teamName, venue);
  if (!v) return null;
  const { mp, gf, ga, xGFor, xGAgainst } = v;
  const t = TEAMS[teamName];

  const xGD = xGFor - xGAgainst;
  const actualGD = gf - ga;
  const attackVar = gf - xGFor;
  const defenseVar = ga - xGAgainst;
  const totalVar = actualGD - xGD;
  const xGDPerMatch = xGD / mp;

  let adjXGD = xGDPerMatch;
  if (venue === "h") adjXGD -= 0.3;
  if (venue === "a") adjXGD += 0.2;

  const qualityTier =
    adjXGD >= 1.0 ? "elite" as const : adjXGD >= 0.3 ? "good" as const : adjXGD >= -0.3 ? "average" as const : adjXGD >= -0.8 ? "poor" as const : "bad" as const;

  const absTotal = Math.abs(totalVar);
  let signal: TeamVariance["signal"] = "neutral";
  if (absTotal >= 5) signal = totalVar > 0 ? "strong_positive" : "strong_negative";
  else if (absTotal >= 3) signal = totalVar > 0 ? "weak_positive" : "weak_negative";

  const absAtk = Math.abs(attackVar);
  const absDef = Math.abs(defenseVar);
  let dominantType: TeamVariance["dominantType"] = "balanced";
  if (absAtk < 2 && absDef < 2) dominantType = "balanced";
  else if (absAtk > absDef) dominantType = attackVar > 0 ? "attack_overperf" : "attack_underperf";
  else dominantType = defenseVar > 0 ? "defense_underperf" : "defense_overperf";

  const persistentDefiance = mp >= 15 && absTotal > 5;
  const doubleVariance = attackVar > 2 && defenseVar > 2;

  let confidence = 0.5;
  if (absTotal > 5) confidence += 0.2;
  if (absTotal > 8) confidence += 0.1;
  if (dominantType === "defense_underperf") confidence += 0.15;
  if (dominantType === "attack_overperf") confidence -= 0.1;
  if (mp >= 10) confidence += 0.1;
  if (mp < 5) confidence -= 0.15;
  if (persistentDefiance) confidence -= 0.2;
  if (qualityTier === "bad") confidence -= 0.15;
  if (qualityTier === "poor") confidence -= 0.05;
  confidence = Math.max(0, Math.min(1, confidence));

  let regressionDirection: TeamVariance["regressionDirection"] = "stable";
  if (signal.includes("positive")) regressionDirection = "decline";
  else if (signal.includes("negative")) regressionDirection = "improve";

  return {
    team: teamName,
    matches: mp,
    xG: r(xGFor),
    xGA: r(xGAgainst),
    goals: gf,
    goalsConceded: ga,
    xGD: r(xGD),
    actualGD,
    attackVariance: r(attackVar),
    defenseVariance: r(defenseVar),
    totalVariance: r(totalVar),
    attackVariancePct: r(gf / xGFor),
    defenseVariancePct: r(ga / xGAgainst),
    xGDPerMatch: r(xGDPerMatch),
    qualityTier,
    signal,
    dominantType,
    persistentDefiance,
    doubleVariance,
    regressionConfidence: r(confidence),
    regressionDirection,
    explanation: `${signal} variance (${dominantType})`,
  };
}

function assessMatchVariance(homeV: TeamVariance, awayV: TeamVariance): MatchVarianceAssessment {
  const homeRegressionBenefit = (-homeV.totalVariance / 100) * homeV.regressionConfidence;
  const awayRegressionBenefit = (-awayV.totalVariance / 100) * awayV.regressionConfidence;
  const varianceEdge = homeRegressionBenefit - awayRegressionBenefit;

  let edgeSide: "home" | "away" | "neutral" = "neutral";
  if (varianceEdge > 0.02) edgeSide = "home";
  else if (varianceEdge < -0.02) edgeSide = "away";

  const absEdge = Math.abs(varianceEdge);
  const magnitude: "strong" | "moderate" | "weak" | "none" =
    absEdge >= 0.15 ? "strong" : absEdge >= 0.08 ? "moderate" : absEdge >= 0.04 ? "weak" : "none";

  const favV = varianceEdge > 0 ? homeV : awayV;
  const oppV = varianceEdge > 0 ? awayV : homeV;

  const pos: string[] = [];
  if (favV.regressionDirection === "improve" && (favV.qualityTier === "good" || favV.qualityTier === "elite"))
    pos.push(`${favV.team} has strong underlying quality (${favV.qualityTier} xGD) but results haven't caught up`);
  if (favV.dominantType === "defense_underperf")
    pos.push(`${favV.team}'s variance is driven by defensive underperformance — the most reliable regression signal`);
  if (oppV.regressionDirection === "decline" && oppV.dominantType !== "attack_overperf" && oppV.dominantType !== "defense_overperf")
    pos.push(`${oppV.team} is overperforming and due to regress down`);
  if (oppV.dominantType === "attack_overperf")
    pos.push(`${oppV.team}'s scoring is unsustainably above xG — fragile attack overperformance`);
  if (oppV.dominantType === "defense_overperf")
    pos.push(`${oppV.team}'s defensive overperformance is unsustainable — the dam will break`);
  if (Math.abs(favV.totalVariance) >= 8)
    pos.push(`${favV.team} has an extreme variance gap (${Math.abs(favV.totalVariance).toFixed(1)} goals) — almost certainly mispriced`);
  if (favV.regressionDirection === "improve" && favV.qualityTier === "average")
    pos.push(`${favV.team} is average quality but underperforming — some regression expected`);
  if (oppV.doubleVariance)
    pos.push(`${oppV.team} has double variance — both attack and defense components are fragile and due to regress`);

  // Optimized pass reasons (from sweep: edge=0.02, conf=0.7, drawGap=0.20, persist=OFF)
  const pass: string[] = [];
  if (absEdge < 0.02) pass.push("Edge below 2% threshold");
  if (favV.signal === "neutral") pass.push("Favored side has no meaningful variance signal");
  if (favV.regressionConfidence < 0.7) pass.push("Regression confidence too low");
  if (favV.qualityTier === "bad" && favV.regressionDirection === "improve")
    pass.push(`${favV.team} has genuinely poor xGD — they're not unlucky, they're bad`);
  // persistentDefiance filter DISABLED — sweep proved it's toxic to ROI
  if (favV.doubleVariance)
    pass.push(`${favV.team} has double variance (attack overperf + defense underperf) — apparent stability is illusory`);

  const qualityGap = Math.abs(homeV.xGDPerMatch - awayV.xGDPerMatch);
  if (qualityGap < 0.20 && magnitude !== "strong")
    pass.push(`Draw-prone matchup: quality gap only ${qualityGap.toFixed(2)} xGD/match`);

  if (pos.length === 0 && pass.length === 0)
    pass.push("No positive variance thesis");

  const hasBet = pass.length === 0 && pos.length > 0;

  let betGrade: "A" | "B" | "C" | null = null;
  if (hasBet) {
    let dims = 0;
    if (pos.some(f => f.includes("underlying quality") || f.includes("average quality"))) dims++;
    if (pos.some(f => f.includes("defensive underperformance") || f.includes("extreme variance gap"))) dims++;
    if (pos.some(f => f.includes("due to regress") || f.includes("unsustainable") || f.includes("fragile"))) dims++;
    betGrade = dims >= 3 ? "A" : dims >= 2 ? "B" : "C";
  }

  return {
    homeTeam: homeV.team,
    awayTeam: awayV.team,
    homeVariance: homeV,
    awayVariance: awayV,
    varianceEdge: r(varianceEdge),
    edgeSide,
    edgeMagnitude: magnitude,
    hasBet,
    betSide: hasBet ? edgeSide : null,
    betReasoning: hasBet
      ? `Variance edge: ${(absEdge * 100).toFixed(1)}% favoring ${edgeSide === "home" ? homeV.team : awayV.team}.`
      : `No bet. ${pass.slice(0, 2).join("; ")}.`,
    confidence: hasBet ? r(Math.min(favV.regressionConfidence, 0.95)) : 0,
    betGrade,
    passReasons: pass,
    positiveFactors: pos,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════");
console.log("  CHAMPIONSHIP — INTEGRATED MI + VARIANCE MODEL");
console.log("  Generated: " + new Date().toISOString());
console.log("═══════════════════════════════════════════════════════════════\n");

// Step 1: Load Championship odds data and solve MI ratings
console.log("[PROGRESS] Step 1: Loading Championship odds data...");

const dataDir = join(projectRoot, "data/football-data-cache");
const seasons = ["2023-24", "2024-25"];
let allMarketMatches: any[] = [];

for (const season of seasons) {
  const filePath = join(dataDir, `championship-${season}.json`);
  try {
    const rawData = JSON.parse(readFileSync(filePath, "utf-8"));
    const matches = prepareMarketMatches(rawData, {
      useClosing: true,
      requirePinnacle: true,
    });
    console.log(`  ${season}: ${matches.length} matches with Pinnacle odds`);
    allMarketMatches.push(...matches);
  } catch (e: any) {
    console.log(`  ${season}: SKIP — ${e.message}`);
  }
}

console.log(`  Total: ${allMarketMatches.length} market matches loaded\n`);

// Step 2: Solve ratings
console.log("[PROGRESS] Step 2: Solving MI ratings (coordinate descent)...");

const solverConfig: MISolverConfig = {
  maxIterations: 200,
  convergenceThreshold: 1e-6,
  attackRange: [0.3, 3.0],
  defenseRange: [0.3, 3.0],
  homeAdvantageRange: [0.8, 1.8],
  lambda3Range: [-0.15, 0.05],
  avgGoalRateRange: [1.0, 1.8],
  gridSteps: 30,
  decayRate: 0.005,
  regularization: 0.001,
  klWeight: 1.0,
  ahWeight: 0.3,
  printEvery: 10,
  driftFactor: 0.1, // Championship uses rating drift
  outcomeWeight: 0.3, xgWeight: 0.2, recentFormBoost: 1.5,
};

const params = solveRatings(allMarketMatches, "championship", "2024-25", solverConfig);

console.log(`\n  Converged: ${params.convergenceInfo.converged ? "YES" : "NO"} (${params.convergenceInfo.iterations} iterations)`);
console.log(`  Home advantage: ${params.homeAdvantage.toFixed(3)}`);
console.log(`  Correlation: ${params.correlation.toFixed(4)}`);
console.log(`  Avg goal rate: ${params.avgGoalRate.toFixed(3)}`);

// Step 3: Compute PPG
console.log("\n[PROGRESS] Step 3: Computing PPG ratings...");
computeAllPPG(params);

const sorted = Object.values(params.teams).sort((a, b) => b.ppg - a.ppg);
console.log("\n  Championship MI Ratings (top 10):");
console.log("  " + "-".repeat(65));
console.log(`  ${"Team".padEnd(25)} ${"Attack".padStart(8)} ${"Defense".padStart(8)} ${"PPG".padStart(6)}`);
console.log("  " + "-".repeat(65));
for (const t of sorted.slice(0, 10)) {
  console.log(`  ${t.team.padEnd(25)} ${t.attack.toFixed(3).padStart(8)} ${t.defense.toFixed(3).padStart(8)} ${t.ppg.toFixed(2).padStart(6)}`);
}
console.log(`  ... (${sorted.length - 10} more teams)`);

// Step 4: Predict upcoming matches and detect value
console.log("\n[PROGRESS] Step 4: Predicting upcoming matches & detecting value...\n");

const valueConfig: ValueDetectorConfig = {
  minEdge: 0.03,
  markets: ["1x2", "over_under"],
  minModelProb: 0.05,
};

const results: {
  fixture: typeof UPCOMING[0];
  combined: ReturnType<typeof combineSignals>;
}[] = [];

for (let i = 0; i < UPCOMING.length; i++) {
  const fixture = UPCOMING[i];
  console.log(`[PROGRESS] Match ${i + 1}/${UPCOMING.length}: ${fixture.home} vs ${fixture.away}`);

  // Find teams in MI model (football-data uses short names)
  const homeFD = FOTMOB_TO_FD[fixture.home] ?? fixture.home;
  const awayFD = FOTMOB_TO_FD[fixture.away] ?? fixture.away;

  // MI prediction
  let prediction = null;
  let valueBets: any[] = [];
  try {
    prediction = predictMatch(params, homeFD, awayFD);

    // Use the last available market odds for this matchup as the "market"
    // In live use, this would come from the odds API
    const lastMatch = allMarketMatches.filter(
      m => (m.homeTeam === homeFD && m.awayTeam === awayFD) ||
           (m.homeTeam === awayFD && m.awayTeam === homeFD)
    ).pop();

    // Find the most recent head-to-head market odds from the same venue
    const h2h = allMarketMatches.filter(
      m => m.homeTeam === homeFD && m.awayTeam === awayFD
    );
    // Also try reversed fixture for general team pricing
    const reverseH2h = allMarketMatches.filter(
      m => m.homeTeam === awayFD && m.awayTeam === homeFD
    );

    if (h2h.length > 0) {
      // Use most recent same-venue H2H
      const lastH2H = h2h[h2h.length - 1];
      valueBets = detectValue(prediction, {
        matchId: `${fixture.home}-vs-${fixture.away}`,
        homeTeam: homeFD,
        awayTeam: awayFD,
        home1X2: lastH2H.marketProbs.home,
        draw1X2: lastH2H.marketProbs.draw,
        away1X2: lastH2H.marketProbs.away,
      }, valueConfig);
    } else {
      // No direct H2H — estimate market odds from recent matches for each team
      // This is a rough proxy; in production we'd use live odds API
      const homeRecent = allMarketMatches.filter(m => m.homeTeam === homeFD).slice(-5);
      const awayRecent = allMarketMatches.filter(m => m.awayTeam === awayFD).slice(-5);
      if (homeRecent.length > 0 && awayRecent.length > 0) {
        // Average implied home win% when this team plays at home
        const avgHomeWin = homeRecent.reduce((s, m) => s + m.marketProbs.home, 0) / homeRecent.length;
        const avgAwayWin = awayRecent.reduce((s, m) => s + m.marketProbs.away, 0) / awayRecent.length;
        const avgDraw = 1 - avgHomeWin - avgAwayWin;
        const estDraw = Math.max(0.1, Math.min(0.4, avgDraw));
        const total = avgHomeWin + estDraw + avgAwayWin;

        valueBets = detectValue(prediction, {
          matchId: `${fixture.home}-vs-${fixture.away}`,
          homeTeam: homeFD,
          awayTeam: awayFD,
          home1X2: avgHomeWin / total,
          draw1X2: estDraw / total,
          away1X2: avgAwayWin / total,
        }, valueConfig);
      }
    }
  } catch (e: any) {
    console.log(`  MI model: SKIP — ${e.message}`);
  }

  // Variance assessment
  const homeV = analyzeTeamVariance(fixture.home, "h");
  const awayV = analyzeTeamVariance(fixture.away, "a");
  let varianceAssessment: MatchVarianceAssessment | null = null;
  if (homeV && awayV) {
    varianceAssessment = assessMatchVariance(homeV, awayV);
  }

  // Combine signals
  const combined = combineSignals(prediction, valueBets, varianceAssessment);
  results.push({ fixture, combined });
}

// Step 5: Print results
console.log("\n\n═══════════════════════════════════════════════════════════════");
console.log("  RESULTS — CHAMPIONSHIP INTEGRATED ASSESSMENT");
console.log("═══════════════════════════════════════════════════════════════");

let totalBets = 0;
for (const { combined } of results) {
  console.log(formatCombinedAssessment(combined));
  if (combined.finalBets.length > 0) totalBets += combined.finalBets.length;
}

// Summary table
console.log("\n\n═══════════════════════════════════════════════════════════════");
console.log("  QUICK REFERENCE");
console.log("═══════════════════════════════════════════════════════════════\n");

console.log(`${"Match".padEnd(42)} ${"MI".padEnd(15)} ${"Var".padEnd(15)} ${"Signal".padEnd(16)} ${"Bets"}`);
console.log("-".repeat(95));
for (const { combined: c } of results) {
  const matchLabel = `${c.homeTeam} v ${c.awayTeam}`.substring(0, 40);
  const miLabel = c.miHasBet ? `${c.miBestSelection} +${((c.miBestEdge) * 100).toFixed(1)}%` : "—";
  const varLabel = c.varianceHasBet ? `${c.varianceBetSide} G${c.varianceGrade}` : "—";
  const signalLabel = c.combinedSignal ?? "PASS";
  const betCount = c.finalBets.length;
  console.log(`${matchLabel.padEnd(42)} ${miLabel.padEnd(15)} ${varLabel.padEnd(15)} ${signalLabel.padEnd(16)} ${betCount}`);
}

console.log(`\nTotal recommended bets: ${totalBets}`);
console.log("\n[DONE]");
