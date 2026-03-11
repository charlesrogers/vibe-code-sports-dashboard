/**
 * Diagnose Overs Bias — Why does the model overestimate Over 2.5?
 *
 * Three investigations:
 * 1. CALIBRATION: Bin model predictions by probability, check actual hit rate
 * 2. LAMBDA3 (CORRELATION): How does lambda3 affect Over probabilities?
 * 3. GRID TRUNCATION: Does maxGoals=8 inflate Over?
 *
 * Uses the same walk-forward setup as backtest-totals.ts
 */

import { readFileSync } from "fs";
import { join } from "path";
import { prepareMarketMatches, devigOdds2Way } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import { predictMatch } from "../lib/mi-model/predictor";
import { generateScoreGrid, deriveOverUnder } from "../lib/mi-model/bivariate-poisson";
import type { MISolverConfig } from "../lib/mi-model/types";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const dataDir = join(projectRoot, "data/football-data-cache");

const config: MISolverConfig = {
  maxIterations: 200, convergenceThreshold: 1e-6,
  attackRange: [0.3, 3.0], defenseRange: [0.3, 3.0],
  homeAdvantageRange: [0.8, 1.8], lambda3Range: [-0.08, 0.02],
  avgGoalRateRange: [1.0, 1.8], gridSteps: 30,
  decayRate: 0.005, regularization: 0.001,
  klWeight: 0.6, ahWeight: 0.2,
  outcomeWeight: 0.3, xgWeight: 0.2, recentFormBoost: 1.5,
  printEvery: 999, driftFactor: 0,
};

const LEAGUES = [
  { id: "epl", files: ["epl-2023-24.json", "epl-2024-25.json"] },
  { id: "la-liga", files: ["la-liga-2023-24.json", "la-liga-2024-25.json"] },
  { id: "bundesliga", files: ["bundesliga-2023-24.json", "bundesliga-2024-25.json"] },
  { id: "serie-a", files: ["serie-a-2023-24.json", "serie-a-2024-25.json"] },
  { id: "ligue-1", files: ["ligue-1-2023-24.json", "ligue-1-2024-25.json"] },
  { id: "championship", files: ["championship-2023-24.json", "championship-2024-25.json"] },
];

interface PredictionRecord {
  league: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  modelOverProb: number;    // model P(Over 2.5)
  marketOverProb: number;   // Pinnacle devigged P(Over 2.5)
  actualGoals: number;
  wentOver: boolean;
  lambdaHome: number;
  lambdaAway: number;
  lambda3: number;
  expectedTotal: number;
}

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  OVERS BIAS DIAGNOSTIC");
console.log("═══════════════════════════════════════════════════════════════════════\n");

const allPreds: PredictionRecord[] = [];

for (const league of LEAGUES) {
  console.log(`[PROGRESS] ${league.id}...`);

  let rawMatches: any[] = [];
  for (const f of league.files) {
    try {
      const raw = JSON.parse(readFileSync(join(dataDir, f), "utf-8"));
      rawMatches.push(...(raw.matches || []));
    } catch { continue; }
  }
  if (rawMatches.length === 0) continue;

  rawMatches.sort((a: any, b: any) => a.date.localeCompare(b.date));
  const cutoffIdx = Math.floor(rawMatches.length * 0.6);
  const trainMatches = rawMatches.slice(0, cutoffIdx);
  const testMatches = rawMatches.slice(cutoffIdx);

  const trainData = {
    league: league.id, season: "backtest",
    fetchedAt: new Date().toISOString(),
    matchCount: trainMatches.length, matches: trainMatches,
  };

  const prepared = prepareMarketMatches(trainData, { useClosing: true, requirePinnacle: true });
  if (prepared.length < 50) continue;

  const params = solveRatings(prepared, league.id, "backtest", config);
  console.log(`  lambda3=${params.correlation.toFixed(4)}, avgGR=${params.avgGoalRate.toFixed(3)}, HA=${params.homeAdvantage.toFixed(3)}`);

  for (const m of testMatches) {
    const overOdds = m.pinnacleCloseOver25 || m.pinnacleOver25;
    const underOdds = m.pinnacleCloseUnder25 || m.pinnacleUnder25;
    if (!overOdds || !underOdds || m.homeGoals == null || m.awayGoals == null) continue;
    if (!params.teams[m.homeTeam] || !params.teams[m.awayTeam]) continue;

    let pred;
    try { pred = predictMatch(params, m.homeTeam, m.awayTeam); } catch { continue; }

    const modelOU = pred.overUnder["2.5"];
    if (!modelOU) continue;

    const marketOU = devigOdds2Way(overOdds, underOdds);
    if (!marketOU) continue;

    const totalGoals = m.homeGoals + m.awayGoals;
    allPreds.push({
      league: league.id,
      date: m.date,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      modelOverProb: modelOU.over,
      marketOverProb: marketOU.prob1,
      actualGoals: totalGoals,
      wentOver: totalGoals > 2.5,
      lambdaHome: pred.lambdaHome,
      lambdaAway: pred.lambdaAway,
      lambda3: pred.lambda3,
      expectedTotal: pred.expectedGoals.total,
    });
  }

  console.log(`  ${allPreds.filter(p => p.league === league.id).length} predictions collected`);
}

