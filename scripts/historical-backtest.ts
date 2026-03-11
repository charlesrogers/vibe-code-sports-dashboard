/**
 * Historical Backtest — Walk-forward MI Poisson value betting
 *
 * For each matchday in the dataset:
 *  1. Solve MI ratings using only matches played BEFORE that date
 *  2. Compare model probabilities to stored Pinnacle odds
 *  3. Generate value bets (1X2 + O/U 2.5)
 *  4. Score against actual results
 *  5. Output "OUR BETS" style per gameweek
 *
 * Usage: npx tsx scripts/historical-backtest.ts [--season 2024-25] [--league championship]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

import { prepareMarketMatches, devigOdds1X2, devigOdds2Way } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import { computeAllPPG } from "../lib/mi-model/ppg-converter";
import { predictMatch } from "../lib/mi-model/predictor";
import { deriveOverUnder, deriveAsianHandicap } from "../lib/mi-model/bivariate-poisson";
import type { MISolverConfig, MatchPrediction } from "../lib/mi-model/types";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const dataDir = join(projectRoot, "data/football-data-cache");
const outDir = join(projectRoot, "data/backtest");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// ─── Config ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name: string, def: string) => {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : def;
};

const TARGET_SEASONS = getArg("season", "2024-25,2025-26").split(",");
const TARGET_LEAGUES = getArg("league", "championship,epl").split(",");
const MIN_TRAINING_MATCHES = parseInt(getArg("min-training", "50"));
const MIN_EDGE = parseFloat(getArg("min-edge", "0.03"));

const baseConfig: MISolverConfig = {
  maxIterations: 200, convergenceThreshold: 1e-6,
  attackRange: [0.3, 3.0], defenseRange: [0.3, 3.0],
  homeAdvantageRange: [0.8, 1.8], lambda3Range: [-0.15, 0.05],
  avgGoalRateRange: [1.0, 1.8], gridSteps: 30,
  decayRate: 0.005, regularization: 0.001,
  klWeight: 1.0, ahWeight: 0.3, printEvery: 999,
  driftFactor: 0,
  outcomeWeight: 0.3, xgWeight: 0.2, recentFormBoost: 1.5,
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface BacktestBet {
  date: string;
  match: string;
  league: string;
  selection: string;
  edge: number;
  pinnacleOdds: number;
  fairOdds: number;
  result: "W" | "L" | "P" | "?" ;  // win/loss/push/unknown
  profit: number;  // flat stake: odds-1 if win, -1 if loss, 0 if push
}

interface GameweekSummary {
  date: string;
  league: string;
  matchesAvailable: number;
  betsPlaced: number;
  wins: number;
  losses: number;
  pushes: number;
  profit: number;
  bets: BacktestBet[];
}

// ─── Load match data ─────────────────────────────────────────────────────────

interface RawMatch {
  id: string; date: string; homeTeam: string; awayTeam: string;
  homeGoals: number; awayGoals: number; result: string; season: string;
  pinnacleHome: number; pinnacleDraw: number; pinnacleAway: number;
  pinnacleOver25: number; pinnacleUnder25: number;
  b365Home: number; b365Draw: number; b365Away: number;
  avgOver25: number; avgUnder25: number;
  [key: string]: any;
}

function loadMatches(league: string, seasons: string[]): RawMatch[] {
  const all: RawMatch[] = [];
  for (const s of seasons) {
    const f = join(dataDir, `${league}-${s}.json`);
    if (!existsSync(f)) {
      console.log(`  [WARN] Missing ${league}-${s}.json — skipping`);
      continue;
    }
    const data = JSON.parse(readFileSync(f, "utf-8"));
    const matches = data.matches || data;
    console.log(`  [PROGRESS] Loaded ${matches.length} matches from ${league}-${s}`);
    all.push(...matches);
  }
  // Also load prior season for training warmup
  for (const s of seasons) {
    const parts = s.split("-");
    const prevEnd = parseInt(parts[0]);
    const prevSeason = `${prevEnd - 1}-${String(prevEnd).slice(2)}`;
    const f = join(dataDir, `${league}-${prevSeason}.json`);
    if (existsSync(f)) {
      const data = JSON.parse(readFileSync(f, "utf-8"));
      const matches = data.matches || data;
      console.log(`  [PROGRESS] Loaded ${matches.length} prior-season matches from ${league}-${prevSeason}`);
      all.push(...matches);
    }
  }
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

// ─── Determine bet result ────────────────────────────────────────────────────

function scoreBet(selection: string, homeGoals: number, awayGoals: number, homeTeam: string, awayTeam: string): "W" | "L" | "P" {
  const sel = selection.toLowerCase();
  const margin = homeGoals - awayGoals;

  if (sel.includes("ml")) {
    if (sel.includes(homeTeam.toLowerCase())) return margin > 0 ? "W" : "L";
    if (sel.includes(awayTeam.toLowerCase())) return margin < 0 ? "W" : "L";
  }

  if (sel === "draw") return margin === 0 ? "W" : "L";

  if (sel.startsWith("over ")) {
    const line = parseFloat(sel.replace("over ", ""));
    const total = homeGoals + awayGoals;
    if (total > line) return "W";
    if (total < line) return "L";
    return "P";
  }
  if (sel.startsWith("under ")) {
    const line = parseFloat(sel.replace("under ", ""));
    const total = homeGoals + awayGoals;
    if (total < line) return "W";
    if (total > line) return "L";
    return "P";
  }

  // AH: "Team +0.5" or "Team -0.75"
  const ahMatch = selection.match(/(.+?)\s+([+-]?\d+\.?\d*)$/);
  if (ahMatch) {
    const team = ahMatch[1].trim();
    const line = parseFloat(ahMatch[2]);
    const isHome = team.toLowerCase() === homeTeam.toLowerCase();
    const adjustedMargin = isHome ? margin + line : -margin + line;

    if (adjustedMargin > 0) return "W";
    if (adjustedMargin < 0) return "L";
    return "P";
  }

  return "L"; // default
}

function computeProfit(result: "W" | "L" | "P", odds: number): number {
  if (result === "W") return odds - 1;
  if (result === "L") return -1;
  return 0; // push
}

// ─── Main backtest ───────────────────────────────────────────────────────────

function runBacktest(league: string, allSeasons: string[]) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  BACKTEST: ${league.toUpperCase()} — Seasons: ${allSeasons.join(", ")}`);
  console.log(`${"═".repeat(70)}\n`);

  const allMatches = loadMatches(league, allSeasons);
  if (allMatches.length === 0) {
    console.log("  No match data found. Skipping.\n");
    return [];
  }

  // Get unique dates where we have matches to predict (only target seasons)
  const targetMatches = allMatches.filter(m => allSeasons.some(s => m.season === s));
  const matchDates = [...new Set(targetMatches.map(m => m.date))].sort();
  console.log(`  [PROGRESS] ${targetMatches.length} target matches across ${matchDates.length} matchdays\n`);

  const allBets: BacktestBet[] = [];
  const summaries: GameweekSummary[] = [];
  let totalSolves = 0;
  let lastSolvedParams: any = null;
  let lastSolvedDate = "";
  const RESOLVE_INTERVAL = 7; // Re-solve ratings every 7 days max

  for (let di = 0; di < matchDates.length; di++) {
    const date = matchDates[di];
    const dayMatches = targetMatches.filter(m => m.date === date);

    // Filter to only matches with valid Pinnacle odds
    const bettableMatches = dayMatches.filter(m =>
      m.pinnacleHome > 1 && m.pinnacleDraw > 1 && m.pinnacleAway > 1
    );

    if (bettableMatches.length === 0) continue;

    // Training data: all matches before this date
    const trainingMatches = allMatches.filter(m => m.date < date);
    if (trainingMatches.length < MIN_TRAINING_MATCHES) continue;

    // Only re-solve if enough time has passed or first solve
    const daysSinceLastSolve = lastSolvedDate
      ? Math.floor((new Date(date).getTime() - new Date(lastSolvedDate).getTime()) / 86400000)
      : 999;

    let params = lastSolvedParams;
    if (!params || daysSinceLastSolve >= RESOLVE_INTERVAL) {
      // Prepare market matches for solver
      const rawData = {
        matches: trainingMatches,
        league, season: allSeasons[0],
        fetchedAt: date, matchCount: trainingMatches.length,
      };
      const marketMatches = prepareMarketMatches(rawData, { useClosing: true, requirePinnacle: true });

      if (marketMatches.length < MIN_TRAINING_MATCHES) continue;

      try {
        params = solveRatings(marketMatches, league, allSeasons[0], { ...baseConfig, driftFactor: league === "championship" ? 0.1 : 0 });
        computeAllPPG(params);
        lastSolvedParams = params;
        lastSolvedDate = date;
        totalSolves++;
      } catch (e: any) {
        continue;
      }
    }

    // Generate predictions for each bettable match
    const dayBets: BacktestBet[] = [];

    for (const m of bettableMatches) {
      let pred: MatchPrediction | null = null;
      try {
        pred = predictMatch(params, m.homeTeam, m.awayTeam);
      } catch { continue; }
      if (!pred) continue;

      // Devig Pinnacle 1X2
      const market = devigOdds1X2(m.pinnacleHome, m.pinnacleDraw, m.pinnacleAway);
      if (!market) continue;

      // Check 1X2 edges
      const checks = [
        { sel: `${m.homeTeam} ML`, prob: pred.probs1X2.home, mktProb: market.home, odds: m.pinnacleHome },
        { sel: `${m.awayTeam} ML`, prob: pred.probs1X2.away, mktProb: market.away, odds: m.pinnacleAway },
        { sel: "Draw", prob: pred.probs1X2.draw, mktProb: market.draw, odds: m.pinnacleDraw },
      ];

      // Check O/U 2.5
      const ou = pred.overUnder["2.5"];
      if (ou && m.pinnacleOver25 > 1 && m.pinnacleUnder25 > 1) {
        const ouMarket = devigOdds2Way(m.pinnacleOver25, m.pinnacleUnder25);
        if (ouMarket) {
          checks.push(
            { sel: "Over 2.5", prob: ou.over, mktProb: ouMarket.prob1, odds: m.pinnacleOver25 },
            { sel: "Under 2.5", prob: ou.under, mktProb: ouMarket.prob2, odds: m.pinnacleUnder25 },
          );
        }
      }

      // AH lines: check common lines against model
      const ahLines = [-2.5, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5, 2.5];
      for (const line of ahLines) {
        const ahKey = String(line);
        const ah = pred.asianHandicap[ahKey];
        if (!ah) continue;

        // We don't have historical AH odds from football-data, so we use 1X2-derived fair odds
        // This is less precise but still useful for backtesting
      }

      // Find best edge per match
      let bestBet: { sel: string; edge: number; odds: number; fairOdds: number } | null = null;
      for (const c of checks) {
        const edge = c.prob - c.mktProb;
        if (edge >= MIN_EDGE) {
          if (!bestBet || edge > bestBet.edge) {
            bestBet = { sel: c.sel, edge, odds: c.odds, fairOdds: 1 / c.prob };
          }
        }
      }

      if (bestBet) {
        const result = scoreBet(bestBet.sel, m.homeGoals, m.awayGoals, m.homeTeam, m.awayTeam);
        const profit = computeProfit(result, bestBet.odds);

        dayBets.push({
          date: m.date,
          match: `${m.homeTeam} v ${m.awayTeam}`,
          league,
          selection: bestBet.sel,
          edge: bestBet.edge,
          pinnacleOdds: bestBet.odds,
          fairOdds: bestBet.fairOdds,
          result,
          profit,
        });
      }
    }

    if (dayBets.length > 0) {
      allBets.push(...dayBets);

      const wins = dayBets.filter(b => b.result === "W").length;
      const losses = dayBets.filter(b => b.result === "L").length;
      const pushes = dayBets.filter(b => b.result === "P").length;
      const profit = dayBets.reduce((s, b) => s + b.profit, 0);

      summaries.push({
        date,
        league,
        matchesAvailable: bettableMatches.length,
        betsPlaced: dayBets.length,
        wins, losses, pushes, profit,
        bets: dayBets,
      });
    }

    // Progress every 10 matchdays
    if ((di + 1) % 10 === 0 || di === matchDates.length - 1) {
      const totalProfit = allBets.reduce((s, b) => s + b.profit, 0);
      const winRate = allBets.length > 0 ? allBets.filter(b => b.result === "W").length / allBets.length : 0;
      console.log(`  [PROGRESS] ${di + 1}/${matchDates.length} matchdays | ${allBets.length} bets | W/L: ${allBets.filter(b => b.result === "W").length}/${allBets.filter(b => b.result === "L").length} | Win%: ${(winRate * 100).toFixed(1)}% | P/L: ${totalProfit >= 0 ? "+" : ""}${totalProfit.toFixed(2)}u | Solves: ${totalSolves}`);
    }
  }

  return { allBets, summaries };
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log("\n");
console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  MI BIVARIATE POISSON — HISTORICAL BACKTEST");
console.log("  Walk-forward value betting against Pinnacle closing odds");
console.log(`  Seasons: ${TARGET_SEASONS.join(", ")} | Leagues: ${TARGET_LEAGUES.join(", ")}`);
console.log(`  Min edge: ${(MIN_EDGE * 100).toFixed(0)}% | Min training: ${MIN_TRAINING_MATCHES} matches`);
console.log("═══════════════════════════════════════════════════════════════════════\n");

const allResults: { league: string; bets: BacktestBet[]; summaries: GameweekSummary[] }[] = [];

for (const league of TARGET_LEAGUES) {
  const result = runBacktest(league, TARGET_SEASONS);
  if (result && "allBets" in result) {
    allResults.push({ league, bets: result.allBets, summaries: result.summaries });
  }
}

// ─── Final summary ──────────────────────────────────────────────────────────

console.log("\n");
console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  BACKTEST RESULTS SUMMARY");
console.log("═══════════════════════════════════════════════════════════════════════\n");

let grandTotal = 0;
let grandBets = 0;
let grandWins = 0;

for (const { league, bets, summaries } of allResults) {
  const wins = bets.filter(b => b.result === "W").length;
  const losses = bets.filter(b => b.result === "L").length;
  const pushes = bets.filter(b => b.result === "P").length;
  const profit = bets.reduce((s, b) => s + b.profit, 0);
  const avgEdge = bets.length > 0 ? bets.reduce((s, b) => s + b.edge, 0) / bets.length : 0;
  const avgOdds = bets.length > 0 ? bets.reduce((s, b) => s + b.pinnacleOdds, 0) / bets.length : 0;
  const roi = bets.length > 0 ? profit / bets.length : 0;

  console.log(`  ${league.toUpperCase()}`);
  console.log(`    Bets: ${bets.length} | W: ${wins} | L: ${losses} | P: ${pushes}`);
  console.log(`    Win rate: ${(wins / Math.max(1, bets.length) * 100).toFixed(1)}%`);
  console.log(`    Avg edge: ${(avgEdge * 100).toFixed(1)}% | Avg odds: ${avgOdds.toFixed(2)}`);
  console.log(`    P/L: ${profit >= 0 ? "+" : ""}${profit.toFixed(2)} units | ROI: ${(roi * 100).toFixed(1)}%`);
  console.log(`    Gameweeks with bets: ${summaries.length}`);
  console.log();

  grandTotal += profit;
  grandBets += bets.length;
  grandWins += wins;
}

if (grandBets > 0) {
  console.log(`  ─── COMBINED ──────────────────────────────────────────────────`);
  console.log(`    Total bets: ${grandBets}`);
  console.log(`    Win rate: ${(grandWins / grandBets * 100).toFixed(1)}%`);
  console.log(`    Total P/L: ${grandTotal >= 0 ? "+" : ""}${grandTotal.toFixed(2)} units`);
  console.log(`    ROI: ${(grandTotal / grandBets * 100).toFixed(1)}%`);
  console.log();
}

// ─── Save detailed results ──────────────────────────────────────────────────

const allBetsFlat = allResults.flatMap(r => r.bets);
const output = {
  generated: new Date().toISOString(),
  config: { seasons: TARGET_SEASONS, leagues: TARGET_LEAGUES, minEdge: MIN_EDGE, minTraining: MIN_TRAINING_MATCHES },
  totalBets: allBetsFlat.length,
  totalProfit: allBetsFlat.reduce((s, b) => s + b.profit, 0),
  roi: allBetsFlat.length > 0 ? allBetsFlat.reduce((s, b) => s + b.profit, 0) / allBetsFlat.length : 0,
  bets: allBetsFlat,
  gameweeks: allResults.flatMap(r => r.summaries),
};

const outFile = join(outDir, `backtest-${TARGET_LEAGUES.join("-")}-${TARGET_SEASONS.join("-")}.json`);
writeFileSync(outFile, JSON.stringify(output, null, 2));
console.log(`  Results saved to ${outFile}\n`);

// ─── Print sample "OUR BETS" per gameweek ───────────────────────────────────

const allSummaries = allResults.flatMap(r => r.summaries).sort((a, b) => a.date.localeCompare(b.date));

// Group by week
const weeks: Map<string, GameweekSummary[]> = new Map();
for (const s of allSummaries) {
  // Group by ISO week
  const d = new Date(s.date);
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - d.getDay());
  const weekKey = weekStart.toISOString().split("T")[0];
  if (!weeks.has(weekKey)) weeks.set(weekKey, []);
  weeks.get(weekKey)!.push(s);
}

console.log(`\n  ─── WEEKLY RESULTS ────────────────────────────────────────────\n`);
console.log(`  ${"Week".padEnd(12)} ${"Bets".padStart(5)} ${"W".padStart(4)} ${"L".padStart(4)} ${"P".padStart(4)} ${"P/L".padStart(8)} ${"Cum P/L".padStart(9)}`);
console.log(`  ${"─".repeat(50)}`);

let cumProfit = 0;
for (const [week, summaries] of [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  const weekBets = summaries.flatMap(s => s.bets);
  const w = weekBets.filter(b => b.result === "W").length;
  const l = weekBets.filter(b => b.result === "L").length;
  const p = weekBets.filter(b => b.result === "P").length;
  const pl = weekBets.reduce((s, b) => s + b.profit, 0);
  cumProfit += pl;

  console.log(`  ${week.padEnd(12)} ${String(weekBets.length).padStart(5)} ${String(w).padStart(4)} ${String(l).padStart(4)} ${String(p).padStart(4)} ${(pl >= 0 ? "+" : "") + pl.toFixed(2).padStart(7)} ${(cumProfit >= 0 ? "+" : "") + cumProfit.toFixed(2).padStart(8)}`);
}

console.log(`\n  [DONE]\n`);
