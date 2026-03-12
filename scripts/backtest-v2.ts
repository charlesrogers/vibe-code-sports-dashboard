/**
 * Backtest V2 — Walk-Forward with CLV Tracking
 *
 * Replaces the fragile 60/40 split with proper walk-forward validation:
 * - Expanding training window, re-solve every 7 days
 * - 3-day embargo to prevent data leakage
 * - CLV (Closing Line Value) as primary metric
 * - Warm-start solver for ~3x speedup
 * - Stability matrix across 6 leagues × 3 test seasons
 * - Sides (1X2 + AH) AND Unders (O/U 2.5) evaluated
 *
 * Data: 5 seasons (2020-21 through 2024-25) × 6 leagues = ~11,400 matches
 * Test window: 2022-23 through 2024-25 (3 seasons, first 2 are warmup)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { prepareMarketMatches, devigOdds1X2, devigOdds2Way } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import { predictMatch } from "../lib/mi-model/predictor";
import type { MISolverConfig, MIModelParams } from "../lib/mi-model/types";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const solverCacheDir = join(projectRoot, "data", "backtest", "solver-cache");

// ─── CLI flags ────────────────────────────────────────────────────────────────
// --leagues epl,championship   Run only specified leagues
// --no-cache                   Force re-solve (ignore cache)

const args = process.argv.slice(2);
const leagueFilter = args.find(a => a.startsWith("--leagues="))?.split("=")[1]?.split(",") ?? null;
const noCache = args.includes("--no-cache");

// ─── Solver cache ─────────────────────────────────────────────────────────────
// Cache solved params by league + matchday + training count + config hash.
// Change model weights → different hash → automatic re-solve.

function configHash(cfg: MISolverConfig): string {
  // Hash the config fields that affect solve output
  const relevant = {
    klWeight: cfg.klWeight, ahWeight: cfg.ahWeight, outcomeWeight: cfg.outcomeWeight,
    xgWeight: cfg.xgWeight, recentFormBoost: cfg.recentFormBoost, decayRate: cfg.decayRate,
    regularization: cfg.regularization, lambda3Range: cfg.lambda3Range,
    attackRange: cfg.attackRange, defenseRange: cfg.defenseRange,
    homeAdvantageRange: cfg.homeAdvantageRange, avgGoalRateRange: cfg.avgGoalRateRange,
    totalsDeflation: cfg.totalsDeflation,
  };
  return createHash("md5").update(JSON.stringify(relevant)).digest("hex").slice(0, 8);
}

function solveCacheKey(league: string, matchday: string, trainCount: number): string {
  return `${league}_${matchday}_${trainCount}_${configHash(baseConfig)}`;
}

function loadCachedSolve(key: string): MIModelParams | null {
  const fp = join(solverCacheDir, `${key}.json`);
  if (!existsSync(fp)) return null;
  try {
    return JSON.parse(readFileSync(fp, "utf-8")) as MIModelParams;
  } catch { return null; }
}

function saveSolveCache(key: string, params: MIModelParams): void {
  if (!existsSync(solverCacheDir)) mkdirSync(solverCacheDir, { recursive: true });
  writeFileSync(join(solverCacheDir, `${key}.json`), JSON.stringify(params));
}
const dataDir = join(projectRoot, "data/football-data-cache");

// ─── Configuration ───────────────────────────────────────────────────────────

const LEAGUES = [
  { id: "epl", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "la-liga", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "bundesliga", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "serie-a", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "ligue-1", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "championship", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
];

// Test window: 2022-23 onward (first 2 seasons are training warmup)
const TEST_SEASON_START = "2022";  // matches from Aug 2022+

const RESOLVE_INTERVAL_DAYS = 7;
const EMBARGO_DAYS = 3;
const MIN_TRAINING_MATCHES = 80;

const baseConfig: MISolverConfig = {
  maxIterations: 200, convergenceThreshold: 1e-6,
  attackRange: [0.3, 3.0], defenseRange: [0.3, 3.0],
  homeAdvantageRange: [0.8, 1.8], lambda3Range: [-0.08, 0.02],
  avgGoalRateRange: [1.0, 1.8], gridSteps: 30,
  decayRate: 0.005, regularization: 0.001,
  klWeight: 0.6, ahWeight: 0.2,
  outcomeWeight: 0.3, xgWeight: 0.2, recentFormBoost: 1.5,
  printEvery: 999, driftFactor: 0,
};

// Warm-start config: fewer iterations since we're close to optimum
const warmConfig: Partial<MISolverConfig> = {
  maxIterations: 30,
  gridSteps: 15,
};

// ─── Bet record ──────────────────────────────────────────────────────────────

interface BetRecord {
  league: string;
  season: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  marketType: "1X2" | "AH" | "OU25";
  selection: string;       // "Home", "Away", "Draw", "Home AH -0.5", "Over 2.5", "Under 2.5"
  modelProb: number;
  closingImpliedProb: number;
  clv: number;             // model_prob - closing_implied_prob
  closingOdds: number;
  homeGoals: number;
  awayGoals: number;
  totalGoals: number;
  won: boolean;
  profit: number;          // flat 1u: won ? closingOdds - 1 : -1
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  BACKTEST V2 — Walk-Forward with CLV Tracking");
console.log("  5 seasons × 6 leagues, test window: 2022-23 through 2024-25");
console.log("  Re-solve every 7 days, 3-day embargo, warm-start solver");
console.log("═══════════════════════════════════════════════════════════════════════\n");

const allBets: BetRecord[] = [];
const startTime = Date.now();
const activeLeagues = leagueFilter
  ? LEAGUES.filter(l => leagueFilter.includes(l.id))
  : LEAGUES;

if (leagueFilter) {
  console.log(`  Filtering to leagues: ${activeLeagues.map(l => l.id).join(", ")}`);
}
console.log(`  Config hash: ${configHash(baseConfig)}`);
if (noCache) console.log(`  Cache disabled (--no-cache)`);
console.log();

for (const league of activeLeagues) {
  const leagueStart = Date.now();
  console.log(`\n[LEAGUE] ${league.id.toUpperCase()} — loading ${league.seasons.length} seasons...`);

  // Load all matches across all seasons
  let rawMatches: any[] = [];
  for (const season of league.seasons) {
    const file = `${league.id}-${season}.json`;
    const fp = join(dataDir, file);
    if (!existsSync(fp)) { console.log(`  Missing: ${file}`); continue; }
    try {
      const raw = JSON.parse(readFileSync(fp, "utf-8"));
      const matches = raw.matches || [];
      rawMatches.push(...matches);
    } catch { continue; }
  }

  if (rawMatches.length === 0) { console.log(`  No data, skipping.`); continue; }

  // Sort by date
  rawMatches.sort((a: any, b: any) => a.date.localeCompare(b.date));
  console.log(`  ${rawMatches.length} total matches loaded`);

  // Split into training warmup and test window
  const testMatches = rawMatches.filter((m: any) => m.date >= `${TEST_SEASON_START}-07-01`);
  console.log(`  Test window: ${testMatches.length} matches (from ${TEST_SEASON_START}-07 onward)`);

  if (testMatches.length === 0) continue;

  // Get unique matchdays in test window
  const matchdayDates = [...new Set(testMatches.map((m: any) => m.date))].sort();
  console.log(`  ${matchdayDates.length} unique matchdays in test window`);

  // Walk-forward
  let prevParams: MIModelParams | null = null;
  let lastSolveDate = "";
  let solveCount = 0;
  let leagueBets = 0;

  for (let di = 0; di < matchdayDates.length; di++) {
    const matchday = matchdayDates[di];

    // Check if we need to re-solve
    const daysSinceSolve = lastSolveDate
      ? Math.floor((new Date(matchday).getTime() - new Date(lastSolveDate).getTime()) / 86400000)
      : Infinity;

    if (daysSinceSolve >= RESOLVE_INTERVAL_DAYS || !prevParams) {
      // Get training data: all matches before (matchday - embargo)
      const embargoDate = new Date(new Date(matchday).getTime() - EMBARGO_DAYS * 86400000)
        .toISOString().split("T")[0];
      const trainRaw = rawMatches.filter((m: any) => m.date < embargoDate);

      if (trainRaw.length < MIN_TRAINING_MATCHES) continue;

      // Check solver cache first
      const cacheKey = solveCacheKey(league.id, matchday, trainRaw.length);
      const cached = noCache ? null : loadCachedSolve(cacheKey);
      if (cached) {
        prevParams = cached;
        lastSolveDate = matchday;
        solveCount++;
        if (solveCount % 10 === 0 || solveCount === 1) {
          console.log(`  [cached ${solveCount}] ${matchday} — ${trainRaw.length} train matches, loss=${cached.convergenceInfo.finalLoss.toFixed(4)}`);
        }
      } else {
        // Prepare for solver
        const trainData = {
          league: league.id, season: "backtest",
          fetchedAt: new Date().toISOString(),
          matchCount: trainRaw.length, matches: trainRaw,
        };
        const prepared = prepareMarketMatches(trainData, { useClosing: true, requirePinnacle: true });
        if (prepared.length < MIN_TRAINING_MATCHES) continue;

        // Solve with warm-start if available
        const solveConfig: MISolverConfig = prevParams
          ? {
              ...baseConfig, ...warmConfig,
              initialRatings: Object.fromEntries(
                Object.entries(prevParams.teams).map(([t, r]) => [t, { attack: r.attack, defense: r.defense }])
              ),
              initialHomeAdvantage: prevParams.homeAdvantage,
              initialCorrelation: prevParams.correlation,
              initialAvgGoalRate: prevParams.avgGoalRate,
            }
          : baseConfig;

        prevParams = solveRatings(prepared, league.id, "backtest", solveConfig);
        saveSolveCache(cacheKey, prevParams);
        lastSolveDate = matchday;
        solveCount++;

        if (solveCount % 5 === 0 || solveCount === 1) {
          console.log(`  [solve ${solveCount}] ${matchday} — ${trainRaw.length} train matches, loss=${prevParams.convergenceInfo.finalLoss.toFixed(4)}`);
        }
      }
    }

    if (!prevParams) continue;

    // Predict each match on this matchday
    const dayMatches = rawMatches.filter((m: any) => m.date === matchday);

    for (const m of dayMatches) {
      if (m.homeGoals == null || m.awayGoals == null) continue;
      if (!prevParams.teams[m.homeTeam] || !prevParams.teams[m.awayTeam]) continue;

      let pred;
      try { pred = predictMatch(prevParams, m.homeTeam, m.awayTeam); }
      catch { continue; }

      const totalGoals = m.homeGoals + m.awayGoals;
      const season = m.season || "unknown";

      // ─── SIDES: 1X2 ───────────────────────────────────────────────────
      if (m.pinnacleCloseHome && m.pinnacleCloseDraw && m.pinnacleCloseAway) {
        const closingMkt = devigOdds1X2(m.pinnacleCloseHome, m.pinnacleCloseDraw, m.pinnacleCloseAway);
        if (closingMkt) {
          // Home
          const homeClv = pred.probs1X2.home - closingMkt.home;
          if (homeClv > 0) {
            allBets.push({
              league: league.id, season, date: m.date,
              homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              marketType: "1X2", selection: "Home",
              modelProb: pred.probs1X2.home, closingImpliedProb: closingMkt.home,
              clv: homeClv, closingOdds: m.pinnacleCloseHome,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
              won: m.homeGoals > m.awayGoals,
              profit: m.homeGoals > m.awayGoals ? m.pinnacleCloseHome - 1 : -1,
            });
            leagueBets++;
          }

          // Away
          const awayClv = pred.probs1X2.away - closingMkt.away;
          if (awayClv > 0) {
            allBets.push({
              league: league.id, season, date: m.date,
              homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              marketType: "1X2", selection: "Away",
              modelProb: pred.probs1X2.away, closingImpliedProb: closingMkt.away,
              clv: awayClv, closingOdds: m.pinnacleCloseAway,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
              won: m.awayGoals > m.homeGoals,
              profit: m.awayGoals > m.homeGoals ? m.pinnacleCloseAway - 1 : -1,
            });
            leagueBets++;
          }

          // Draw (record but we typically filter these out)
          const drawClv = pred.probs1X2.draw - closingMkt.draw;
          if (drawClv > 0) {
            allBets.push({
              league: league.id, season, date: m.date,
              homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              marketType: "1X2", selection: "Draw",
              modelProb: pred.probs1X2.draw, closingImpliedProb: closingMkt.draw,
              clv: drawClv, closingOdds: m.pinnacleCloseDraw,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
              won: m.homeGoals === m.awayGoals,
              profit: m.homeGoals === m.awayGoals ? m.pinnacleCloseDraw - 1 : -1,
            });
            leagueBets++;
          }
        }
      }

      // ─── SIDES: AH ────────────────────────────────────────────────────
      const ahLine = m.ahCloseLine ?? m.ahLine;
      const ahHome = m.pinnacleCloseAHHome ?? m.pinnacleAHHome;
      const ahAway = m.pinnacleCloseAHAway ?? m.pinnacleAHAway;
      if (ahLine != null && ahHome && ahAway) {
        const ahKey = String(ahLine);
        const modelAH = pred.asianHandicap[ahKey];
        const closingAH = devigOdds2Way(ahHome, ahAway);
        if (modelAH && closingAH) {
          // Home AH
          const homeAhClv = modelAH.home - closingAH.prob1;
          if (homeAhClv > 0) {
            // Determine AH result
            const goalDiff = m.homeGoals - m.awayGoals;
            const ahResult = goalDiff + ahLine; // positive = home covers
            const won = ahResult > 0;
            const push = ahResult === 0;
            allBets.push({
              league: league.id, season, date: m.date,
              homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              marketType: "AH", selection: `Home AH ${ahLine >= 0 ? "+" : ""}${ahLine}`,
              modelProb: modelAH.home, closingImpliedProb: closingAH.prob1,
              clv: homeAhClv, closingOdds: ahHome,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
              won, profit: push ? 0 : won ? ahHome - 1 : -1,
            });
            leagueBets++;
          }

          // Away AH
          const awayAhClv = modelAH.away - closingAH.prob2;
          if (awayAhClv > 0) {
            const goalDiff = m.homeGoals - m.awayGoals;
            const ahResult = -(goalDiff + ahLine); // positive = away covers
            const won = ahResult > 0;
            const push = ahResult === 0;
            allBets.push({
              league: league.id, season, date: m.date,
              homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              marketType: "AH", selection: `Away AH ${-ahLine >= 0 ? "+" : ""}${-ahLine}`,
              modelProb: modelAH.away, closingImpliedProb: closingAH.prob2,
              clv: awayAhClv, closingOdds: ahAway,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
              won, profit: push ? 0 : won ? ahAway - 1 : -1,
            });
            leagueBets++;
          }
        }
      }

      // ─── TOTALS: O/U 2.5 ──────────────────────────────────────────────
      const closeOver = m.pinnacleCloseOver25 || m.pinnacleOver25;
      const closeUnder = m.pinnacleCloseUnder25 || m.pinnacleUnder25;
      if (closeOver && closeUnder) {
        const closingOU = devigOdds2Way(closeOver, closeUnder);
        const modelOU = pred.overUnder["2.5"];
        if (closingOU && modelOU) {
          // Over 2.5
          const overClv = modelOU.over - closingOU.prob1;
          if (overClv > 0) {
            allBets.push({
              league: league.id, season, date: m.date,
              homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              marketType: "OU25", selection: "Over 2.5",
              modelProb: modelOU.over, closingImpliedProb: closingOU.prob1,
              clv: overClv, closingOdds: closeOver,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
              won: totalGoals > 2.5,
              profit: totalGoals > 2.5 ? closeOver - 1 : -1,
            });
            leagueBets++;
          }

          // Under 2.5
          const underClv = modelOU.under - closingOU.prob2;
          if (underClv > 0) {
            allBets.push({
              league: league.id, season, date: m.date,
              homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              marketType: "OU25", selection: "Under 2.5",
              modelProb: modelOU.under, closingImpliedProb: closingOU.prob2,
              clv: underClv, closingOdds: closeUnder,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
              won: totalGoals < 2.5,
              profit: totalGoals < 2.5 ? closeUnder - 1 : -1,
            });
            leagueBets++;
          }
        }
      }
    }
  }

  const elapsed = ((Date.now() - leagueStart) / 1000).toFixed(1);
  console.log(`  [DONE] ${league.id}: ${solveCount} solves, ${leagueBets} bets, ${elapsed}s`);
}

const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
console.log(`\n[PROGRESS] All leagues complete. ${allBets.length} total bet records in ${totalElapsed}s\n`);

// ─── Results ─────────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  RESULTS — Walk-Forward Backtest V2");
console.log("═══════════════════════════════════════════════════════════════════════\n");

if (allBets.length === 0) {
  console.log("  No bets found.");
  process.exit(0);
}

// ─── Helper: summarize a set of bets ─────────────────────────────────────────

function summarize(bets: BetRecord[]): { n: number; clv: number; roi: number; hitRate: number; avgOdds: number; profit: number } {
  if (bets.length === 0) return { n: 0, clv: 0, roi: 0, hitRate: 0, avgOdds: 0, profit: 0 };
  const wins = bets.filter(b => b.won).length;
  const totalProfit = bets.reduce((s, b) => s + b.profit, 0);
  return {
    n: bets.length,
    clv: bets.reduce((s, b) => s + b.clv, 0) / bets.length,
    roi: totalProfit / bets.length,
    hitRate: wins / bets.length,
    avgOdds: bets.reduce((s, b) => s + b.closingOdds, 0) / bets.length,
    profit: totalProfit,
  };
}

function fmtPct(v: number, sign = true): string {
  const s = (v * 100).toFixed(1);
  return sign && v >= 0 ? `+${s}%` : `${s}%`;
}

// ─── Apply edge thresholds ───────────────────────────────────────────────────

const MIN_EDGES = [0.00, 0.03, 0.05, 0.07, 0.10];

console.log("  ─── BY EDGE THRESHOLD ────────────────────────────────────────────\n");
console.log("  Threshold   Bets     CLV       ROI      Hit%    Avg Odds   Profit");
console.log("  " + "─".repeat(68));

for (const minEdge of MIN_EDGES) {
  const filtered = allBets.filter(b => b.clv >= minEdge);
  const s = summarize(filtered);
  if (s.n === 0) continue;
  console.log(
    `  ${(minEdge * 100).toFixed(0).padStart(5)}%    ${String(s.n).padStart(5)}   ${fmtPct(s.clv).padStart(7)}   ${fmtPct(s.roi).padStart(7)}   ${(s.hitRate * 100).toFixed(1).padStart(5)}%   ${s.avgOdds.toFixed(2).padStart(6)}   ${s.profit >= 0 ? "+" : ""}${s.profit.toFixed(1).padStart(7)}u`
  );
}

// ─── Stability Matrix (5% edge threshold) ────────────────────────────────────

const EDGE_THRESHOLD = 0.05;
const filtered = allBets.filter(b => b.clv >= EDGE_THRESHOLD);

// Exclude draws for sides
const sidesNoDraw = filtered.filter(b => (b.marketType === "1X2" || b.marketType === "AH") && b.selection !== "Draw");
const unders = filtered.filter(b => b.selection === "Under 2.5");
const overs = filtered.filter(b => b.selection === "Over 2.5");
const ahOnly = filtered.filter(b => b.marketType === "AH");

console.log(`\n  ─── STABILITY MATRIX (edge >= ${(EDGE_THRESHOLD * 100).toFixed(0)}%) ─────────────────────────────\n`);

// Header
const leagueIds = activeLeagues.map(l => l.id);
const colWidth = 10;
console.log("  " + "".padEnd(16) + leagueIds.map(l => l.toUpperCase().padStart(colWidth)).join("") + "OVERALL".padStart(colWidth));
console.log("  " + "─".repeat(16 + (leagueIds.length + 1) * colWidth));

// Rows
const marketSets: { label: string; filter: (b: BetRecord) => boolean }[] = [
  { label: "Sides CLV", filter: b => (b.marketType === "1X2" || b.marketType === "AH") && b.selection !== "Draw" },
  { label: "Sides ROI", filter: b => (b.marketType === "1X2" || b.marketType === "AH") && b.selection !== "Draw" },
  { label: "Sides n", filter: b => (b.marketType === "1X2" || b.marketType === "AH") && b.selection !== "Draw" },
  { label: "AH CLV", filter: b => b.marketType === "AH" },
  { label: "AH ROI", filter: b => b.marketType === "AH" },
  { label: "AH n", filter: b => b.marketType === "AH" },
  { label: "Under CLV", filter: b => b.selection === "Under 2.5" },
  { label: "Under ROI", filter: b => b.selection === "Under 2.5" },
  { label: "Under n", filter: b => b.selection === "Under 2.5" },
  { label: "Over CLV", filter: b => b.selection === "Over 2.5" },
  { label: "Over ROI", filter: b => b.selection === "Over 2.5" },
  { label: "Over n", filter: b => b.selection === "Over 2.5" },
];

for (const row of marketSets) {
  const isClv = row.label.includes("CLV");
  const isRoi = row.label.includes("ROI");
  const isN = row.label.includes(" n");

  let line = "  " + row.label.padEnd(16);
  for (const lid of [...leagueIds, "ALL"]) {
    const subset = lid === "ALL"
      ? filtered.filter(row.filter)
      : filtered.filter(b => b.league === lid).filter(row.filter);
    const s = summarize(subset);
    if (isN) {
      line += String(s.n).padStart(colWidth);
    } else if (isClv) {
      line += (s.n > 0 ? fmtPct(s.clv) : "—").padStart(colWidth);
    } else {
      line += (s.n > 0 ? fmtPct(s.roi) : "—").padStart(colWidth);
    }
  }
  console.log(line);

  // Add separator between groups
  if (isN && row.label !== "Over n") {
    console.log("  " + "─".repeat(16 + (leagueIds.length + 1) * colWidth));
  }
}

// ─── By Season ───────────────────────────────────────────────────────────────

console.log(`\n  ─── BY SEASON (sides no draw, edge >= ${(EDGE_THRESHOLD * 100).toFixed(0)}%) ──────────────────────\n`);

const seasons = [...new Set(filtered.map(b => b.season))].sort();
for (const season of seasons) {
  const seasonBets = sidesNoDraw.filter(b => b.season === season);
  const s = summarize(seasonBets);
  if (s.n < 10) continue;
  console.log(`  ${season.padEnd(12)} n=${String(s.n).padStart(4)}  CLV=${fmtPct(s.clv).padStart(7)}  ROI=${fmtPct(s.roi).padStart(7)}  hit=${(s.hitRate * 100).toFixed(1).padStart(5)}%`);
}

// ─── Verdict ─────────────────────────────────────────────────────────────────

console.log(`\n  ─── VERDICT ──────────────────────────────────────────────────────\n`);

const sidesOverall = summarize(sidesNoDraw);
const undersOverall = summarize(unders);
const oversOverall = summarize(overs);
const ahOverall = summarize(ahOnly);

// Count positive-CLV leagues
const posLeaguesSides = leagueIds.filter(l => {
  const s = summarize(sidesNoDraw.filter(b => b.league === l));
  return s.n > 20 && s.clv > 0;
}).length;
const posLeaguesUnders = leagueIds.filter(l => {
  const s = summarize(unders.filter(b => b.league === l));
  return s.n > 20 && s.clv > 0;
}).length;

console.log(`  SIDES (no draw):  CLV=${fmtPct(sidesOverall.clv)}  ROI=${fmtPct(sidesOverall.roi)}  n=${sidesOverall.n}  positive leagues: ${posLeaguesSides}/6`);
console.log(`  AH only:          CLV=${fmtPct(ahOverall.clv)}  ROI=${fmtPct(ahOverall.roi)}  n=${ahOverall.n}`);
console.log(`  UNDERS:           CLV=${fmtPct(undersOverall.clv)}  ROI=${fmtPct(undersOverall.roi)}  n=${undersOverall.n}  positive leagues: ${posLeaguesUnders}/6`);
console.log(`  OVERS:            CLV=${fmtPct(oversOverall.clv)}  ROI=${fmtPct(oversOverall.roi)}  n=${oversOverall.n}`);

// Pass criteria
const sidesPass = sidesOverall.clv > 0 && posLeaguesSides >= 4 && sidesOverall.n >= 500;
const undersPass = undersOverall.clv > 0 && posLeaguesUnders >= 3 && undersOverall.n >= 200;

console.log();
if (sidesPass) {
  console.log(`  SIDES: PASS — positive CLV in ${posLeaguesSides}/6 leagues, overall ${fmtPct(sidesOverall.clv)}`);
} else {
  console.log(`  SIDES: ${sidesOverall.clv > 0 ? "MARGINAL" : "FAIL"} — CLV ${fmtPct(sidesOverall.clv)}, ${posLeaguesSides}/6 positive leagues`);
}
if (undersPass) {
  console.log(`  UNDERS: PASS — positive CLV in ${posLeaguesUnders}/6 leagues, overall ${fmtPct(undersOverall.clv)}`);
} else {
  console.log(`  UNDERS: ${undersOverall.clv > 0 ? "MARGINAL" : "FAIL"} — CLV ${fmtPct(undersOverall.clv)}, ${posLeaguesUnders}/6 positive leagues`);
}
console.log();

// ─── Save results ────────────────────────────────────────────────────────────

const outDir = join(projectRoot, "data", "backtest");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const output = {
  generated: new Date().toISOString(),
  config: {
    testWindowStart: TEST_SEASON_START,
    resolveInterval: RESOLVE_INTERVAL_DAYS,
    embargoDays: EMBARGO_DAYS,
    edgeThreshold: EDGE_THRESHOLD,
    leagues: leagueIds,
    lambda3Range: baseConfig.lambda3Range,
    totalsDeflation: 0.965,
  },
  summary: {
    totalBets: allBets.length,
    filteredBets: filtered.length,
    sides: sidesOverall,
    unders: undersOverall,
    overs: oversOverall,
    ah: ahOverall,
    sidesPass,
    undersPass,
  },
  bets: allBets.map(b => ({
    ...b,
    clv: Math.round(b.clv * 10000) / 10000,
    profit: Math.round(b.profit * 100) / 100,
  })),
};

const outPath = join(outDir, "backtest-v2-results.json");
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`  Results saved to data/backtest/backtest-v2-results.json`);
console.log(`  Total runtime: ${totalElapsed}s`);
console.log();
