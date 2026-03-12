/**
 * Backtest Eval — Fast bet-strategy iteration (< 1 second)
 *
 * Reads solver snapshots from cache (produced by backtest-v2.ts),
 * runs predictions + bet evaluation with configurable filters.
 * Change filters, re-run instantly. No solver needed.
 *
 * Usage:
 *   npx tsx scripts/backtest-eval.ts                         # defaults
 *   npx tsx scripts/backtest-eval.ts --leagues=epl,serie-a
 *   npx tsx scripts/backtest-eval.ts --max-odds=2.5          # Ted-style odds cap
 *   npx tsx scripts/backtest-eval.ts --min-edge=0.07         # stricter edge filter
 *   npx tsx scripts/backtest-eval.ts --markets=ah            # AH only
 *   npx tsx scripts/backtest-eval.ts --markets=sides         # 1X2 + AH (no totals)
 *   npx tsx scripts/backtest-eval.ts --markets=unders        # Under 2.5 only
 *   npx tsx scripts/backtest-eval.ts --no-draws              # exclude draw bets
 *   npx tsx scripts/backtest-eval.ts --max-odds=2.0 --markets=ah --min-edge=0.07
 *
 * Ted Filters (bet selection from Variance Betting Playbook):
 *   --ted                          # Enable all Ted filters at once
 *   --variance-filter              # Only bet regression candidates (xG ≠ actual goals)
 *   --skip-early=N                 # Skip first N matchdays per season (default 5 with --ted)
 *   --congestion-filter            # Skip teams playing 3rd match in 8 days
 *   --defiance-filter              # Skip teams persistently defying the model
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { predictMatch } from "../lib/mi-model/predictor";
import { devigOdds1X2, devigOdds2Way } from "../lib/mi-model/data-prep";
import type { MIModelParams } from "../lib/mi-model/types";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const dataDir = join(projectRoot, "data/football-data-cache");
const cacheDir = join(projectRoot, "data", "backtest", "solver-cache");

// ─── CLI args ──────────────────────────────────────────────────────────────

function getArg(name: string): string | null {
  const a = process.argv.find(x => x.startsWith(`--${name}=`));
  return a ? a.split("=")[1] : null;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

const leagueFilter = getArg("leagues")?.split(",") ?? null;
const maxOdds = getArg("max-odds") ? parseFloat(getArg("max-odds")!) : null;
const minEdge = getArg("min-edge") ? parseFloat(getArg("min-edge")!) : 0.00;
const marketsArg = getArg("markets"); // "ah", "sides", "1x2", "unders", "overs", "totals", "all"
const noDraws = hasFlag("no-draws");
const reportEdge = getArg("report-edge") ? parseFloat(getArg("report-edge")!) : 0.05;

// ─── Ted Filters ────────────────────────────────────────────────────────────
const tedMode = hasFlag("ted");
const varianceFilter = tedMode || hasFlag("variance-filter");
const skipEarlyN = getArg("skip-early") ? parseInt(getArg("skip-early")!) : (tedMode ? 5 : 0);
const congestionFilter = tedMode || hasFlag("congestion-filter");
const defianceFilter = tedMode || hasFlag("defiance-filter");

// Variance filter config
const VARIANCE_LOOKBACK = 10;      // last N matches per team
const VARIANCE_MIN_GAP = 3.0;      // min goals gap (xG vs actual) to qualify as regression candidate
const DEFIANCE_STREAK = 8;         // if model disagrees with results for 8+ matches, skip

const LEAGUES = [
  { id: "epl", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "la-liga", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "bundesliga", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "serie-a", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "ligue-1", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
  { id: "championship", seasons: ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"] },
];

const TEST_SEASON_START = "2022";
const RESOLVE_INTERVAL_DAYS = 7;
const EMBARGO_DAYS = 3;

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

// ─── Load solver snapshots from cache ───────────────────────────────────────

function loadSnapshots(leagueId: string): Map<string, MIModelParams> {
  const map = new Map<string, MIModelParams>();
  if (!existsSync(cacheDir)) return map;
  const prefix = `${leagueId}_`;
  const files = readdirSync(cacheDir).filter(f => f.startsWith(prefix) && f.endsWith(".json"));
  for (const f of files) {
    // key format: league_date_trainCount_hash.json
    const parts = f.replace(".json", "").split("_");
    const date = parts[1]; // matchday date
    try {
      const params = JSON.parse(readFileSync(join(cacheDir, f), "utf-8")) as MIModelParams;
      map.set(date, params);
    } catch { /* skip corrupt */ }
  }
  return map;
}