console.log(`\n  Total predictions: ${allPreds.length}`);

// ═══════════════════════════════════════════════════════════════════════════════
// INVESTIGATION 1: CALIBRATION
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════════════");
console.log("  INVESTIGATION 1: CALIBRATION CHECK");
console.log("  Does the model's P(Over 2.5) match actual Over 2.5 frequency?");
console.log("═══════════════════════════════════════════════════════════════════════\n");

const bins = [
  { label: "30-35%", min: 0.30, max: 0.35 },
  { label: "35-40%", min: 0.35, max: 0.40 },
  { label: "40-45%", min: 0.40, max: 0.45 },
  { label: "45-50%", min: 0.45, max: 0.50 },
  { label: "50-55%", min: 0.50, max: 0.55 },
  { label: "55-60%", min: 0.55, max: 0.60 },
  { label: "60-65%", min: 0.60, max: 0.65 },
  { label: "65-70%", min: 0.65, max: 0.70 },
  { label: "70-75%", min: 0.70, max: 0.75 },
  { label: "75-80%", min: 0.75, max: 0.80 },
  { label: "80%+",   min: 0.80, max: 1.01 },
];

console.log("  Model P(Over)   | Count | Actual Over% | Model Avg | Gap (model - actual) | Verdict");
console.log("  ────────────────┼───────┼──────────────┼───────────┼──────────────────────┼────────");

let totalModelOver = 0;
let totalActualOver = 0;

for (const bin of bins) {
  const inBin = allPreds.filter(p => p.modelOverProb >= bin.min && p.modelOverProb < bin.max);
  if (inBin.length < 10) continue;

  const actualOverRate = inBin.filter(p => p.wentOver).length / inBin.length;
  const modelAvg = inBin.reduce((s, p) => s + p.modelOverProb, 0) / inBin.length;
  const gap = modelAvg - actualOverRate;
  const verdict = Math.abs(gap) < 0.03 ? "OK" : gap > 0 ? "OVER-EST" : "UNDER-EST";

  totalModelOver += inBin.reduce((s, p) => s + p.modelOverProb, 0);
  totalActualOver += inBin.filter(p => p.wentOver).length;

  console.log(`  ${bin.label.padEnd(16)} | ${String(inBin.length).padStart(5)} | ${(actualOverRate * 100).toFixed(1).padStart(11)}% | ${(modelAvg * 100).toFixed(1).padStart(8)}% | ${(gap > 0 ? "+" : "")}${(gap * 100).toFixed(1).padStart(19)}% | ${verdict}`);
}

const overallModelAvg = allPreds.reduce((s, p) => s + p.modelOverProb, 0) / allPreds.length;
const overallActualRate = allPreds.filter(p => p.wentOver).length / allPreds.length;
console.log(`\n  Overall: model avg P(Over 2.5) = ${(overallModelAvg * 100).toFixed(1)}%, actual Over 2.5 rate = ${(overallActualRate * 100).toFixed(1)}%`);
console.log(`  Systematic bias: ${((overallModelAvg - overallActualRate) * 100).toFixed(1)}% (model ${overallModelAvg > overallActualRate ? "OVER" : "UNDER"}-estimates Overs)`);

