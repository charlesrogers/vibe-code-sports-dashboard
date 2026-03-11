/**
 * Backtest Totals — Validate O/U 2.5 edge detection against historical results
 *
 * For each league-season:
 * 1. Train model on matches up to a cutoff (first 60% of season)
 * 2. Walk forward through remaining matches
 * 3. For each match: predict O/U, compare to Pinnacle closing odds, find edge
 * 4. If edge >= threshold, simulate a bet at Pinnacle closing odds
 * 5. Track hit rate, ROI, and average edge
 *
 * Uses closing Pinnacle O/U 2.5 odds (pinnacleCloseOver25 / pinnacleCloseUnder25)
 */

import { readFileSync } from "fs";
import { join } from "path";
import { prepareMarketMatches, devigOdds2Way } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import { predictMatch } from "../lib/mi-model/predictor";
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

interface BetResult {
  league: string;
  season: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  selection: string;      // "Over 2.5" or "Under 2.5"
  modelProb: number;
  marketProb: number;
  edge: number;
  odds: number;           // Pinnacle closing odds
  totalGoals: number;
  won: boolean;
  profit: number;         // 1-unit flat bet: won ? odds - 1 : -1
}

const LEAGUES = [
  { id: "epl", files: ["epl-2023-24.json", "epl-2024-25.json"] },
  { id: "la-liga", files: ["la-liga-2023-24.json", "la-liga-2024-25.json"] },
  { id: "bundesliga", files: ["bundesliga-2023-24.json", "bundesliga-2024-25.json"] },
  { id: "serie-a", files: ["serie-a-2023-24.json", "serie-a-2024-25.json"] },
  { id: "ligue-1", files: ["ligue-1-2023-24.json", "ligue-1-2024-25.json"] },
  { id: "championship", files: ["championship-2023-24.json", "championship-2024-25.json"] },
];

const MIN_EDGES = [0.03, 0.05, 0.07, 0.10];

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  TOTALS BACKTEST — O/U 2.5 Edge Detection");
console.log("  Walk-forward: train on 60% of season, test on remaining 40%");
console.log("═══════════════════════════════════════════════════════════════════════\n");

const allBets: BetResult[] = [];

for (const league of LEAGUES) {
  console.log(`[PROGRESS] Processing ${league.id}...`);

  // Load all matches from both seasons
  let rawMatches: any[] = [];
  for (const f of league.files) {
    try {
      const raw = JSON.parse(readFileSync(join(dataDir, f), "utf-8"));
      rawMatches.push(...(raw.matches || []));
    } catch { continue; }
  }

  if (rawMatches.length === 0) {
    console.log(`  No data for ${league.id}`);
    continue;
  }

  // Sort by date
  rawMatches.sort((a: any, b: any) => a.date.localeCompare(b.date));

  // Walk-forward: train on first 60%, test on last 40%
  const cutoffIdx = Math.floor(rawMatches.length * 0.6);
  const trainMatches = rawMatches.slice(0, cutoffIdx);
  const testMatches = rawMatches.slice(cutoffIdx);

  console.log(`  ${rawMatches.length} total matches. Train: ${trainMatches.length}, Test: ${testMatches.length}`);

  // Prepare training data and solve
  const trainData = {
    league: league.id,
    season: "backtest",
    fetchedAt: new Date().toISOString(),
    matchCount: trainMatches.length,
    matches: trainMatches,
  };

  const prepared = prepareMarketMatches(trainData, { useClosing: true, requirePinnacle: true });
  if (prepared.length < 50) {
    console.log(`  Too few training matches (${prepared.length})`);
    continue;
  }

  const params = solveRatings(prepared, league.id, "backtest", config);

  // Test on remaining matches
  let leagueBets = 0;
  for (const m of testMatches) {
    // Need Pinnacle closing O/U 2.5 odds and actual goals
    const overOdds = m.pinnacleCloseOver25 || m.pinnacleOver25;
    const underOdds = m.pinnacleCloseUnder25 || m.pinnacleUnder25;
    if (!overOdds || !underOdds) continue;
    if (m.homeGoals == null || m.awayGoals == null) continue;

    // Check team exists in model
    if (!params.teams[m.homeTeam] || !params.teams[m.awayTeam]) continue;

    let pred;
    try {
      pred = predictMatch(params, m.homeTeam, m.awayTeam);
    } catch { continue; }

    const modelOU = pred.overUnder["2.5"];
    if (!modelOU) continue;

    const marketOU = devigOdds2Way(overOdds, underOdds);
    if (!marketOU) continue;

    const totalGoals = m.homeGoals + m.awayGoals;

    // Check Over 2.5 edge
    const overEdge = modelOU.over - marketOU.prob1;
    if (overEdge >= 0.03) {
      const won = totalGoals > 2.5;
      allBets.push({
        league: league.id,
        season: m.season || "unknown",
        date: m.date,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        selection: "Over 2.5",
        modelProb: modelOU.over,
        marketProb: marketOU.prob1,
        edge: overEdge,
        odds: overOdds,
        totalGoals,
        won,
        profit: won ? overOdds - 1 : -1,
      });
      leagueBets++;
    }

    // Check Under 2.5 edge
    const underEdge = modelOU.under - marketOU.prob2;
    if (underEdge >= 0.03) {
      const won = totalGoals < 2.5;
      allBets.push({
        league: league.id,
        season: m.season || "unknown",
        date: m.date,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        selection: "Under 2.5",
        modelProb: modelOU.under,
        marketProb: marketOU.prob2,
        edge: underEdge,
        odds: underOdds,
        totalGoals,
        won,
        profit: won ? underOdds - 1 : -1,
      });
      leagueBets++;
    }
  }

  console.log(`  ${leagueBets} totals bets found in test set`);
}