// ─── Market filters ─────────────────────────────────────────────────────────

function wantMarket(type: "1X2" | "AH" | "OU25", selection: string): boolean {
  if (!marketsArg) return true;
  const m = marketsArg.toLowerCase();
  if (m === "all") return true;
  if (m === "ah") return type === "AH";
  if (m === "1x2") return type === "1X2";
  if (m === "sides") return type === "1X2" || type === "AH";
  if (m === "unders") return selection === "Under 2.5";
  if (m === "overs") return selection === "Over 2.5";
  if (m === "totals") return type === "OU25";
  return true;
}

// ─── Main ───────────────────────────────────────────────────────────────────

const startTime = Date.now();
const activeLeagues = leagueFilter
  ? LEAGUES.filter(l => leagueFilter.includes(l.id))
  : LEAGUES;

// Check what's cached
const cachedLeagues = activeLeagues.filter(l => {
  const snaps = loadSnapshots(l.id);
  return snaps.size > 0;
});

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  BACKTEST EVAL — Fast Strategy Iteration");
console.log("═══════════════════════════════════════════════════════════════════════\n");
console.log(`  Leagues: ${cachedLeagues.map(l => l.id).join(", ")} (${cachedLeagues.length} with cached solves)`);
if (maxOdds) console.log(`  Max odds cap: ${maxOdds}`);
if (minEdge > 0) console.log(`  Min edge filter: ${(minEdge * 100).toFixed(0)}%`);
if (marketsArg) console.log(`  Markets: ${marketsArg}`);
if (noDraws) console.log(`  Excluding draws`);
if (tedMode) console.log(`  TED MODE: variance + skip-early(${skipEarlyN}) + congestion + defiance`);
else {
  if (varianceFilter) console.log(`  Variance filter: ON (gap >= ${VARIANCE_MIN_GAP} goals)`);
  if (skipEarlyN > 0) console.log(`  Skip early: first ${skipEarlyN} matchdays per season`);
  if (congestionFilter) console.log(`  Congestion filter: ON`);
  if (defianceFilter) console.log(`  Defiance filter: ON (${DEFIANCE_STREAK}+ matches)`);
}
console.log();

const allBets: BetRecord[] = [];

