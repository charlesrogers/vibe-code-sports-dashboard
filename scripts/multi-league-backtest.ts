/**
 * Multi-League Backtest — Walk-Forward + Ted Filters, Combined Report
 *
 * Runs walk-forward backtest across EPL, La Liga, Bundesliga, Serie A
 * with Ted filters (variance, congestion, defiance, skip-early).
 * Produces per-league and combined ROI/P&L/CLV report.
 *
 * Uses solver cache from backtest-v2.ts when available; solves fresh if missing.
 * Saves results to data/backtest/multi-league-results.json.
 *
 * Usage:
 *   npx tsx scripts/multi-league-backtest.ts
 *   npx tsx scripts/multi-league-backtest.ts --no-cache
 *   npx tsx scripts/multi-league-backtest.ts --max-odds=2.0
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import { prepareMarketMatches, devigOdds1X2, devigOdds2Way } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import { predictMatch } from "../lib/mi-model/predictor";
import type { MISolverConfig, MIModelParams } from "../lib/mi-model/types";
import { isPostInternationalBreak } from "../lib/mi-picks/international-breaks";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const dataDir = join(projectRoot, "data/football-data-cache");
const solverCacheDir = join(projectRoot, "data", "backtest", "solver-cache");
const outDir = join(projectRoot, "data", "backtest");

// ─── CLI flags ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const noCache = args.includes("--no-cache");
const maxOdds = (() => {
  const a = args.find(x => x.startsWith("--max-odds="));
  return a ? parseFloat(a.split("=")[1]) : 2.0; // Default: Ted's 2.0 cap
})();

// ─── Configuration ──────────────────────────────────────────────────────────

const LEAGUES = [
  { id: "epl", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "la-liga", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "bundesliga", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "serie-a", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
];

const TEST_SEASON_START = "2022";
const RESOLVE_INTERVAL_DAYS = 7;
const EMBARGO_DAYS = 3;
const MIN_TRAINING_MATCHES = 80;

// Ted filter config
const VARIANCE_LOOKBACK = 10;
const VARIANCE_MIN_GAP = 3.0;
const DEFIANCE_STREAK = 10;
const SKIP_EARLY_N = 5;

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

const warmConfig: Partial<MISolverConfig> = {
  maxIterations: 30,
  gridSteps: 15,
};

// ─── Solver cache ───────────────────────────────────────────────────────────

function configHash(cfg: MISolverConfig): string {
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
  try { return JSON.parse(readFileSync(fp, "utf-8")) as MIModelParams; }
  catch { return null; }
}

function saveSolveCache(key: string, params: MIModelParams): void {
  if (!existsSync(solverCacheDir)) mkdirSync(solverCacheDir, { recursive: true });
  writeFileSync(join(solverCacheDir, `${key}.json`), JSON.stringify(params));
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface BetRecord {
  league: string; season: string; date: string;
  homeTeam: string; awayTeam: string;
  marketType: "1X2" | "AH" | "OU25";
  selection: string;
  modelProb: number; closingImpliedProb: number;
  clv: number; closingOdds: number;
  homeGoals: number; awayGoals: number; totalGoals: number;
  won: boolean; profit: number;
}

interface TeamHistory {
  matches: { date: string; expectedGF: number; actualGF: number; expectedGA: number; actualGA: number }[];
  defianceCount: number;
  lastDefianceDir: "over" | "under" | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function summarize(bets: BetRecord[]) {
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

function fmtPct(v: number): string {
  const s = (v * 100).toFixed(1);
  return v >= 0 ? `+${s}%` : `${s}%`;
}

// ─── Main ───────────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  MULTI-LEAGUE BACKTEST — Walk-Forward + Ted Filters");
console.log("  4 leagues × 5 seasons, test: 2022-23 through 2024-25");
console.log("  Ted: variance + skip-early(5) + congestion + defiance(10)");
console.log(`  Max odds: ${maxOdds}`);
console.log("═══════════════════════════════════════════════════════════════════════\n");

const startTime = Date.now();
const allBets: BetRecord[] = [];
const leagueResults: Record<string, ReturnType<typeof summarize>> = {};

for (const league of LEAGUES) {
  const leagueStart = Date.now();
  console.log(`\n[LEAGUE] ${league.id.toUpperCase()} — loading ${league.seasons.length} seasons...`);

  // Load all matches
  let rawMatches: any[] = [];
  for (const season of league.seasons) {
    const fp = join(dataDir, `${league.id}-${season}.json`);
    if (!existsSync(fp)) { console.log(`  Missing: ${league.id}-${season}.json`); continue; }
    try {
      const raw = JSON.parse(readFileSync(fp, "utf-8"));
      rawMatches.push(...(raw.matches || []));
    } catch { continue; }
  }

  if (rawMatches.length === 0) { console.log(`  No data, skipping.`); continue; }
  rawMatches.sort((a: any, b: any) => a.date.localeCompare(b.date));
  console.log(`  ${rawMatches.length} total matches loaded`);

  // Test window
  const testMatches = rawMatches.filter((m: any) => m.date >= `${TEST_SEASON_START}-07-01`);
  const matchdayDates = [...new Set(testMatches.map((m: any) => m.date))].sort();
  console.log(`  Test window: ${testMatches.length} matches, ${matchdayDates.length} matchdays`);

  if (testMatches.length === 0) continue;

  // ─── Walk-forward solver ──────────────────────────────────────────────────

  let prevParams: MIModelParams | null = null;
  let lastSolveDate = "";
  let solveCount = 0;
  let leagueBets = 0;
  const skipped = { early: 0, variance: 0, congestion: 0, defiance: 0, intlBreak: 0 };

  // ─── Ted filter state ─────────────────────────────────────────────────────

  const teamHistory: Record<string, TeamHistory> = {};
  function getTeamHist(team: string): TeamHistory {
    if (!teamHistory[team]) teamHistory[team] = { matches: [], defianceCount: 0, lastDefianceDir: null };
    return teamHistory[team];
  }

  // Build team match-date index for congestion check
  const teamMatchDates: Record<string, string[]> = {};
  for (const m of rawMatches) {
    if (!teamMatchDates[m.homeTeam]) teamMatchDates[m.homeTeam] = [];
    if (!teamMatchDates[m.awayTeam]) teamMatchDates[m.awayTeam] = [];
    teamMatchDates[m.homeTeam].push(m.date);
    teamMatchDates[m.awayTeam].push(m.date);
  }

  // Pre-populate team history from training matches
  const trainMatches = rawMatches.filter((m: any) => m.date < `${TEST_SEASON_START}-07-01`);
  for (const m of trainMatches) {
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const hh = getTeamHist(m.homeTeam);
    const ah = getTeamHist(m.awayTeam);
    const avgRate = 1.35;
    hh.matches.push({ date: m.date, expectedGF: avgRate, actualGF: m.homeGoals, expectedGA: avgRate, actualGA: m.awayGoals });
    ah.matches.push({ date: m.date, expectedGF: avgRate, actualGF: m.awayGoals, expectedGA: avgRate, actualGA: m.homeGoals });
    if (hh.matches.length > VARIANCE_LOOKBACK) hh.matches.shift();
    if (ah.matches.length > VARIANCE_LOOKBACK) ah.matches.shift();
  }

  function updateTeamHistory(m: any, pred: any) {
    const hh = getTeamHist(m.homeTeam);
    const ah = getTeamHist(m.awayTeam);
    hh.matches.push({
      date: m.date, expectedGF: pred.expectedGoals.home, actualGF: m.homeGoals,
      expectedGA: pred.expectedGoals.away, actualGA: m.awayGoals,
    });
    ah.matches.push({
      date: m.date, expectedGF: pred.expectedGoals.away, actualGF: m.awayGoals,
      expectedGA: pred.expectedGoals.home, actualGA: m.homeGoals,
    });
    if (hh.matches.length > VARIANCE_LOOKBACK) hh.matches.shift();
    if (ah.matches.length > VARIANCE_LOOKBACK) ah.matches.shift();

    for (const [team, expG, actG] of [
      [m.homeTeam, pred.expectedGoals.home + pred.expectedGoals.away, m.homeGoals + m.awayGoals],
      [m.awayTeam, pred.expectedGoals.away + pred.expectedGoals.home, m.awayGoals + m.homeGoals],
    ] as [string, number, number][]) {
      const th = getTeamHist(team);
      const dir = actG > expG ? "over" as const : "under" as const;
      if (th.lastDefianceDir === dir) th.defianceCount++;
      else { th.defianceCount = 1; th.lastDefianceDir = dir; }
    }
  }

  // Season tracking for skip-early
  let currentSeason = "";
  let seasonMatchdayCount = 0;

  for (let di = 0; di < matchdayDates.length; di++) {
    const matchday = matchdayDates[di];

    // ─── Re-solve if needed ─────────────────────────────────────────────────
    const daysSinceSolve = lastSolveDate
      ? Math.floor((new Date(matchday).getTime() - new Date(lastSolveDate).getTime()) / 86400000)
      : Infinity;

    if (daysSinceSolve >= RESOLVE_INTERVAL_DAYS || !prevParams) {
      const embargoDate = new Date(new Date(matchday).getTime() - EMBARGO_DAYS * 86400000)
        .toISOString().split("T")[0];
      const trainRaw = rawMatches.filter((m: any) => m.date < embargoDate);

      if (trainRaw.length < MIN_TRAINING_MATCHES) continue;

      const cacheKey = solveCacheKey(league.id, matchday, trainRaw.length);
      const cached = noCache ? null : loadCachedSolve(cacheKey);

      if (cached) {
        prevParams = cached;
        lastSolveDate = matchday;
        solveCount++;
        if (solveCount % 10 === 0 || solveCount === 1) {
          console.log(`  [cached ${solveCount}] ${matchday} — ${trainRaw.length} train, loss=${cached.convergenceInfo.finalLoss.toFixed(4)}`);
        }
      } else {
        const trainData = {
          league: league.id, season: "backtest",
          fetchedAt: new Date().toISOString(),
          matchCount: trainRaw.length, matches: trainRaw,
        };
        const prepared = prepareMarketMatches(trainData, { useClosing: true, requirePinnacle: true });
        if (prepared.length < MIN_TRAINING_MATCHES) continue;

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
          console.log(`  [solve ${solveCount}] ${matchday} — ${trainRaw.length} train, loss=${prevParams.convergenceInfo.finalLoss.toFixed(4)}`);
        }
      }
    }

    if (!prevParams) continue;

    const dayMatches = rawMatches.filter((m: any) => m.date === matchday);

    // ─── Season tracking for skip-early ─────────────────────────────────────
    const matchMonth = parseInt(matchday.slice(5, 7));
    const seasonKey = matchMonth >= 7 ? matchday.slice(0, 4) : String(parseInt(matchday.slice(0, 4)) - 1);
    if (seasonKey !== currentSeason) {
      currentSeason = seasonKey;
      seasonMatchdayCount = 0;
    }
    seasonMatchdayCount++;

    // Skip early-season matchdays
    if (seasonMatchdayCount <= SKIP_EARLY_N) {
      skipped.early += dayMatches.filter((m: any) => m.homeGoals != null).length;
      for (const m of dayMatches) {
        if (m.homeGoals == null || m.awayGoals == null) continue;
        if (!prevParams.teams[m.homeTeam] || !prevParams.teams[m.awayTeam]) continue;
        let pred;
        try { pred = predictMatch(prevParams, m.homeTeam, m.awayTeam); } catch { continue; }
        updateTeamHistory(m, pred);
      }
      continue;
    }

    // Skip post-international-break matchdays
    if (isPostInternationalBreak(matchday)) {
      skipped.intlBreak += dayMatches.filter((m: any) => m.homeGoals != null).length;
      for (const m of dayMatches) {
        if (m.homeGoals == null || m.awayGoals == null) continue;
        if (!prevParams.teams[m.homeTeam] || !prevParams.teams[m.awayTeam]) continue;
        let pred;
        try { pred = predictMatch(prevParams, m.homeTeam, m.awayTeam); } catch { continue; }
        updateTeamHistory(m, pred);
      }
      continue;
    }

    for (const m of dayMatches) {
      if (m.homeGoals == null || m.awayGoals == null) continue;
      if (!prevParams.teams[m.homeTeam] || !prevParams.teams[m.awayTeam]) continue;

      let pred;
      try { pred = predictMatch(prevParams, m.homeTeam, m.awayTeam); }
      catch { continue; }

      const totalGoals = m.homeGoals + m.awayGoals;
      const season = m.season || "unknown";

      // ─── Congestion filter ──────────────────────────────────────────────
      const isCongested = (team: string) => {
        const dates = teamMatchDates[team] || [];
        const idx = dates.indexOf(matchday);
        if (idx < 2) return false;
        const d8ago = new Date(new Date(matchday).getTime() - 8 * 86400000).toISOString().split("T")[0];
        let count = 0;
        for (let i = idx - 1; i >= 0 && dates[i] >= d8ago; i--) count++;
        return count >= 2;
      };
      if (isCongested(m.homeTeam) || isCongested(m.awayTeam)) {
        skipped.congestion++;
        updateTeamHistory(m, pred);
        continue;
      }

      // ─── Variance filter ────────────────────────────────────────────────
      const isRegressionCandidate = (team: string): boolean => {
        const hist = getTeamHist(team);
        if (hist.matches.length < VARIANCE_LOOKBACK) return false;
        const recent = hist.matches.slice(-VARIANCE_LOOKBACK);
        const gaGap = recent.reduce((s, h) => s + (h.actualGA - h.expectedGA), 0);
        const gfGap = recent.reduce((s, h) => s + (h.actualGF - h.expectedGF), 0);
        return Math.abs(gaGap) >= VARIANCE_MIN_GAP || Math.abs(gfGap) >= VARIANCE_MIN_GAP;
      };
      if (!isRegressionCandidate(m.homeTeam) && !isRegressionCandidate(m.awayTeam)) {
        skipped.variance++;
        updateTeamHistory(m, pred);
        continue;
      }

      // ─── Defiance filter ────────────────────────────────────────────────
      const isDefiant = (team: string): boolean => {
        const hist = getTeamHist(team);
        return hist.defianceCount >= DEFIANCE_STREAK;
      };
      if (isDefiant(m.homeTeam) || isDefiant(m.awayTeam)) {
        skipped.defiance++;
        updateTeamHistory(m, pred);
        continue;
      }

      // ─── 1X2 ───────────────────────────────────────────────────────────
      if (m.pinnacleCloseHome && m.pinnacleCloseDraw && m.pinnacleCloseAway) {
        const closingMkt = devigOdds1X2(m.pinnacleCloseHome, m.pinnacleCloseDraw, m.pinnacleCloseAway);
        if (closingMkt) {
          const sides = [
            { sel: "Home", mp: pred.probs1X2.home, cp: closingMkt.home, odds: m.pinnacleCloseHome, won: m.homeGoals > m.awayGoals },
            { sel: "Away", mp: pred.probs1X2.away, cp: closingMkt.away, odds: m.pinnacleCloseAway, won: m.awayGoals > m.homeGoals },
          ];
          for (const s of sides) {
            const clv = s.mp - s.cp;
            if (clv <= 0) continue;
            if (s.odds > maxOdds) continue;
            allBets.push({
              league: league.id, season, date: m.date,
              homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              marketType: "1X2", selection: s.sel,
              modelProb: s.mp, closingImpliedProb: s.cp,
              clv, closingOdds: s.odds,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
              won: s.won, profit: s.won ? s.odds - 1 : -1,
            });
            leagueBets++;
          }
        }
      }

      // ─── AH ────────────────────────────────────────────────────────────
      const ahLine = m.ahCloseLine ?? m.ahLine;
      const ahHome = m.pinnacleCloseAHHome ?? m.pinnacleAHHome;
      const ahAway = m.pinnacleCloseAHAway ?? m.pinnacleAHAway;
      if (ahLine != null && ahHome && ahAway) {
        const ahKey = String(ahLine);
        const modelAH = pred.asianHandicap[ahKey];
        const closingAH = devigOdds2Way(ahHome, ahAway);
        if (modelAH && closingAH) {
          const goalDiff = m.homeGoals - m.awayGoals;
          const ahSides = [
            { sel: `Home AH ${ahLine >= 0 ? "+" : ""}${ahLine}`, mp: modelAH.home, cp: closingAH.prob1, odds: ahHome, result: goalDiff + ahLine },
            { sel: `Away AH ${-ahLine >= 0 ? "+" : ""}${-ahLine}`, mp: modelAH.away, cp: closingAH.prob2, odds: ahAway, result: -(goalDiff + ahLine) },
          ];
          for (const s of ahSides) {
            const clv = s.mp - s.cp;
            if (clv <= 0) continue;
            if (s.odds > maxOdds) continue;
            const won = s.result > 0;
            const push = s.result === 0;
            allBets.push({
              league: league.id, season, date: m.date,
              homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              marketType: "AH", selection: s.sel,
              modelProb: s.mp, closingImpliedProb: s.cp,
              clv, closingOdds: s.odds,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
              won, profit: push ? 0 : won ? s.odds - 1 : -1,
            });
            leagueBets++;
          }
        }
      }

      // ─── O/U 2.5 ───────────────────────────────────────────────────────
      const closeOver = m.pinnacleCloseOver25 || m.pinnacleOver25;
      const closeUnder = m.pinnacleCloseUnder25 || m.pinnacleUnder25;
      if (closeOver && closeUnder) {
        const closingOU = devigOdds2Way(closeOver, closeUnder);
        const modelOU = pred.overUnder["2.5"];
        if (closingOU && modelOU) {
          const ouSides = [
            { sel: "Over 2.5", mp: modelOU.over, cp: closingOU.prob1, odds: closeOver, won: totalGoals > 2.5 },
            { sel: "Under 2.5", mp: modelOU.under, cp: closingOU.prob2, odds: closeUnder, won: totalGoals < 2.5 },
          ];
          for (const s of ouSides) {
            const clv = s.mp - s.cp;
            if (clv <= 0) continue;
            if (s.odds > maxOdds) continue;
            allBets.push({
              league: league.id, season, date: m.date,
              homeTeam: m.homeTeam, awayTeam: m.awayTeam,
              marketType: "OU25", selection: s.sel,
              modelProb: s.mp, closingImpliedProb: s.cp,
              clv, closingOdds: s.odds,
              homeGoals: m.homeGoals, awayGoals: m.awayGoals, totalGoals,
              won: s.won, profit: s.won ? s.odds - 1 : -1,
            });
            leagueBets++;
          }
        }
      }

      updateTeamHistory(m, pred);
    }
  }

  const elapsed = ((Date.now() - leagueStart) / 1000).toFixed(1);
  const skipTotal = skipped.early + skipped.variance + skipped.congestion + skipped.defiance + skipped.intlBreak;
  console.log(`  [DONE] ${league.id}: ${solveCount} solves, ${leagueBets} bets, ${elapsed}s`);
  console.log(`    skipped: early=${skipped.early} var=${skipped.variance} cong=${skipped.congestion} def=${skipped.defiance} intl=${skipped.intlBreak}`);

  // Per-league summary
  const leagueBetRecords = allBets.filter(b => b.league === league.id);
  leagueResults[league.id] = summarize(leagueBetRecords);
}

const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(0);
console.log(`\n[PROGRESS] All leagues complete. ${allBets.length} total bets in ${totalElapsed}s\n`);

if (allBets.length === 0) {
  console.log("  No bets found.");
  process.exit(0);
}

// ─── Results ────────────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  RESULTS — Multi-League Backtest (Ted Filters)");
console.log("═══════════════════════════════════════════════════════════════════════\n");

// ─── Edge thresholds ────────────────────────────────────────────────────────

const thresholds = [0.00, 0.03, 0.05, 0.07, 0.10, 0.15];
console.log("  ─── BY EDGE THRESHOLD ────────────────────────────────────────────\n");
console.log("  Threshold   Bets     CLV       ROI      Hit%    Avg Odds   Profit");
console.log("  " + "─".repeat(68));

for (const t of thresholds) {
  const f = allBets.filter(b => b.clv >= t);
  const s = summarize(f);
  if (s.n === 0) continue;
  console.log(
    `  ${(t * 100).toFixed(0).padStart(5)}%    ${String(s.n).padStart(5)}   ${fmtPct(s.clv).padStart(7)}   ${fmtPct(s.roi).padStart(7)}   ${(s.hitRate * 100).toFixed(1).padStart(5)}%   ${s.avgOdds.toFixed(2).padStart(6)}   ${s.profit >= 0 ? "+" : ""}${s.profit.toFixed(1).padStart(7)}u`
  );
}

// ─── Per-league breakdown ───────────────────────────────────────────────────

const REPORT_EDGE = 0.05;
const filtered = allBets.filter(b => b.clv >= REPORT_EDGE);
const leagueIds = LEAGUES.map(l => l.id);
const colWidth = 12;

console.log(`\n  ─── PER-LEAGUE BREAKDOWN (edge >= ${(REPORT_EDGE * 100).toFixed(0)}%) ──────────────────────\n`);
console.log("  " + "League".padEnd(14) + "Bets".padStart(6) + "CLV".padStart(colWidth) + "ROI".padStart(colWidth) + "Hit%".padStart(colWidth) + "Avg Odds".padStart(colWidth) + "Profit".padStart(colWidth));
console.log("  " + "─".repeat(14 + 6 + colWidth * 5));

for (const lid of leagueIds) {
  const lb = filtered.filter(b => b.league === lid);
  const s = summarize(lb);
  if (s.n === 0) continue;
  console.log(
    `  ${lid.toUpperCase().padEnd(14)}${String(s.n).padStart(6)}${fmtPct(s.clv).padStart(colWidth)}${fmtPct(s.roi).padStart(colWidth)}${((s.hitRate * 100).toFixed(1) + "%").padStart(colWidth)}${s.avgOdds.toFixed(2).padStart(colWidth)}${((s.profit >= 0 ? "+" : "") + s.profit.toFixed(1) + "u").padStart(colWidth)}`
  );
}

// Combined
const combinedS = summarize(filtered);
console.log("  " + "─".repeat(14 + 6 + colWidth * 5));
console.log(
  `  ${"COMBINED".padEnd(14)}${String(combinedS.n).padStart(6)}${fmtPct(combinedS.clv).padStart(colWidth)}${fmtPct(combinedS.roi).padStart(colWidth)}${((combinedS.hitRate * 100).toFixed(1) + "%").padStart(colWidth)}${combinedS.avgOdds.toFixed(2).padStart(colWidth)}${((combinedS.profit >= 0 ? "+" : "") + combinedS.profit.toFixed(1) + "u").padStart(colWidth)}`
);

// ─── Stability Matrix ───────────────────────────────────────────────────────

console.log(`\n  ─── STABILITY MATRIX (edge >= ${(REPORT_EDGE * 100).toFixed(0)}%) ─────────────────────────────\n`);
const matColWidth = 10;
console.log("  " + "".padEnd(16) + leagueIds.map(l => l.toUpperCase().padStart(matColWidth)).join("") + "OVERALL".padStart(matColWidth));
console.log("  " + "─".repeat(16 + (leagueIds.length + 1) * matColWidth));

const rows: { label: string; filter: (b: BetRecord) => boolean }[] = [
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

for (const row of rows) {
  const isClv = row.label.includes("CLV");
  const isN = row.label.includes(" n");
  let line = "  " + row.label.padEnd(16);
  for (const lid of [...leagueIds, "ALL"]) {
    const subset = lid === "ALL"
      ? filtered.filter(row.filter)
      : filtered.filter(b => b.league === lid).filter(row.filter);
    const s = summarize(subset);
    if (isN) line += String(s.n).padStart(matColWidth);
    else if (isClv) line += (s.n > 0 ? fmtPct(s.clv) : "—").padStart(matColWidth);
    else line += (s.n > 0 ? fmtPct(s.roi) : "—").padStart(matColWidth);
  }
  console.log(line);
  if (isN && row.label !== "Over n") {
    console.log("  " + "─".repeat(16 + (leagueIds.length + 1) * matColWidth));
  }
}

// ─── By Season ──────────────────────────────────────────────────────────────

const sidesNoDraw = filtered.filter(b => (b.marketType === "1X2" || b.marketType === "AH") && b.selection !== "Draw");
console.log(`\n  ─── BY SEASON (sides no draw, edge >= ${(REPORT_EDGE * 100).toFixed(0)}%) ──────────────────────\n`);
const seasons = [...new Set(filtered.map(b => b.season))].sort();
for (const season of seasons) {
  const sb = sidesNoDraw.filter(b => b.season === season);
  const s = summarize(sb);
  if (s.n < 10) continue;
  console.log(`  ${season.padEnd(12)} n=${String(s.n).padStart(4)}  CLV=${fmtPct(s.clv).padStart(7)}  ROI=${fmtPct(s.roi).padStart(7)}  hit=${(s.hitRate * 100).toFixed(1).padStart(5)}%  odds=${s.avgOdds.toFixed(2)}`);
}

// ─── Verdict ────────────────────────────────────────────────────────────────

console.log(`\n  ─── VERDICT ──────────────────────────────────────────────────────\n`);

const sidesOverall = summarize(sidesNoDraw);
const unders = summarize(filtered.filter(b => b.selection === "Under 2.5"));
const overs = summarize(filtered.filter(b => b.selection === "Over 2.5"));
const ahOnly = summarize(filtered.filter(b => b.marketType === "AH"));

const posLeaguesSides = leagueIds.filter(l => {
  const s = summarize(sidesNoDraw.filter(b => b.league === l));
  return s.n > 20 && s.clv > 0;
}).length;

console.log(`  SIDES (no draw):  CLV=${fmtPct(sidesOverall.clv)}  ROI=${fmtPct(sidesOverall.roi)}  n=${sidesOverall.n}  positive leagues: ${posLeaguesSides}/4`);
console.log(`  AH only:          CLV=${fmtPct(ahOnly.clv)}  ROI=${fmtPct(ahOnly.roi)}  n=${ahOnly.n}`);
console.log(`  UNDERS:           CLV=${fmtPct(unders.clv)}  ROI=${fmtPct(unders.roi)}  n=${unders.n}`);
console.log(`  OVERS:            CLV=${fmtPct(overs.clv)}  ROI=${fmtPct(overs.roi)}  n=${overs.n}`);

const sidesPass = sidesOverall.clv > 0 && posLeaguesSides >= 3 && sidesOverall.n >= 200;
console.log();
console.log(`  SIDES: ${sidesPass ? "PASS" : sidesOverall.clv > 0 ? "MARGINAL" : "FAIL"} — CLV ${fmtPct(sidesOverall.clv)}, ${posLeaguesSides}/4 positive leagues`);
console.log(`  Total runtime: ${totalElapsed}s\n`);

// ─── Save results ───────────────────────────────────────────────────────────

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const output = {
  generated: new Date().toISOString(),
  config: {
    testWindowStart: TEST_SEASON_START,
    resolveInterval: RESOLVE_INTERVAL_DAYS,
    embargoDays: EMBARGO_DAYS,
    reportEdge: REPORT_EDGE,
    maxOdds,
    leagues: leagueIds,
    tedFilters: {
      varianceLookback: VARIANCE_LOOKBACK,
      varianceMinGap: VARIANCE_MIN_GAP,
      defianceStreak: DEFIANCE_STREAK,
      skipEarly: SKIP_EARLY_N,
      intlBreakFilter: true,
    },
  },
  summary: {
    totalBets: allBets.length,
    filteredBets: filtered.length,
    combined: combinedS,
    sides: sidesOverall,
    ah: ahOnly,
    unders,
    overs,
    sidesPass,
  },
  perLeague: Object.fromEntries(
    leagueIds.map(lid => [lid, summarize(filtered.filter(b => b.league === lid))])
  ),
  bets: allBets.map(b => ({
    ...b,
    clv: Math.round(b.clv * 10000) / 10000,
    profit: Math.round(b.profit * 100) / 100,
  })),
};

const outPath = join(outDir, "multi-league-results.json");
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`  Results saved to data/backtest/multi-league-results.json`);
console.log();