// ─── Results ──────────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════════════");
console.log("  RESULTS");
console.log("═══════════════════════════════════════════════════════════════════════\n");

if (allBets.length === 0) {
  console.log("  No bets found.");
  process.exit(0);
}

// Overall summary
function summarize(bets: BetResult[], label: string) {
  if (bets.length === 0) return;
  const wins = bets.filter(b => b.won).length;
  const totalProfit = bets.reduce((s, b) => s + b.profit, 0);
  const avgEdge = bets.reduce((s, b) => s + b.edge, 0) / bets.length;
  const avgOdds = bets.reduce((s, b) => s + b.odds, 0) / bets.length;
  const roi = totalProfit / bets.length * 100;

  console.log(`  ${label}`);
  console.log(`    Bets: ${bets.length}  |  Won: ${wins}  |  Hit rate: ${(wins / bets.length * 100).toFixed(1)}%`);
  console.log(`    ROI: ${roi >= 0 ? "+" : ""}${roi.toFixed(1)}%  |  Profit: ${totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)}u  |  Avg odds: ${avgOdds.toFixed(2)}  |  Avg edge: ${(avgEdge * 100).toFixed(1)}%`);
  console.log();
}

// By minimum edge threshold
for (const minEdge of MIN_EDGES) {
  const filtered = allBets.filter(b => b.edge >= minEdge);
  summarize(filtered, `Min edge ${(minEdge * 100).toFixed(0)}%`);
}

// By direction (Over vs Under)
console.log("  ─── BY DIRECTION ─────────────────────────────────────────────────\n");
summarize(allBets.filter(b => b.selection === "Over 2.5" && b.edge >= 0.05), "Over 2.5 (edge >= 5%)");
summarize(allBets.filter(b => b.selection === "Under 2.5" && b.edge >= 0.05), "Under 2.5 (edge >= 5%)");

// By league
console.log("  ─── BY LEAGUE (edge >= 5%) ────────────────────────────────────────\n");
for (const league of LEAGUES) {
  const bets = allBets.filter(b => b.league === league.id && b.edge >= 0.05);
  if (bets.length > 0) summarize(bets, league.id.toUpperCase());
}

// Compare to sides backtest (if we had one)
console.log("  ─── VERDICT ──────────────────────────────────────────────────────\n");
const at5pct = allBets.filter(b => b.edge >= 0.05);
if (at5pct.length > 0) {
  const roi5 = at5pct.reduce((s, b) => s + b.profit, 0) / at5pct.length * 100;
  const hitRate5 = at5pct.filter(b => b.won).length / at5pct.length * 100;
  if (roi5 > 0 && hitRate5 > 45) {
    console.log(`  PASS: Totals at 5% edge threshold show +${roi5.toFixed(1)}% ROI with ${hitRate5.toFixed(1)}% hit rate.`);
    console.log(`  Safe to run MarketMode = "both" in production.`);
  } else if (roi5 > -3) {
    console.log(`  MARGINAL: Totals at 5% edge threshold show ${roi5.toFixed(1)}% ROI with ${hitRate5.toFixed(1)}% hit rate.`);
    console.log(`  Consider raising threshold to 7% or 10%.`);
  } else {
    console.log(`  FAIL: Totals at 5% edge threshold show ${roi5.toFixed(1)}% ROI. Keep MarketMode = "sides_only".`);
  }
}
console.log();
