/**
 * Test script for MI Bivariate Poisson Model (Phase 1)
 *
 * 1. Loads EPL 2024-25 data
 * 2. Prepares MarketMatch[]
 * 3. Runs the solver
 * 4. Computes PPG
 * 5. Predicts a sample match
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  factorial,
  comb,
  poissonPmf,
  bivariatePoisson,
  generateScoreGrid,
  derive1X2,
  deriveOverUnder,
  deriveBTTS,
} from "../lib/mi-model/bivariate-poisson";

import { prepareMarketMatches } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import { computeAllPPG } from "../lib/mi-model/ppg-converter";
import { predictMatch, formatPrediction } from "../lib/mi-model/predictor";
import { MISolverConfig } from "../lib/mi-model/types";

const projectRoot = join(import.meta.dirname || __dirname, "..");

console.log("====================================================");
console.log("  MI Bivariate Poisson Model — Phase 1 Test");
console.log("====================================================\n");

// ---------- Step 1: Test core math ----------
console.log("--- Step 1: Testing core bivariate Poisson math ---");

// Test factorial
console.log(`factorial(0)=${factorial(0)}, factorial(5)=${factorial(5)}, factorial(10)=${factorial(10)}`);

// Test Poisson PMF
console.log(`P(X=1|lambda=1.5) = ${poissonPmf(1, 1.5).toFixed(6)} (expected ~0.3347)`);
console.log(`P(X=0|lambda=1.5) = ${poissonPmf(0, 1.5).toFixed(6)} (expected ~0.2231)`);

// Test bivariate Poisson with lambda3=0 (should equal product of marginals)
const bpIndep = bivariatePoisson(1, 1, 1.5, 1.2, 0);
const indepCheck = poissonPmf(1, 1.5) * poissonPmf(1, 1.2);
console.log(`BP(1,1|1.5,1.2,0) = ${bpIndep.toFixed(8)}, Independent = ${indepCheck.toFixed(8)}, Match: ${Math.abs(bpIndep - indepCheck) < 1e-10}`);

// Test with lambda3 > 0 (correlated)
const bpCorr = bivariatePoisson(1, 1, 1.5, 1.2, 0.1);
console.log(`BP(1,1|1.5,1.2,0.1) = ${bpCorr.toFixed(8)} (should differ from independent)`);

// Test score grid
const testGrid = generateScoreGrid(1.5, 1.2, 0.05);
const testProbs = derive1X2(testGrid);
console.log(`Test grid 1X2 (lH=1.5, lA=1.2, l3=0.05):`);
console.log(`  Home: ${(testProbs.home * 100).toFixed(1)}%, Draw: ${(testProbs.draw * 100).toFixed(1)}%, Away: ${(testProbs.away * 100).toFixed(1)}%`);
console.log(`  Sum: ${(testProbs.home + testProbs.draw + testProbs.away).toFixed(6)}`);

const testOU = deriveOverUnder(testGrid);
console.log(`  O/U 2.5: Over ${(testOU["2.5"].over * 100).toFixed(1)}%, Under ${(testOU["2.5"].under * 100).toFixed(1)}%`);

const testBTTS = deriveBTTS(testGrid);
console.log(`  BTTS: Yes ${(testBTTS.yes * 100).toFixed(1)}%, No ${(testBTTS.no * 100).toFixed(1)}%`);

console.log("\n[PASS] Core math tests complete.\n");

// ---------- Step 2: Load and prepare data ----------
console.log("--- Step 2: Loading EPL 2024-25 data ---");

const dataPath = join(projectRoot, "data/football-data-cache/epl-2024-25.json");
const rawData = JSON.parse(readFileSync(dataPath, "utf-8"));
console.log(`Loaded ${rawData.matchCount} matches from ${rawData.league} ${rawData.season}`);

const marketMatches = prepareMarketMatches(rawData);

console.log(`\nSample match:`);
const sample = marketMatches[0];
console.log(`  ${sample.homeTeam} vs ${sample.awayTeam} (${sample.date})`);
console.log(`  Market: H=${(sample.marketProbs.home * 100).toFixed(1)}%, D=${(sample.marketProbs.draw * 100).toFixed(1)}%, A=${(sample.marketProbs.away * 100).toFixed(1)}%`);
console.log(`  AH line: ${sample.ahLine}, AH home prob: ${sample.ahHomeProb?.toFixed(3) ?? 'N/A'}`);
console.log(`  Weight: ${sample.weight.toFixed(4)}`);
console.log(`  Result: ${sample.result ? `${sample.result.homeGoals}-${sample.result.awayGoals}` : 'N/A'}`);

// ---------- Step 3: Run the solver ----------
console.log("\n--- Step 3: Running solver ---");

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
  driftFactor: 0.0,
};

const params = solveRatings(marketMatches, "epl", "2024-25", solverConfig);

console.log(`\nConvergence: ${params.convergenceInfo.converged ? 'YES' : 'NO'} after ${params.convergenceInfo.iterations} iterations`);
console.log(`Final loss: ${params.convergenceInfo.finalLoss.toFixed(6)}`);
console.log(`Home advantage: ${params.homeAdvantage.toFixed(3)}`);
console.log(`Correlation (l3): ${params.correlation.toFixed(4)}`);
console.log(`Avg goal rate: ${params.avgGoalRate.toFixed(3)}`);
console.log(`Drift factor: ${params.driftFactor}`);

// ---------- Step 4: Compute PPG ----------
console.log("\n--- Step 4: Computing PPG ---");

computeAllPPG(params);

const sorted = Object.values(params.teams).sort((a, b) => b.ppg - a.ppg);
console.log("\nTeam Ratings (sorted by PPG):");
console.log("-".repeat(75));
console.log(`${"Team".padEnd(25)} ${"Attack".padStart(8)} ${"Defense".padStart(8)} ${"PPG".padStart(6)} ${"Matches".padStart(8)}`);
console.log("-".repeat(75));
for (const t of sorted) {
  console.log(
    `${t.team.padEnd(25)} ${t.attack.toFixed(3).padStart(8)} ${t.defense.toFixed(3).padStart(8)} ${t.ppg.toFixed(2).padStart(6)} ${String(t.matchesUsed).padStart(8)}`
  );
}

// ---------- Step 5: Predict a sample match ----------
console.log("\n--- Step 5: Sample Predictions ---");

const teamNames = Object.keys(params.teams);
let homeTeam = "Arsenal";
let awayTeam = "Chelsea";
if (!params.teams[homeTeam]) homeTeam = teamNames[0];
if (!params.teams[awayTeam]) awayTeam = teamNames[1];

const prediction = predictMatch(params, homeTeam, awayTeam);
console.log(formatPrediction(prediction));

if (params.teams["Liverpool"] && params.teams["Manchester City"]) {
  const pred2 = predictMatch(params, "Liverpool", "Manchester City");
  console.log(formatPrediction(pred2));
}

console.log("\n====================================================");
console.log("  Phase 1 Test Complete!");
console.log("====================================================");