// Also check Pinnacle calibration for comparison
const pinnOverallAvg = allPreds.reduce((s, p) => s + p.marketOverProb, 0) / allPreds.length;
console.log(`  Pinnacle avg P(Over 2.5) = ${(pinnOverallAvg * 100).toFixed(1)}%, gap from actual = ${((pinnOverallAvg - overallActualRate) * 100).toFixed(1)}%`);

// ═══════════════════════════════════════════════════════════════════════════════
// INVESTIGATION 2: LAMBDA3 (CORRELATION) IMPACT
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════════════");
console.log("  INVESTIGATION 2: LAMBDA3 (CORRELATION) IMPACT");
console.log("  How much does lambda3 inflate Over probabilities?");
console.log("═══════════════════════════════════════════════════════════════════════\n");

// Take a representative match: lambdaHome=1.4, lambdaAway=1.2 (expected total ~2.6)
const testLambdaH = 1.4;
const testLambdaA = 1.2;
const testLambda3Values = [-0.15, -0.10, -0.05, 0, 0.05, 0.10, 0.15];

console.log(`  Test case: lambdaHome=${testLambdaH}, lambdaAway=${testLambdaA} (expected total ~${(testLambdaH + testLambdaA).toFixed(1)})`);
console.log(`  lambda3     | P(Over 2.5) | P(Over 3.5) | Expected Total | Diff from λ3=0`);
console.log(`  ────────────┼─────────────┼─────────────┼────────────────┼───────────────`);

const baseGrid = generateScoreGrid(testLambdaH, testLambdaA, 0);
const baseOU = deriveOverUnder(baseGrid, [2.5, 3.5]);
const baseOver25 = baseOU["2.5"].over;

for (const l3 of testLambda3Values) {
  const grid = generateScoreGrid(testLambdaH, testLambdaA, l3);
  const ou = deriveOverUnder(grid, [2.5, 3.5]);

  // Compute expected total from grid
  let expTotal = 0;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      expTotal += (i + j) * grid[i][j];
    }
  }

  const diff = ou["2.5"].over - baseOver25;
  console.log(`  ${(l3 >= 0 ? "+" : "") + l3.toFixed(2).padStart(10)} | ${(ou["2.5"].over * 100).toFixed(1).padStart(10)}% | ${(ou["3.5"].over * 100).toFixed(1).padStart(10)}% | ${expTotal.toFixed(3).padStart(14)} | ${(diff > 0 ? "+" : "")}${(diff * 100).toFixed(2).padStart(13)}%`);
}

