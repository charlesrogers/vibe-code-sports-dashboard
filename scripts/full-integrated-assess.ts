/**
 * Full Integrated Assessment — MI Model + Variance + LIVE Pinnacle Odds
 *
 * Pipeline:
 *   1. Load historical odds → solve MI ratings (Championship + EPL for UCL teams)
 *   2. Load LIVE Pinnacle odds → devig to fair market probabilities
 *   3. MI model predicts each match → compare vs live market → find edges
 *   4. Run variance model on same matches
 *   5. Combine signals → final recommendations
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

// Load env
const envPath = join(import.meta.dirname || __dirname, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

import { prepareMarketMatches, devigOdds1X2 } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import { computeAllPPG } from "../lib/mi-model/ppg-converter";
import { predictMatch } from "../lib/mi-model/predictor";
import { detectValue } from "../lib/mi-model/value-detector";
import type { ValueDetectorConfig, MarketOdds } from "../lib/mi-model/value-detector";
import { combineSignals, formatCombinedAssessment } from "../lib/mi-model/integration";
import type { MatchVarianceAssessment } from "../lib/variance/match-assessor";
import type { TeamVariance } from "../lib/variance/calculator";
import type { MISolverConfig, MatchPrediction } from "../lib/mi-model/types";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const r = (n: number) => Math.round(n * 100) / 100;

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Load live odds snapshots
// ═══════════════════════════════════════════════════════════════════════════════

function loadLiveOdds(league: string): any[] {
  const dir = join(projectRoot, "data", "live-odds");
  const today = new Date().toISOString().split("T")[0];
  const path = join(dir, `${league}-live-${today}.json`);
  if (!existsSync(path)) {
    console.log(`  No live odds file: ${path}`);
    return [];
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Championship variance data (Fotmob aggregate xG)
// ═══════════════════════════════════════════════════════════════════════════════

const CHAMP_TEAMS: Record<string, {
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
  "Wrexham AFC":           { xGFor: 43.64, xGAgainst: 44.93, goalsFor: 54, goalsAgainst: 45, matches: 35, homeGF: 33, homeGA: 28, homeMP: 18, awayGF: 21, awayGA: 17, awayMP: 17 },
  "Norwich City":          { xGFor: 46.39, xGAgainst: 50.39, goalsFor: 47, goalsAgainst: 44, matches: 35, homeGF: 19, homeGA: 22, homeMP: 17, awayGF: 28, awayGA: 22, awayMP: 18 },
  "Stoke City":            { xGFor: 37.66, xGAgainst: 47.42, goalsFor: 39, goalsAgainst: 36, matches: 36, homeGF: 23, homeGA: 17, homeMP: 17, awayGF: 16, awayGA: 19, awayMP: 19 },
  "Leicester City":        { xGFor: 35.99, xGAgainst: 42.09, goalsFor: 45, goalsAgainst: 48, matches: 36, homeGF: 23, homeGA: 25, homeMP: 17, awayGF: 22, awayGA: 23, awayMP: 19 },
  "Hull City":             { xGFor: 47.18, xGAgainst: 47.33, goalsFor: 51, goalsAgainst: 43, matches: 36, homeGF: 23, homeGA: 22, homeMP: 19, awayGF: 28, awayGA: 21, awayMP: 17 },
  "Preston North End":     { xGFor: 38.62, xGAgainst: 51.81, goalsFor: 42, goalsAgainst: 43, matches: 36, homeGF: 23, homeGA: 23, homeMP: 19, awayGF: 19, awayGA: 20, awayMP: 17 },
  "Oxford United":         { xGFor: 35.33, xGAgainst: 51.55, goalsFor: 31, goalsAgainst: 47, matches: 36, homeGF: 15, homeGA: 23, homeMP: 17, awayGF: 16, awayGA: 24, awayMP: 19 },
  "Sheffield Wednesday":   { xGFor: 30.45, xGAgainst: 62.83, goalsFor: 30, goalsAgainst: 61, matches: 36, homeGF: 9, homeGA: 38, homeMP: 18, awayGF: 21, awayGA: 23, awayMP: 18 },
  "Charlton Athletic":     { xGFor: 35.99, xGAgainst: 54.19, goalsFor: 34, goalsAgainst: 52, matches: 36, homeGF: 18, homeGA: 26, homeMP: 18, awayGF: 16, awayGA: 26, awayMP: 18 },
  "Luton Town":            { xGFor: 38.37, xGAgainst: 52.42, goalsFor: 29, goalsAgainst: 52, matches: 36, homeGF: 14, homeGA: 23, homeMP: 19, awayGF: 15, awayGA: 29, awayMP: 17 },
  "Swansea City":          { xGFor: 40.0, xGAgainst: 42.0, goalsFor: 38, goalsAgainst: 42, matches: 36, homeGF: 20, homeGA: 18, homeMP: 18, awayGF: 18, awayGA: 24, awayMP: 18 },
};

// Map live odds team names → football-data team names (MI model uses these)
const ODDS_TO_FD: Record<string, string> = {
  "Ipswich": "Ipswich",
  "Ipswich Town": "Ipswich",
  "Coventry City": "Coventry",
  "Coventry": "Coventry",
  "Middlesbrough": "Middlesbrough",
  "Birmingham City": "Birmingham",
  "Birmingham": "Birmingham",
  "Southampton": "Southampton",
  "Sheffield Utd": "Sheffield Utd",
  "Sheffield United": "Sheffield Utd",
  "Millwall": "Millwall",
  "Watford": "Watford",
  "West Bromwich Albion": "West Brom",
  "West Brom": "West Brom",
  "Blackburn Rovers": "Blackburn",
  "Blackburn": "Blackburn",
  "Derby County": "Derby",
  "Derby": "Derby",
  "Queens Park Rangers": "QPR",
  "QPR": "QPR",
  "Portsmouth": "Portsmouth",
  "Bristol City": "Bristol City",
  "Wrexham AFC": "Wrexham",
  "Wrexham": "Wrexham",
  "Norwich City": "Norwich",
  "Norwich": "Norwich",
  "Stoke City": "Stoke",
  "Stoke": "Stoke",
  "Leicester City": "Leicester",
  "Leicester": "Leicester",
  "Hull City": "Hull",
  "Hull": "Hull",
  "Preston North End": "Preston",
  "Preston": "Preston",
  "Oxford United": "Oxford",
  "Sheffield Wednesday": "Sheffield Wed",
  "Sheffield Wed": "Sheffield Wed",
  "Charlton Athletic": "Charlton",
  "Charlton": "Charlton",
  "Luton Town": "Luton",
  "Luton": "Luton",
  "Swansea City": "Swansea",
  "Swansea": "Swansea",
};

// Map live odds team names → Fotmob team names (variance model uses these)
const ODDS_TO_FOTMOB: Record<string, string> = {
  "Ipswich": "Ipswich Town",
  "Ipswich Town": "Ipswich Town",
  "Leicester": "Leicester City",
  "Leicester City": "Leicester City",
  "Coventry": "Coventry City",
  "Coventry City": "Coventry City",
  "Birmingham": "Birmingham City",
  "Birmingham City": "Birmingham City",
  "QPR": "Queens Park Rangers",
  "Queens Park Rangers": "Queens Park Rangers",
  "Derby": "Derby County",
  "Derby County": "Derby County",
  "Hull": "Hull City",
  "Hull City": "Hull City",
  "Stoke": "Stoke City",
  "Stoke City": "Stoke City",
  "Norwich": "Norwich City",
  "Norwich City": "Norwich City",
  "Preston": "Preston North End",
  "Preston North End": "Preston North End",
  "Oxford": "Oxford United",
  "Oxford United": "Oxford United",
  "Sheffield Wed": "Sheffield Wednesday",
  "Sheffield Wednesday": "Sheffield Wednesday",
  "Blackburn": "Blackburn Rovers",
  "Blackburn Rovers": "Blackburn Rovers",
  "West Brom": "West Bromwich Albion",
  "West Bromwich Albion": "West Bromwich Albion",
  "Charlton": "Charlton Athletic",
  "Charlton Athletic": "Charlton Athletic",
  "Luton": "Luton Town",
  "Luton Town": "Luton Town",
  "Wrexham AFC": "Wrexham AFC",
  "Swansea City": "Swansea City",
  "Swansea": "Swansea City",
};

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: Variance model (same logic as championship-assess.mjs)
// ═══════════════════════════════════════════════════════════════════════════════

function computeVenueXG(teamName: string, venue: "h" | "a") {
  const t = CHAMP_TEAMS[teamName];
  if (!t) return null;
  const totalGF = t.goalsFor || 1;
  const totalGA = t.goalsAgainst || 1;
  const mp = venue === "h" ? t.homeMP : t.awayMP;
  const gf = venue === "h" ? t.homeGF : t.awayGF;
  const ga = venue === "h" ? t.homeGA : t.awayGA;
  const xGFor = t.xGFor * ((venue === "h" ? t.homeGF : t.awayGF) / totalGF);
  const xGAgainst = t.xGAgainst * ((venue === "h" ? t.homeGA : t.awayGA) / totalGA);
  return { mp, gf, ga, xGFor, xGAgainst };
}

function analyzeTeamVariance(teamName: string, venue: "h" | "a"): TeamVariance | null {
  const v = computeVenueXG(teamName, venue);
  if (!v) return null;
  const { mp, gf, ga, xGFor, xGAgainst } = v;

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
    team: teamName, matches: mp,
    xGFor: r(xGFor), xGAgainst: r(xGAgainst), goalsFor: gf, goalsAgainst: ga,
    xGD: r(xGD), actualGD,
    attackVariance: r(attackVar), defenseVariance: r(defenseVar), totalVariance: r(totalVar),
    xGDPerMatch: r(xGDPerMatch), qualityTier, signal, dominantType,
    persistentDefiance, doubleVariance,
    regressionConfidence: r(confidence), regressionDirection,
    trend: null, lastNVariance: null,
  };
}

function assessMatchVariance(homeV: TeamVariance, awayV: TeamVariance): MatchVarianceAssessment {
  const homeReg = (-homeV.totalVariance / 100) * homeV.regressionConfidence;
  const awayReg = (-awayV.totalVariance / 100) * awayV.regressionConfidence;
  const varianceEdge = homeReg - awayReg;

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
    pos.push(`${favV.team} quality+underperformance`);
  if (favV.dominantType === "defense_underperf")
    pos.push(`${favV.team} defensive underperformance`);
  if (oppV.regressionDirection === "decline" && oppV.dominantType !== "attack_overperf" && oppV.dominantType !== "defense_overperf")
    pos.push(`${oppV.team} due to regress down`);
  if (oppV.dominantType === "attack_overperf")
    pos.push(`${oppV.team} fragile attack overperf`);
  if (oppV.dominantType === "defense_overperf")
    pos.push(`${oppV.team} unsustainable defense overperf`);
  if (Math.abs(favV.totalVariance) >= 8)
    pos.push(`${favV.team} extreme variance (${Math.abs(favV.totalVariance).toFixed(1)}g)`);
  if (favV.regressionDirection === "improve" && favV.qualityTier === "average")
    pos.push(`${favV.team} average but underperforming`);
  if (oppV.doubleVariance)
    pos.push(`${oppV.team} double variance`);

  // Optimized thresholds
  const pass: string[] = [];
  if (absEdge < 0.02) pass.push("Edge <2%");
  if (favV.signal === "neutral") pass.push("No variance signal");
  if (favV.regressionConfidence < 0.7) pass.push("Low confidence");
  if (favV.qualityTier === "bad" && favV.regressionDirection === "improve")
    pass.push(`${favV.team} genuinely bad`);
  if (favV.doubleVariance)
    pass.push(`${favV.team} double variance`);
  const qualityGap = Math.abs(homeV.xGDPerMatch - awayV.xGDPerMatch);
  if (qualityGap < 0.20 && magnitude !== "strong")
    pass.push(`Draw-prone (gap ${qualityGap.toFixed(2)})`);
  if (pos.length === 0 && pass.length === 0)
    pass.push("No positive thesis");

  const hasBet = pass.length === 0 && pos.length > 0;

  let betGrade: "A" | "B" | "C" | null = null;
  if (hasBet) {
    let dims = 0;
    if (pos.some(f => f.includes("quality") || f.includes("average"))) dims++;
    if (pos.some(f => f.includes("defensive underperf") || f.includes("extreme"))) dims++;
    if (pos.some(f => f.includes("regress") || f.includes("unsustainable") || f.includes("fragile"))) dims++;
    betGrade = dims >= 3 ? "A" : dims >= 2 ? "B" : "C";
  }

  return {
    homeTeam: homeV.team, awayTeam: awayV.team,
    homeVariance: homeV, awayVariance: awayV,
    varianceEdge: r(varianceEdge), edgeSide, edgeMagnitude: magnitude,
    hasBet, betSide: hasBet ? edgeSide : null,
    betReasoning: hasBet ? `${(absEdge * 100).toFixed(1)}% edge on ${edgeSide}` : pass.slice(0, 2).join("; "),
    confidence: hasBet ? r(Math.min(favV.regressionConfidence, 0.95)) : 0,
    betGrade, passReasons: pass, positiveFactors: pos,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  FULL INTEGRATED ASSESSMENT — MI + Variance + Live Odds");
  console.log("  Generated: " + new Date().toISOString());
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ─── Step 1: Solve Championship MI ratings ─────────────────────────────────
  console.log("[PROGRESS] Step 1: Solving Championship MI ratings...");

  const dataDir = join(projectRoot, "data/football-data-cache");
  let allMarketMatches: any[] = [];
  for (const season of ["2023-24", "2024-25"]) {
    const path = join(dataDir, `championship-${season}.json`);
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      const matches = prepareMarketMatches(raw, { useClosing: true, requirePinnacle: true });
      console.log(`  ${season}: ${matches.length} matches`);
      allMarketMatches.push(...matches);
    } catch (e: any) {
      console.log(`  ${season}: SKIP — ${e.message}`);
    }
  }

  const champConfig: MISolverConfig = {
    maxIterations: 200, convergenceThreshold: 1e-6,
    attackRange: [0.3, 3.0], defenseRange: [0.3, 3.0],
    homeAdvantageRange: [0.8, 1.8], lambda3Range: [-0.15, 0.05],
    avgGoalRateRange: [1.0, 1.8], gridSteps: 30,
    decayRate: 0.005, regularization: 0.001,
    klWeight: 1.0, ahWeight: 0.3, printEvery: 50,
    driftFactor: 0.1,
  };

  const champParams = solveRatings(allMarketMatches, "championship", "2024-25", champConfig);
  computeAllPPG(champParams);

  const champSorted = Object.values(champParams.teams).sort((a, b) => b.ppg - a.ppg);
  console.log(`\n  Championship MI: ${champSorted.length} teams, HA=${champParams.homeAdvantage.toFixed(3)}, λ3=${champParams.correlation.toFixed(4)}`);
  console.log(`  Top 5: ${champSorted.slice(0, 5).map(t => `${t.team} ${t.ppg.toFixed(2)}`).join(", ")}`);

  // ─── Step 2: Solve EPL MI ratings (for UCL team comparison) ────────────────
  console.log("\n[PROGRESS] Step 2: Solving EPL MI ratings (for UCL teams)...");

  let eplMatches: any[] = [];
  for (const season of ["2024-25"]) {
    const path = join(dataDir, `epl-${season}.json`);
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      const matches = prepareMarketMatches(raw, { useClosing: true, requirePinnacle: true });
      console.log(`  EPL ${season}: ${matches.length} matches`);
      eplMatches.push(...matches);
    } catch (e: any) {
      console.log(`  EPL ${season}: SKIP — ${e.message}`);
    }
  }

  // Also load La Liga, Bundesliga, Ligue 1, Serie A for UCL teams
  const uclLeagues = [
    { file: "la-liga", label: "La Liga" },
    { file: "bundesliga", label: "Bundesliga" },
    { file: "ligue-1", label: "Ligue 1" },
    { file: "serie-a", label: "Serie A" },
  ];
  const leagueParams: Record<string, any> = {};

  for (const lg of uclLeagues) {
    const path = join(dataDir, `${lg.file}-2024-25.json`);
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      const matches = prepareMarketMatches(raw, { useClosing: true, requirePinnacle: true });
      console.log(`  ${lg.label}: ${matches.length} matches`);
      const params = solveRatings(matches, lg.file, "2024-25", {
        ...champConfig, driftFactor: 0, printEvery: 999,
      });
      computeAllPPG(params);
      leagueParams[lg.file] = params;
    } catch (e: any) {
      console.log(`  ${lg.label}: SKIP — ${e.message}`);
    }
  }

  const eplParams = solveRatings(eplMatches, "epl", "2024-25", {
    ...champConfig, driftFactor: 0, printEvery: 999,
  });
  computeAllPPG(eplParams);
  leagueParams["epl"] = eplParams;
  console.log(`  EPL MI: ${Object.keys(eplParams.teams).length} teams`);

  // ─── Step 3: Load live odds ────────────────────────────────────────────────
  console.log("\n[PROGRESS] Step 3: Loading live odds...");

  const champLiveOdds = loadLiveOdds("championship");
  const uclLiveOdds = loadLiveOdds("ucl");
  console.log(`  Championship: ${champLiveOdds.length} matches`);
  console.log(`  UCL: ${uclLiveOdds.length} matches`);

  // ─── Step 4: Process Championship matches ──────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  CHAMPIONSHIP — INTEGRATED RESULTS");
  console.log("═══════════════════════════════════════════════════════════════");

  const valueConfig: ValueDetectorConfig = {
    minEdge: 0.03, markets: ["1x2", "over_under"], minModelProb: 0.05,
  };

  interface MatchResult {
    match: string;
    miEdge: string;
    varEdge: string;
    signal: string;
    bets: number;
    details: string;
  }
  const champResults: MatchResult[] = [];

  for (let i = 0; i < champLiveOdds.length; i++) {
    const snap = champLiveOdds[i];
    console.log(`\n[PROGRESS] Championship ${i + 1}/${champLiveOdds.length}: ${snap.homeTeam} v ${snap.awayTeam}`);

    const homeFD = ODDS_TO_FD[snap.homeTeam] ?? snap.homeTeam;
    const awayFD = ODDS_TO_FD[snap.awayTeam] ?? snap.awayTeam;
    const homeFotmob = ODDS_TO_FOTMOB[snap.homeTeam] ?? snap.homeTeam;
    const awayFotmob = ODDS_TO_FOTMOB[snap.awayTeam] ?? snap.awayTeam;

    // MI prediction
    let prediction: MatchPrediction | null = null;
    let valueBets: any[] = [];
    try {
      prediction = predictMatch(champParams, homeFD, awayFD);

      // Use LIVE Pinnacle odds for value detection
      if (snap.pinnacleHome && snap.pinnacleDraw && snap.pinnacleAway) {
        const devigged = devigOdds1X2(snap.pinnacleHome, snap.pinnacleDraw, snap.pinnacleAway);
        if (devigged) {
          const marketOdds: MarketOdds = {
            matchId: snap.matchId,
            homeTeam: homeFD,
            awayTeam: awayFD,
            home1X2: devigged.home,
            draw1X2: devigged.draw,
            away1X2: devigged.away,
          };
          valueBets = detectValue(prediction, marketOdds, valueConfig);
        }
      } else {
        console.log(`  (no Pinnacle odds yet — MI prediction only)`);
      }
    } catch (e: any) {
      console.log(`  MI: SKIP — ${e.message}`);
    }

    // Variance assessment
    const homeV = analyzeTeamVariance(homeFotmob, "h");
    const awayV = analyzeTeamVariance(awayFotmob, "a");
    let varAssessment: MatchVarianceAssessment | null = null;
    if (homeV && awayV) {
      varAssessment = assessMatchVariance(homeV, awayV);
    }

    // Combine
    const combined = combineSignals(prediction, valueBets, varAssessment);
    console.log(formatCombinedAssessment(combined));

    champResults.push({
      match: `${snap.homeTeam} v ${snap.awayTeam}`,
      miEdge: combined.miHasBet ? `${combined.miBestSelection} +${(combined.miBestEdge * 100).toFixed(1)}%` : "—",
      varEdge: combined.varianceHasBet ? `${combined.varianceBetSide} G${combined.varianceGrade}` : "—",
      signal: combined.combinedSignal ?? "PASS",
      bets: combined.finalBets.length,
      details: combined.reasoning.substring(0, 80),
    });
  }

  // ─── Step 5: Process UCL matches ───────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  UCL R16 — INTEGRATED RESULTS");
  console.log("═══════════════════════════════════════════════════════════════");

  // UCL team → league mapping for MI model lookup
  const UCL_TEAM_LEAGUE: Record<string, { league: string; fdName: string }> = {
    "Liverpool": { league: "epl", fdName: "Liverpool" },
    "Galatasaray": { league: "", fdName: "" }, // Turkish league not solved
    "Atalanta": { league: "serie-a", fdName: "Atalanta" },
    "Bayern Munich": { league: "bundesliga", fdName: "Bayern Munich" },
    "Atlético Madrid": { league: "la-liga", fdName: "Atletico Madrid" },
    "Atletico Madrid": { league: "la-liga", fdName: "Atletico Madrid" },
    "Tottenham": { league: "epl", fdName: "Tottenham" },
    "Tottenham Hotspur": { league: "epl", fdName: "Tottenham" },
    "Newcastle": { league: "epl", fdName: "Newcastle" },
    "Newcastle United": { league: "epl", fdName: "Newcastle" },
    "Barcelona": { league: "la-liga", fdName: "Barcelona" },
    "Bayer Leverkusen": { league: "bundesliga", fdName: "Bayer Leverkusen" },
    "Arsenal": { league: "epl", fdName: "Arsenal" },
    "Bodø/Glimt": { league: "", fdName: "" }, // Norwegian
    "Sporting Lisbon": { league: "", fdName: "" }, // Portuguese
    "Paris Saint Germain": { league: "ligue-1", fdName: "Paris Saint-Germain" },
    "PSG": { league: "ligue-1", fdName: "Paris Saint-Germain" },
    "Chelsea": { league: "epl", fdName: "Chelsea" },
    "Real Madrid": { league: "la-liga", fdName: "Real Madrid" },
    "Manchester City": { league: "epl", fdName: "Manchester City" },
  };

  const uclResults: MatchResult[] = [];

  for (let i = 0; i < uclLiveOdds.length; i++) {
    const snap = uclLiveOdds[i];
    console.log(`\n[PROGRESS] UCL ${i + 1}/${uclLiveOdds.length}: ${snap.homeTeam} v ${snap.awayTeam}`);

    const homeInfo = UCL_TEAM_LEAGUE[snap.homeTeam];
    const awayInfo = UCL_TEAM_LEAGUE[snap.awayTeam];

    // For UCL, we can't use a single model — teams are from different leagues
    // Instead, compare each team's model-implied strength and build a cross-league prediction
    // For now, we use the live Pinnacle odds AS the market and just report MI team ratings

    let prediction: MatchPrediction | null = null;
    let valueBets: any[] = [];

    // Try to find both teams in their respective league models
    if (homeInfo?.league && awayInfo?.league) {
      const homeParams = leagueParams[homeInfo.league];
      const awayParams = leagueParams[awayInfo.league];

      if (homeParams?.teams?.[homeInfo.fdName] && awayParams?.teams?.[awayInfo.fdName]) {
        const homeRating = homeParams.teams[homeInfo.fdName];
        const awayRating = awayParams.teams[awayInfo.fdName];

        console.log(`  ${snap.homeTeam}: atk=${homeRating.attack.toFixed(3)} def=${homeRating.defense.toFixed(3)} ppg=${homeRating.ppg.toFixed(2)} (${homeInfo.league})`);
        console.log(`  ${snap.awayTeam}: atk=${awayRating.attack.toFixed(3)} def=${awayRating.defense.toFixed(3)} ppg=${awayRating.ppg.toFixed(2)} (${awayInfo.league})`);

        // Cross-league prediction: use average parameters
        const avgHA = (homeParams.homeAdvantage + awayParams.homeAdvantage) / 2;
        const avgGR = (homeParams.avgGoalRate + awayParams.avgGoalRate) / 2;
        const avgL3 = (homeParams.correlation + awayParams.correlation) / 2;

        // Construct a temporary combined model
        const { generateScoreGrid, derive1X2, deriveOverUnder, deriveBTTS, deriveAsianHandicap, expectedGoalsFromGrid, mostLikelyScore } = await import("../lib/mi-model/bivariate-poisson");

        const lambdaHome = homeRating.attack * awayRating.defense * avgHA * avgGR;
        const lambdaAway = awayRating.attack * homeRating.defense * avgGR;
        const grid = generateScoreGrid(lambdaHome, lambdaAway, avgL3);
        const probs = derive1X2(grid);
        const ou = deriveOverUnder(grid, [0.5, 1.5, 2.5, 3.5, 4.5]);
        const btts = deriveBTTS(grid);
        const ah = deriveAsianHandicap(grid, [-2.5, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2.5]);
        const eg = expectedGoalsFromGrid(grid);
        const mls = mostLikelyScore(grid);

        prediction = {
          homeTeam: snap.homeTeam, awayTeam: snap.awayTeam,
          lambdaHome, lambdaAway, lambda3: avgL3, scoreGrid: grid,
          probs1X2: probs, overUnder: ou, btts, asianHandicap: ah,
          expectedGoals: { home: eg.home, away: eg.away, total: eg.home + eg.away },
          mostLikelyScore: mls,
        };

        // Compare vs live Pinnacle odds
        if (snap.pinnacleHome && snap.pinnacleDraw && snap.pinnacleAway) {
          const devigged = devigOdds1X2(snap.pinnacleHome, snap.pinnacleDraw, snap.pinnacleAway);
          if (devigged) {
            valueBets = detectValue(prediction, {
              matchId: snap.matchId,
              homeTeam: snap.homeTeam,
              awayTeam: snap.awayTeam,
              home1X2: devigged.home,
              draw1X2: devigged.draw,
              away1X2: devigged.away,
            }, valueConfig);
          }
        }
      } else {
        console.log(`  Missing MI data: ${homeInfo.fdName} in ${homeInfo.league} or ${awayInfo.fdName} in ${awayInfo.league}`);
      }
    } else {
      console.log(`  Skipping MI — missing league data for ${!homeInfo?.league ? snap.homeTeam : snap.awayTeam}`);
    }

    // No variance model for UCL (would need per-match xG data + cross-league handling)
    // The UCL variance was done separately in ucl-assess.mjs using Understat data
    const combined = combineSignals(prediction, valueBets, null);
    console.log(formatCombinedAssessment(combined));

    uclResults.push({
      match: `${snap.homeTeam} v ${snap.awayTeam}`,
      miEdge: combined.miHasBet ? `${combined.miBestSelection} +${(combined.miBestEdge * 100).toFixed(1)}%` : "—",
      varEdge: "—",
      signal: combined.combinedSignal ?? "PASS",
      bets: combined.finalBets.length,
      details: combined.reasoning.substring(0, 80),
    });
  }

  // ─── Summary tables ────────────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  CHAMPIONSHIP QUICK REFERENCE");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log(`${"Match".padEnd(42)} ${"MI Edge".padEnd(18)} ${"Variance".padEnd(12)} ${"Signal".padEnd(16)} ${"Bets"}`);
  console.log("-".repeat(95));
  for (const r of champResults) {
    console.log(`${r.match.substring(0, 40).padEnd(42)} ${r.miEdge.padEnd(18)} ${r.varEdge.padEnd(12)} ${r.signal.padEnd(16)} ${r.bets}`);
  }

  console.log("\n\n═══════════════════════════════════════════════════════════════");
  console.log("  UCL QUICK REFERENCE");
  console.log("═══════════════════════════════════════════════════════════════\n");

  console.log(`${"Match".padEnd(42)} ${"MI Edge".padEnd(18)} ${"Variance".padEnd(12)} ${"Signal".padEnd(16)} ${"Bets"}`);
  console.log("-".repeat(95));
  for (const r of uclResults) {
    console.log(`${r.match.substring(0, 40).padEnd(42)} ${r.miEdge.padEnd(18)} ${r.varEdge.padEnd(12)} ${r.signal.padEnd(16)} ${r.bets}`);
  }

  const totalBets = champResults.reduce((s, r) => s + r.bets, 0) + uclResults.reduce((s, r) => s + r.bets, 0);
  console.log(`\n  TOTAL RECOMMENDED BETS: ${totalBets} (Championship: ${champResults.reduce((s, r) => s + r.bets, 0)}, UCL: ${uclResults.reduce((s, r) => s + r.bets, 0)})`);
  console.log("\n[DONE]");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