for (const league of cachedLeagues) {
  const snapshots = loadSnapshots(league.id);
  const snapDates = [...snapshots.keys()].sort();

  // Load all matches
  let rawMatches: any[] = [];
  for (const season of league.seasons) {
    const fp = join(dataDir, `${league.id}-${season}.json`);
    if (!existsSync(fp)) continue;
    try {
      const raw = JSON.parse(readFileSync(fp, "utf-8"));
      rawMatches.push(...(raw.matches || []));
    } catch { continue; }
  }
  rawMatches.sort((a: any, b: any) => a.date.localeCompare(b.date));

  // Test matches
  const testMatches = rawMatches.filter((m: any) => m.date >= `${TEST_SEASON_START}-07-01`);
  const matchdayDates = [...new Set(testMatches.map((m: any) => m.date))].sort();

  let leagueBets = 0;
  let leagueSkipped = { variance: 0, congestion: 0, early: 0, defiance: 0 };
  let currentParams: MIModelParams | null = null;

  // ─── Ted filter: build team match history for variance + congestion ──────
  // Track per-team: last N matches with (modelExpGoals, actualGoals, date)
  interface TeamHistory {
    matches: { date: string; expectedGF: number; actualGF: number; expectedGA: number; actualGA: number }[];
    // Defiance: count how many consecutive matches where model said X but result was opposite
    defianceCount: number;
    lastDefianceDir: "over" | "under" | null;
  }
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

  // Season matchday counters for skip-early
  let currentSeason = "";
  let seasonMatchdayCount = 0;

  // Pre-populate team history from training matches (before test window)
  const trainMatches = rawMatches.filter((m: any) => m.date < `${TEST_SEASON_START}-07-01`);
  for (const m of trainMatches) {
    if (m.homeGoals == null || m.awayGoals == null) continue;
    const hh = getTeamHist(m.homeTeam);
    const ah = getTeamHist(m.awayTeam);
    // Use simple proxy: avg goals per match as "expected" for pre-test period
    // (We don't have model params for training period, so just use league avg ~1.35)
    const avgRate = 1.35;
    hh.matches.push({ date: m.date, expectedGF: avgRate, actualGF: m.homeGoals, expectedGA: avgRate, actualGA: m.awayGoals });
    ah.matches.push({ date: m.date, expectedGF: avgRate, actualGF: m.awayGoals, expectedGA: avgRate, actualGA: m.homeGoals });
    // Trim to lookback
    if (hh.matches.length > VARIANCE_LOOKBACK) hh.matches.shift();
    if (ah.matches.length > VARIANCE_LOOKBACK) ah.matches.shift();
  }

  // Helper: update team history after each match (model pred vs actual)
  function updateTeamHistory(m: any, pred: any) {
    const hh = getTeamHist(m.homeTeam);
    const ah = getTeamHist(m.awayTeam);
    hh.matches.push({
      date: m.date,
      expectedGF: pred.expectedGoals.home,
      actualGF: m.homeGoals,
      expectedGA: pred.expectedGoals.away,
      actualGA: m.awayGoals,
    });
    ah.matches.push({
      date: m.date,
      expectedGF: pred.expectedGoals.away,
      actualGF: m.awayGoals,
      expectedGA: pred.expectedGoals.home,
      actualGA: m.homeGoals,
    });
    if (hh.matches.length > VARIANCE_LOOKBACK) hh.matches.shift();
    if (ah.matches.length > VARIANCE_LOOKBACK) ah.matches.shift();

    // Update defiance tracking
    for (const [team, expG, actG] of [
      [m.homeTeam, pred.expectedGoals.home + pred.expectedGoals.away, m.homeGoals + m.awayGoals],
      [m.awayTeam, pred.expectedGoals.away + pred.expectedGoals.home, m.awayGoals + m.homeGoals],
    ] as [string, number, number][]) {
      const th = getTeamHist(team);
      const dir = actG > expG ? "over" as const : "under" as const;
      if (th.lastDefianceDir === dir) {
        th.defianceCount++;
      } else {
        th.defianceCount = 1;
        th.lastDefianceDir = dir;
      }
    }
  }

  for (const matchday of matchdayDates) {
    // Find the most recent snapshot on or before this matchday (minus embargo)
    const embargoDate = new Date(new Date(matchday).getTime() - EMBARGO_DAYS * 86400000)
      .toISOString().split("T")[0];

    // Find latest snapshot date <= embargoDate
    let bestSnap: string | null = null;
    for (const sd of snapDates) {
      if (sd <= matchday) bestSnap = sd;
      else break;
    }
    if (bestSnap) {
      currentParams = snapshots.get(bestSnap)!;
    }
    if (!currentParams) continue;

    const dayMatches = rawMatches.filter((m: any) => m.date === matchday);

    // ─── Season tracking for skip-early ───────────────────────────────────
    const matchSeason = matchday.slice(0, 4);  // "2022", "2023", etc
    // Detect season boundary (Aug = new season)
    const matchMonth = parseInt(matchday.slice(5, 7));
    const seasonKey = matchMonth >= 7 ? matchSeason : String(parseInt(matchSeason) - 1);
    if (seasonKey !== currentSeason) {
      currentSeason = seasonKey;
      seasonMatchdayCount = 0;
    }
    seasonMatchdayCount++;

    // Skip early-season matchdays
    if (skipEarlyN > 0 && seasonMatchdayCount <= skipEarlyN) {
      leagueSkipped.early += dayMatches.filter((m: any) => m.homeGoals != null).length;
      // Still update team history even for skipped matchdays
      for (const m of dayMatches) {
        if (m.homeGoals == null || m.awayGoals == null) continue;
        if (!currentParams.teams[m.homeTeam] || !currentParams.teams[m.awayTeam]) continue;
        let pred;
        try { pred = predictMatch(currentParams, m.homeTeam, m.awayTeam); } catch { continue; }
        updateTeamHistory(m, pred);
      }
      continue;
    }

    for (const m of dayMatches) {
      if (m.homeGoals == null || m.awayGoals == null) continue;
      if (!currentParams.teams[m.homeTeam] || !currentParams.teams[m.awayTeam]) continue;

      let pred;
      try { pred = predictMatch(currentParams, m.homeTeam, m.awayTeam); }
      catch { continue; }

      const totalGoals = m.homeGoals + m.awayGoals;
      const season = m.season || "unknown";

      // ─── Congestion filter: skip if either team plays 3rd match in 8 days ─
      if (congestionFilter) {
        const isCongested = (team: string) => {
          const dates = teamMatchDates[team] || [];
          const idx = dates.indexOf(matchday);
          if (idx < 2) return false;
          const d8ago = new Date(new Date(matchday).getTime() - 8 * 86400000).toISOString().split("T")[0];
          let count = 0;
          for (let i = idx - 1; i >= 0 && dates[i] >= d8ago; i--) count++;
          return count >= 2; // 2 prior matches + this one = 3 in 8 days
        };
        if (isCongested(m.homeTeam) || isCongested(m.awayTeam)) {
          leagueSkipped.congestion++;
          updateTeamHistory(m, pred);
          continue;
        }
      }

      // ─── Variance filter: only bet on regression candidates ─────────────
      let passVariance = true;
      if (varianceFilter) {
        const isRegressionCandidate = (team: string): boolean => {
          const hist = getTeamHist(team);
          if (hist.matches.length < VARIANCE_LOOKBACK) return false;
          const recent = hist.matches.slice(-VARIANCE_LOOKBACK);
          // Defensive regression: conceding >> xGA (most reliable per Ted)
          const gaGap = recent.reduce((s, m) => s + (m.actualGA - m.expectedGA), 0);
          // Offensive regression: scoring >> xGF
          const gfGap = recent.reduce((s, m) => s + (m.actualGF - m.expectedGF), 0);
          // Either direction counts — abs gap >= threshold
          return Math.abs(gaGap) >= VARIANCE_MIN_GAP || Math.abs(gfGap) >= VARIANCE_MIN_GAP;
        };
        passVariance = isRegressionCandidate(m.homeTeam) || isRegressionCandidate(m.awayTeam);
        if (!passVariance) {
          leagueSkipped.variance++;
          updateTeamHistory(m, pred);
          continue;
        }
      }

      // ─── Defiance filter: skip teams persistently defying model ─────────
      if (defianceFilter) {
        const isDefiant = (team: string): boolean => {
          const hist = getTeamHist(team);
          return hist.defianceCount >= DEFIANCE_STREAK;
        };
        if (isDefiant(m.homeTeam) || isDefiant(m.awayTeam)) {
          leagueSkipped.defiance++;
          updateTeamHistory(m, pred);
          continue;
        }
      }

      // ─── 1X2 ──────────────────────────────────────────────────────────
      if (m.pinnacleCloseHome && m.pinnacleCloseDraw && m.pinnacleCloseAway) {
        const closingMkt = devigOdds1X2(m.pinnacleCloseHome, m.pinnacleCloseDraw, m.pinnacleCloseAway);
        if (closingMkt) {
          const sides = [
            { sel: "Home", mp: pred.probs1X2.home, cp: closingMkt.home, odds: m.pinnacleCloseHome, won: m.homeGoals > m.awayGoals },
            { sel: "Away", mp: pred.probs1X2.away, cp: closingMkt.away, odds: m.pinnacleCloseAway, won: m.awayGoals > m.homeGoals },
            { sel: "Draw", mp: pred.probs1X2.draw, cp: closingMkt.draw, odds: m.pinnacleCloseDraw, won: m.homeGoals === m.awayGoals },
          ];
          for (const s of sides) {
            if (noDraws && s.sel === "Draw") continue;
            if (!wantMarket("1X2", s.sel)) continue;
            const clv = s.mp - s.cp;
            if (clv <= minEdge) continue;
            if (maxOdds && s.odds > maxOdds) continue;
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

      // ─── AH ───────────────────────────────────────────────────────────
      const ahLine = m.ahCloseLine ?? m.ahLine;
      const ahHome = m.pinnacleCloseAHHome ?? m.pinnacleAHHome;
      const ahAway = m.pinnacleCloseAHAway ?? m.pinnacleAHAway;
      if (ahLine != null && ahHome && ahAway && wantMarket("AH", "")) {
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
            if (clv <= minEdge) continue;
            if (maxOdds && s.odds > maxOdds) continue;
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

      // ─── O/U 2.5 ─────────────────────────────────────────────────────
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
            if (!wantMarket("OU25", s.sel)) continue;
            const clv = s.mp - s.cp;
            if (clv <= minEdge) continue;
            if (maxOdds && s.odds > maxOdds) continue;
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

      // Update team history with this match's model predictions vs actuals
      updateTeamHistory(m, pred);
    }
  }

  const skipTotal = leagueSkipped.early + leagueSkipped.variance + leagueSkipped.congestion + leagueSkipped.defiance;
  const skipStr = skipTotal > 0
    ? ` [skipped: early=${leagueSkipped.early} var=${leagueSkipped.variance} cong=${leagueSkipped.congestion} def=${leagueSkipped.defiance}]`
    : "";
  console.log(`  ${league.id.toUpperCase()}: ${leagueBets} bets (${snapDates.length} snapshots)${skipStr}`);
}

const elapsed = Date.now() - startTime;
console.log(`\n  Total: ${allBets.length} bets in ${elapsed}ms\n`);

if (allBets.length === 0) {
  console.log("  No bets match filters.");
  process.exit(0);
}

// ─── Reporting ──────────────────────────────────────────────────────────────

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

// ─── Stability Matrix ───────────────────────────────────────────────────────

const filtered = allBets.filter(b => b.clv >= reportEdge);
const leagueIds = cachedLeagues.map(l => l.id);
const colWidth = 10;

console.log(`\n  ─── STABILITY MATRIX (edge >= ${(reportEdge * 100).toFixed(0)}%) ─────────────────────────────\n`);
console.log("  " + "".padEnd(16) + leagueIds.map(l => l.toUpperCase().padStart(colWidth)).join("") + "OVERALL".padStart(colWidth));
console.log("  " + "─".repeat(16 + (leagueIds.length + 1) * colWidth));

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
    if (isN) line += String(s.n).padStart(colWidth);
    else if (isClv) line += (s.n > 0 ? fmtPct(s.clv) : "—").padStart(colWidth);
    else line += (s.n > 0 ? fmtPct(s.roi) : "—").padStart(colWidth);
  }
  console.log(line);
  if (isN && row.label !== "Over n") {
    console.log("  " + "─".repeat(16 + (leagueIds.length + 1) * colWidth));
  }
}

// ─── By Season ──────────────────────────────────────────────────────────────

const sidesNoDraw = filtered.filter(b => (b.marketType === "1X2" || b.marketType === "AH") && b.selection !== "Draw");
console.log(`\n  ─── BY SEASON (sides no draw, edge >= ${(reportEdge * 100).toFixed(0)}%) ──────────────────────\n`);
const seasons = [...new Set(filtered.map(b => b.season))].sort();
for (const season of seasons) {
  const sb = sidesNoDraw.filter(b => b.season === season);
  const s = summarize(sb);
  if (s.n < 10) continue;
  console.log(`  ${season.padEnd(12)} n=${String(s.n).padStart(4)}  CLV=${fmtPct(s.clv).padStart(7)}  ROI=${fmtPct(s.roi).padStart(7)}  hit=${(s.hitRate * 100).toFixed(1).padStart(5)}%  odds=${s.avgOdds.toFixed(2)}`);
}

// ─── Odds distribution ──────────────────────────────────────────────────────

console.log(`\n  ─── BY ODDS BUCKET (all bets, edge >= ${(reportEdge * 100).toFixed(0)}%) ──────────────────────\n`);
const oddsBuckets = [
  { label: "1.00-1.50", min: 1.0, max: 1.5 },
  { label: "1.50-2.00", min: 1.5, max: 2.0 },
  { label: "2.00-2.50", min: 2.0, max: 2.5 },
  { label: "2.50-3.00", min: 2.5, max: 3.0 },
  { label: "3.00-4.00", min: 3.0, max: 4.0 },
  { label: "4.00+     ", min: 4.0, max: 99 },
];

console.log("  Odds range    Bets     CLV       ROI      Hit%   Profit");
console.log("  " + "─".repeat(58));
for (const b of oddsBuckets) {
  const f = filtered.filter(x => x.closingOdds >= b.min && x.closingOdds < b.max);
  const s = summarize(f);
  if (s.n === 0) continue;
  console.log(
    `  ${b.label}   ${String(s.n).padStart(5)}   ${fmtPct(s.clv).padStart(7)}   ${fmtPct(s.roi).padStart(7)}   ${(s.hitRate * 100).toFixed(1).padStart(5)}%   ${s.profit >= 0 ? "+" : ""}${s.profit.toFixed(1).padStart(7)}u`
  );
}

// ─── Summary ────────────────────────────────────────────────────────────────

const overall = summarize(filtered);
console.log(`\n  ─── SUMMARY ──────────────────────────────────────────────────────\n`);
console.log(`  ${filtered.length} bets @ edge >= ${(reportEdge * 100).toFixed(0)}%`);
console.log(`  CLV: ${fmtPct(overall.clv)}   ROI: ${fmtPct(overall.roi)}   Hit: ${(overall.hitRate * 100).toFixed(1)}%   Avg odds: ${overall.avgOdds.toFixed(2)}   P&L: ${overall.profit >= 0 ? "+" : ""}${overall.profit.toFixed(1)}u`);
console.log(`  Runtime: ${elapsed}ms\n`);

// ─── Pass Rate Table (per league+market win rates for Ted filter) ──────────

if (tedMode || hasFlag("pass-rates")) {
  // Normalize selection to direction: Home/Away/Draw/Over/Under
  function selectionDir(sel: string): string {
    if (sel.startsWith("Home")) return "Home";
    if (sel.startsWith("Away")) return "Away";
    if (sel === "Draw") return "Draw";
    if (sel === "Over 2.5") return "Over";
    if (sel === "Under 2.5") return "Under";
    return sel;
  }

  // Build per-(league, marketType, direction) hit rates
  const passRateTable: Record<string, { n: number; wins: number; hitRate: number; roi: number; clv: number }> = {};

  for (const b of allBets) {
    if (b.clv < minEdge) continue; // only count bets that pass edge filter
    const dir = selectionDir(b.selection);
    const key = `${b.league}|${b.marketType}|${dir}`;
    if (!passRateTable[key]) passRateTable[key] = { n: 0, wins: 0, hitRate: 0, roi: 0, clv: 0 };
    const entry = passRateTable[key];
    entry.n++;
    if (b.won) entry.wins++;
    entry.roi += b.profit;
    entry.clv += b.clv;
  }

  // Compute final rates
  for (const entry of Object.values(passRateTable)) {
    entry.hitRate = entry.n > 0 ? entry.wins / entry.n : 0;
    entry.roi = entry.n > 0 ? entry.roi / entry.n : 0;
    entry.clv = entry.n > 0 ? entry.clv / entry.n : 0;
  }

  console.log(`\n  ─── PASS RATE TABLE (per league|market|direction) ─────────────────\n`);
  console.log("  League       Market  Dir      N    Hit%     ROI      CLV    Pass?");
  console.log("  " + "─".repeat(70));

  const PASS_THRESHOLD = 0.50; // 50% hit rate minimum (configurable)
  const sortedKeys = Object.keys(passRateTable).sort();
  for (const key of sortedKeys) {
    const entry = passRateTable[key];
    if (entry.n < 10) continue; // skip small samples
    const [league, market, dir] = key.split("|");
    const pass = entry.hitRate >= PASS_THRESHOLD;
    console.log(
      `  ${league.padEnd(12)} ${market.padEnd(5)}   ${dir.padEnd(6)} ${String(entry.n).padStart(4)}   ${(entry.hitRate * 100).toFixed(1).padStart(5)}%   ${fmtPct(entry.roi).padStart(7)}   ${fmtPct(entry.clv).padStart(7)}   ${pass ? "PASS" : "FAIL"}`
    );
  }

  // Save pass rate lookup JSON for the picks engine
  const { writeFileSync: writeFs, mkdirSync: mkFs } = require("fs") as typeof import("fs");
  const passRatesDir = join(projectRoot, "data", "backtest");
  if (!existsSync(passRatesDir)) mkFs(passRatesDir, { recursive: true });

  const lookup: Record<string, { n: number; hitRate: number; roi: number; clv: number }> = {};
  for (const [key, entry] of Object.entries(passRateTable)) {
    if (entry.n >= 10) {
      lookup[key] = { n: entry.n, hitRate: entry.hitRate, roi: entry.roi, clv: entry.clv };
    }
  }
  const outPath = join(passRatesDir, "pass-rates.json");
  writeFs(outPath, JSON.stringify(lookup, null, 2));
  console.log(`\n  Saved pass rate lookup → ${outPath} (${Object.keys(lookup).length} entries)\n`);
}