// What lambda3 values is the solver actually producing?
console.log(`\n  Solver lambda3 values by league:`);
const lambda3s = new Map<string, number>();
for (const p of allPreds) {
  if (!lambda3s.has(p.league)) lambda3s.set(p.league, p.lambda3);
}
for (const [league, l3] of lambda3s) {
  console.log(`    ${league}: λ3 = ${l3.toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVESTIGATION 3: GRID TRUNCATION
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════════════");
console.log("  INVESTIGATION 3: GRID TRUNCATION (maxGoals=8 vs 12)");
console.log("  Does truncating at 8 goals inflate Over probabilities?");
console.log("═══════════════════════════════════════════════════════════════════════\n");

// Test with different maxGoals
const maxGoalTests = [6, 8, 10, 12, 15];
console.log(`  Test case: lambdaHome=${testLambdaH}, lambdaAway=${testLambdaA}, lambda3=0.05`);
console.log(`  maxGoals | P(Over 2.5) | P(Over 3.5) | Grid Sum  | Diff from max=15`);
console.log(`  ─────────┼─────────────┼─────────────┼───────────┼─────────────────`);

const refGrid = generateScoreGrid(testLambdaH, testLambdaA, 0.05, 15);
const refOU = deriveOverUnder(refGrid, [2.5, 3.5]);
const refOver25 = refOU["2.5"].over;

for (const mg of maxGoalTests) {
  const grid = generateScoreGrid(testLambdaH, testLambdaA, 0.05, mg);
  const ou = deriveOverUnder(grid, [2.5, 3.5]);

  // Sum of all probabilities (should be ~1.0)
  let gridSum = 0;
  for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      gridSum += grid[i][j];
    }
  }

  const diff = ou["2.5"].over - refOver25;
  console.log(`  ${String(mg).padStart(8)} | ${(ou["2.5"].over * 100).toFixed(2).padStart(10)}% | ${(ou["3.5"].over * 100).toFixed(2).padStart(10)}% | ${gridSum.toFixed(6).padStart(9)} | ${(diff > 0 ? "+" : "")}${(diff * 100).toFixed(3).padStart(15)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVESTIGATION 4: WHERE THE EDGE DETECTION FAILS
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════════════");
console.log("  INVESTIGATION 4: EDGE DETECTION ANALYSIS");
console.log("  When model says 'Over has edge', is it right?");
console.log("═══════════════════════════════════════════════════════════════════════\n");

const edgeBins = [
  { label: "3-5%", min: 0.03, max: 0.05 },
  { label: "5-7%", min: 0.05, max: 0.07 },
  { label: "7-10%", min: 0.07, max: 0.10 },
  { label: "10-15%", min: 0.10, max: 0.15 },
  { label: "15%+", min: 0.15, max: 1.0 },
];

console.log("  === OVER 2.5 bets by edge size ===");
console.log("  Edge range | Count | Hit rate | Avg odds | ROI     | Avg model P | Avg mkt P | Model gap");
console.log("  ───────────┼───────┼──────────┼──────────┼─────────┼─────────────┼───────────┼──────────");

for (const bin of edgeBins) {
  const bets = allPreds.filter(p => {
    const edge = p.modelOverProb - p.marketOverProb;
    return edge >= bin.min && edge < bin.max;
  });
  if (bets.length < 5) continue;

  const hits = bets.filter(b => b.wentOver).length;
  const hitRate = hits / bets.length;
  const avgOdds = bets.reduce((s, b) => s + 1 / b.marketOverProb, 0) / bets.length;
  const profit = bets.reduce((s, b) => s + (b.wentOver ? 1 / b.marketOverProb - 1 : -1), 0);
  const roi = profit / bets.length * 100;
  const avgModelP = bets.reduce((s, b) => s + b.modelOverProb, 0) / bets.length;
  const avgMktP = bets.reduce((s, b) => s + b.marketOverProb, 0) / bets.length;
  const modelGap = avgModelP - hitRate;

  console.log(`  ${bin.label.padEnd(10)} | ${String(bets.length).padStart(5)} | ${(hitRate * 100).toFixed(1).padStart(7)}% | ${avgOdds.toFixed(2).padStart(8)} | ${(roi >= 0 ? "+" : "")}${roi.toFixed(1).padStart(6)}% | ${(avgModelP * 100).toFixed(1).padStart(10)}% | ${(avgMktP * 100).toFixed(1).padStart(8)}% | ${(modelGap > 0 ? "+" : "")}${(modelGap * 100).toFixed(1)}%`);
}

console.log("\n  === UNDER 2.5 bets by edge size ===");
console.log("  Edge range | Count | Hit rate | Avg odds | ROI     | Avg model P | Avg mkt P | Model gap");
console.log("  ───────────┼───────┼──────────┼──────────┼─────────┼─────────────┼───────────┼──────────");

for (const bin of edgeBins) {
  const bets = allPreds.filter(p => {
    const edge = (1 - p.modelOverProb) - (1 - p.marketOverProb);  // Under edge
    return edge >= bin.min && edge < bin.max;
  });
  if (bets.length < 5) continue;

  const hits = bets.filter(b => !b.wentOver).length;
  const hitRate = hits / bets.length;
  const avgOdds = bets.reduce((s, b) => s + 1 / (1 - b.marketOverProb), 0) / bets.length;
  const profit = bets.reduce((s, b) => s + (!b.wentOver ? 1 / (1 - b.marketOverProb) - 1 : -1), 0);
  const roi = profit / bets.length * 100;
  const avgModelP = bets.reduce((s, b) => s + (1 - b.modelOverProb), 0) / bets.length;
  const avgMktP = bets.reduce((s, b) => s + (1 - b.marketOverProb), 0) / bets.length;
  const modelGap = avgModelP - hitRate;

  console.log(`  ${bin.label.padEnd(10)} | ${String(bets.length).padStart(5)} | ${(hitRate * 100).toFixed(1).padStart(7)}% | ${avgOdds.toFixed(2).padStart(8)} | ${(roi >= 0 ? "+" : "")}${roi.toFixed(1).padStart(6)}% | ${(avgModelP * 100).toFixed(1).padStart(10)}% | ${(avgMktP * 100).toFixed(1).padStart(8)}% | ${(modelGap > 0 ? "+" : "")}${(modelGap * 100).toFixed(1)}%`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INVESTIGATION 5: EXPECTED GOALS BIAS
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════════════");
console.log("  INVESTIGATION 5: EXPECTED GOALS vs ACTUAL");
console.log("  Is the model predicting too many goals overall?");
console.log("═══════════════════════════════════════════════════════════════════════\n");

const avgExpectedTotal = allPreds.reduce((s, p) => s + p.expectedTotal, 0) / allPreds.length;
const avgActualTotal = allPreds.reduce((s, p) => s + p.actualGoals, 0) / allPreds.length;

console.log(`  Model avg expected total: ${avgExpectedTotal.toFixed(3)} goals/match`);
console.log(`  Actual avg total:         ${avgActualTotal.toFixed(3)} goals/match`);
console.log(`  Bias:                     ${((avgExpectedTotal - avgActualTotal)).toFixed(3)} goals/match (${avgExpectedTotal > avgActualTotal ? "MODEL OVER-PREDICTS" : "model under-predicts"})`);

// By league
console.log("\n  By league:");
for (const league of LEAGUES) {
  const lp = allPreds.filter(p => p.league === league.id);
  if (lp.length === 0) continue;
  const expAvg = lp.reduce((s, p) => s + p.expectedTotal, 0) / lp.length;
  const actAvg = lp.reduce((s, p) => s + p.actualGoals, 0) / lp.length;
  const bias = expAvg - actAvg;
  console.log(`    ${league.id.padEnd(14)} expected=${expAvg.toFixed(2)}  actual=${actAvg.toFixed(2)}  bias=${(bias > 0 ? "+" : "")}${bias.toFixed(2)} ${Math.abs(bias) > 0.15 ? "⚠" : "✓"}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY & RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════════════════════════════");
console.log("  SUMMARY & RECOMMENDATIONS");
console.log("═══════════════════════════════════════════════════════════════════════\n");

const overBias = overallModelAvg - overallActualRate;
const goalBias = avgExpectedTotal - avgActualTotal;

if (overBias > 0.02) {
  console.log(`  ROOT CAUSE 1: Model systematically over-estimates P(Over 2.5) by ${(overBias * 100).toFixed(1)}%`);
}
if (goalBias > 0.1) {
  console.log(`  ROOT CAUSE 2: Model predicts ${goalBias.toFixed(2)} more goals/match than actually occur`);
  console.log(`    → FIX: Deflate expected goals by ${((1 - avgActualTotal / avgExpectedTotal) * 100).toFixed(1)}% or tighten avgGoalRate range`);
}

// Check if lambda3 is the problem
const uniqueL3 = [...lambda3s.values()];
const avgL3 = uniqueL3.reduce((s, v) => s + v, 0) / uniqueL3.length;
if (Math.abs(avgL3) > 0.03) {
  console.log(`  ROOT CAUSE 3: Average lambda3 = ${avgL3.toFixed(4)} — ${avgL3 > 0 ? "positive correlation inflates Over" : "negative correlation shifts distribution"}`);
}

console.log();
