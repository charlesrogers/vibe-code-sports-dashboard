/**
 * OUR BETS — Ted-style presentation
 * Shows AH lines (+0.5, -0.75), O/U lines, and edges vs Pinnacle
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";

const envPath = join(import.meta.dirname || __dirname, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

import { prepareMarketMatches, devigOdds1X2, devigOdds2Way } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import { computeAllPPG } from "../lib/mi-model/ppg-converter";
import { predictMatch } from "../lib/mi-model/predictor";
import { generateScoreGrid, derive1X2, deriveOverUnder, deriveBTTS, deriveAsianHandicap, expectedGoalsFromGrid, mostLikelyScore } from "../lib/mi-model/bivariate-poisson";
import type { MISolverConfig, MatchPrediction } from "../lib/mi-model/types";

const projectRoot = join(import.meta.dirname || __dirname, "..");

// ─── Load live odds ──────────────────────────────────────────────────────────

function loadLiveOdds(league: string): any[] {
  const dir = join(projectRoot, "data", "live-odds");
  const today = new Date().toISOString().split("T")[0];
  const path = join(dir, `${league}-live-${today}.json`);
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, "utf-8"));
}

// ─── Solve all league models ─────────────────────────────────────────────────

const dataDir = join(projectRoot, "data/football-data-cache");
const baseConfig: MISolverConfig = {
  maxIterations: 200, convergenceThreshold: 1e-6,
  attackRange: [0.3, 3.0], defenseRange: [0.3, 3.0],
  homeAdvantageRange: [0.8, 1.8], lambda3Range: [-0.15, 0.05],
  avgGoalRateRange: [1.0, 1.8], gridSteps: 30,
  decayRate: 0.005, regularization: 0.001,
  klWeight: 1.0, ahWeight: 0.3, printEvery: 999,
  driftFactor: 0,
};

function solveLeague(files: string[], leagueId: string, drift = 0) {
  let all: any[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(dataDir, f), "utf-8"));
      all.push(...prepareMarketMatches(raw, { useClosing: true, requirePinnacle: true }));
    } catch {}
  }
  if (all.length === 0) return null;
  const params = solveRatings(all, leagueId, "2024-25", { ...baseConfig, driftFactor: drift });
  computeAllPPG(params);
  return params;
}

console.log("[PROGRESS] Solving league models...");
const models: Record<string, any> = {};
models["epl"] = solveLeague(["epl-2024-25.json"], "epl");
models["la-liga"] = solveLeague(["la-liga-2024-25.json"], "la-liga");
models["bundesliga"] = solveLeague(["bundesliga-2024-25.json"], "bundesliga");
models["ligue-1"] = solveLeague(["ligue-1-2024-25.json"], "ligue-1");
models["serie-a"] = solveLeague(["serie-a-2024-25.json"], "serie-a");
models["championship"] = solveLeague(["championship-2023-24.json", "championship-2024-25.json"], "championship", 0.1);

// ─── Team name maps ──────────────────────────────────────────────────────────

const UCL_MAP: Record<string, { league: string; fd: string }> = {
  "Galatasaray": { league: "", fd: "" },
  "Liverpool": { league: "epl", fd: "Liverpool" },
  "Atalanta": { league: "serie-a", fd: "Atalanta" },
  "Bayern Munich": { league: "bundesliga", fd: "Bayern Munich" },
  "Atlético Madrid": { league: "la-liga", fd: "Atletico Madrid" },
  "Tottenham": { league: "epl", fd: "Tottenham" },
  "Tottenham Hotspur": { league: "epl", fd: "Tottenham" },
  "Newcastle": { league: "epl", fd: "Newcastle" },
  "Newcastle United": { league: "epl", fd: "Newcastle" },
  "Barcelona": { league: "la-liga", fd: "Barcelona" },
  "Bayer Leverkusen": { league: "bundesliga", fd: "Bayer Leverkusen" },
  "Arsenal": { league: "epl", fd: "Arsenal" },
  "Bodø/Glimt": { league: "", fd: "" },
  "Sporting Lisbon": { league: "", fd: "" },
  "Paris Saint Germain": { league: "ligue-1", fd: "Paris Saint-Germain" },
  "Chelsea": { league: "epl", fd: "Chelsea" },
  "Real Madrid": { league: "la-liga", fd: "Real Madrid" },
  "Manchester City": { league: "epl", fd: "Manchester City" },
};

const CHAMP_MAP: Record<string, string> = {
  "Ipswich": "Ipswich", "Ipswich Town": "Ipswich",
  "Coventry City": "Coventry", "Coventry": "Coventry",
  "Middlesbrough": "Middlesbrough", "Birmingham City": "Birmingham", "Birmingham": "Birmingham",
  "Southampton": "Southampton", "Sheffield Utd": "Sheffield Utd", "Sheffield United": "Sheffield Utd",
  "Millwall": "Millwall", "Watford": "Watford",
  "West Bromwich Albion": "West Brom", "West Brom": "West Brom",
  "Blackburn Rovers": "Blackburn", "Blackburn": "Blackburn",
  "Derby County": "Derby", "Derby": "Derby",
  "Queens Park Rangers": "QPR", "QPR": "QPR",
  "Portsmouth": "Portsmouth", "Bristol City": "Bristol City",
  "Wrexham AFC": "Wrexham", "Wrexham": "Wrexham",
  "Norwich City": "Norwich", "Norwich": "Norwich",
  "Stoke City": "Stoke", "Stoke": "Stoke",
  "Leicester City": "Leicester", "Leicester": "Leicester",
  "Hull City": "Hull", "Hull": "Hull",
  "Preston North End": "Preston", "Preston": "Preston",
  "Oxford United": "Oxford", "Oxford": "Oxford",
  "Sheffield Wednesday": "Sheffield Wed", "Sheffield Wed": "Sheffield Wed",
  "Charlton Athletic": "Charlton", "Charlton": "Charlton",
  "Luton Town": "Luton", "Luton": "Luton",
  "Swansea City": "Swansea", "Swansea": "Swansea",
};

// ─── Find best bets in Ted format ────────────────────────────────────────────

interface TedBet {
  match: string;
  date: string;
  selection: string;    // "Atalanta +0.5" or "Over 2.5"
  modelProb: number;
  marketProb: number;
  edge: number;
  pinnacleOdds: number;
  fairOdds: number;
  signal: string;
}

function findBestAHLine(
  pred: MatchPrediction,
  snap: any,
  minEdge: number = 0.03
): TedBet[] {
  const bets: TedBet[] = [];
  const homeTeam = snap.homeTeam;
  const awayTeam = snap.awayTeam;
  const date = new Date(snap.commenceTime).toLocaleDateString("en-GB", { day: "numeric", month: "short" });

  // Collect Pinnacle spread lines from bookmakers
  const pinnacle = snap.bookmakers.find((b: any) => b.bookmakerKey === "pinnacle");

  // 1X2 check
  if (snap.pinnacleHome && snap.pinnacleDraw && snap.pinnacleAway) {
    const market = devigOdds1X2(snap.pinnacleHome, snap.pinnacleDraw, snap.pinnacleAway);
    if (market) {
      // Home 1X2
      if (pred.probs1X2.home - market.home >= minEdge) {
        bets.push({
          match: `${homeTeam} v ${awayTeam}`,
          date,
          selection: `${homeTeam} ML`,
          modelProb: pred.probs1X2.home,
          marketProb: market.home,
          edge: pred.probs1X2.home - market.home,
          pinnacleOdds: snap.pinnacleHome,
          fairOdds: 1 / pred.probs1X2.home,
          signal: "model_only",
        });
      }
      // Away 1X2
      if (pred.probs1X2.away - market.away >= minEdge) {
        bets.push({
          match: `${homeTeam} v ${awayTeam}`,
          date,
          selection: `${awayTeam} ML`,
          modelProb: pred.probs1X2.away,
          marketProb: market.away,
          edge: pred.probs1X2.away - market.away,
          pinnacleOdds: snap.pinnacleAway,
          fairOdds: 1 / pred.probs1X2.away,
          signal: "model_only",
        });
      }
      // Draw
      if (pred.probs1X2.draw - market.draw >= minEdge) {
        bets.push({
          match: `${homeTeam} v ${awayTeam}`,
          date,
          selection: `Draw`,
          modelProb: pred.probs1X2.draw,
          marketProb: market.draw,
          edge: pred.probs1X2.draw - market.draw,
          pinnacleOdds: snap.pinnacleDraw,
          fairOdds: 1 / pred.probs1X2.draw,
          signal: "model_only",
        });
      }
    }
  }

  // AH lines from Pinnacle
  if (pinnacle?.spreadLine != null && pinnacle?.spreadHome && pinnacle?.spreadAway) {
    const line = pinnacle.spreadLine;
    const ahKey = String(line);
    const modelAH = pred.asianHandicap[ahKey];
    if (modelAH) {
      const marketAH = devigOdds2Way(pinnacle.spreadHome, pinnacle.spreadAway);
      if (marketAH) {
        // Home AH
        const homeEdge = modelAH.home - marketAH.prob1;
        if (homeEdge >= minEdge) {
          const lineStr = line >= 0 ? `+${line}` : `${line}`;
          bets.push({
            match: `${homeTeam} v ${awayTeam}`,
            date,
            selection: `${homeTeam} ${lineStr}`,
            modelProb: modelAH.home,
            marketProb: marketAH.prob1,
            edge: homeEdge,
            pinnacleOdds: pinnacle.spreadHome,
            fairOdds: 1 / modelAH.home,
            signal: "model_only",
          });
        }
        // Away AH
        const awayEdge = modelAH.away - marketAH.prob2;
        if (awayEdge >= minEdge) {
          const lineStr = -line >= 0 ? `+${-line}` : `${-line}`;
          bets.push({
            match: `${homeTeam} v ${awayTeam}`,
            date,
            selection: `${awayTeam} ${lineStr}`,
            modelProb: modelAH.away,
            marketProb: marketAH.prob2,
            edge: awayEdge,
            pinnacleOdds: pinnacle.spreadAway,
            fairOdds: 1 / modelAH.away,
            signal: "model_only",
          });
        }
      }
    }
  }

  // Also check all bookmaker spread lines for best AH value
  for (const bk of snap.bookmakers) {
    if (bk.bookmakerKey === "pinnacle") continue; // already checked
    if (!bk.spreadLine || !bk.spreadHome || !bk.spreadAway) continue;

    const line = bk.spreadLine;
    const ahKey = String(line);
    const modelAH = pred.asianHandicap[ahKey];
    if (!modelAH) continue;

    const marketAH = devigOdds2Way(bk.spreadHome, bk.spreadAway);
    if (!marketAH) continue;

    // Only add if it's a different line than Pinnacle already covered
    const alreadyHasLine = bets.some(b => b.selection.includes(`${line >= 0 ? '+' + line : line}`));
    if (alreadyHasLine) continue;

    const homeEdge = modelAH.home - marketAH.prob1;
    if (homeEdge >= minEdge) {
      const lineStr = line >= 0 ? `+${line}` : `${line}`;
      bets.push({
        match: `${homeTeam} v ${awayTeam}`,
        date,
        selection: `${homeTeam} ${lineStr}`,
        modelProb: modelAH.home,
        marketProb: marketAH.prob1,
        edge: homeEdge,
        pinnacleOdds: bk.spreadHome,
        fairOdds: 1 / modelAH.home,
        signal: "model_only",
      });
    }
  }

  // O/U 2.5
  if (pinnacle?.overOdds && pinnacle?.underOdds) {
    const ou = pred.overUnder["2.5"];
    if (ou) {
      const marketOU = devigOdds2Way(pinnacle.overOdds, pinnacle.underOdds);
      if (marketOU) {
        if (ou.over - marketOU.prob1 >= minEdge) {
          bets.push({
            match: `${homeTeam} v ${awayTeam}`,
            date,
            selection: `Over 2.5`,
            modelProb: ou.over,
            marketProb: marketOU.prob1,
            edge: ou.over - marketOU.prob1,
            pinnacleOdds: pinnacle.overOdds,
            fairOdds: 1 / ou.over,
            signal: "model_only",
          });
        }
        if (ou.under - marketOU.prob2 >= minEdge) {
          bets.push({
            match: `${homeTeam} v ${awayTeam}`,
            date,
            selection: `Under 2.5`,
            modelProb: ou.under,
            marketProb: marketOU.prob2,
            edge: ou.under - marketOU.prob2,
            pinnacleOdds: pinnacle.underOdds,
            fairOdds: 1 / ou.under,
            signal: "model_only",
          });
        }
      }
    }
  }

  // Sort by edge
  bets.sort((a, b) => b.edge - a.edge);
  return bets;
}

// ─── Cross-league prediction (UCL) ──────────────────────────────────────────

function predictCrossLeague(homeTeam: string, awayTeam: string): MatchPrediction | null {
  const hi = UCL_MAP[homeTeam];
  const ai = UCL_MAP[awayTeam];
  if (!hi?.league || !ai?.league) return null;

  const hm = models[hi.league];
  const am = models[ai.league];
  if (!hm?.teams?.[hi.fd] || !am?.teams?.[ai.fd]) return null;

  const hr = hm.teams[hi.fd];
  const ar = am.teams[ai.fd];
  const avgHA = (hm.homeAdvantage + am.homeAdvantage) / 2;
  const avgGR = (hm.avgGoalRate + am.avgGoalRate) / 2;
  const avgL3 = (hm.correlation + am.correlation) / 2;

  const lambdaHome = hr.attack * ar.defense * avgHA * avgGR;
  const lambdaAway = ar.attack * hr.defense * avgGR;
  const grid = generateScoreGrid(lambdaHome, lambdaAway, avgL3);

  return {
    homeTeam, awayTeam,
    lambdaHome, lambdaAway, lambda3: avgL3, scoreGrid: grid,
    probs1X2: derive1X2(grid),
    overUnder: deriveOverUnder(grid, [0.5, 1.5, 2.5, 3.5, 4.5]),
    btts: deriveBTTS(grid),
    asianHandicap: deriveAsianHandicap(grid, [-2.5, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5, 2.5]),
    expectedGoals: { home: lambdaHome, away: lambdaAway, total: lambdaHome + lambdaAway },
    mostLikelyScore: mostLikelyScore(grid),
  };
}

// ─── Main output ─────────────────────────────────────────────────────────────

console.log("\n");
console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  OUR BETS — " + new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }));
console.log("  MI Bivariate Poisson + Variance Model");
console.log("═══════════════════════════════════════════════════════════════════════");

// ─── Conservative filters (learned from 2-season backtest) ───────────────────
const MIN_EDGE = 0.05;      // was 0.03 — fewer but higher-conviction bets
const MAX_ODDS = 2.80;      // kills longshot bleeding (backtest avg was 3.39)
const EXCLUDE_DRAWS = true;  // 24% hit rate in backtest — almost always -EV

const allBets: TedBet[] = [];

// UCL
console.log("\n  ─── CHAMPIONS LEAGUE R16 ──────────────────────────────────────────\n");

const uclOdds = loadLiveOdds("ucl");
for (const snap of uclOdds) {
  const pred = predictCrossLeague(snap.homeTeam, snap.awayTeam);
  if (!pred) {
    console.log(`  ${snap.homeTeam} v ${snap.awayTeam} — no model data`);
    continue;
  }
  const bets = findBestAHLine(pred, snap, MIN_EDGE);
  allBets.push(...bets);
}

// Championship
console.log("\n  ─── CHAMPIONSHIP ─────────────────────────────────────────────────\n");

const champOdds = loadLiveOdds("championship");
const champModel = models["championship"];
for (const snap of champOdds) {
  const homeFD = CHAMP_MAP[snap.homeTeam] ?? snap.homeTeam;
  const awayFD = CHAMP_MAP[snap.awayTeam] ?? snap.awayTeam;

  let pred: MatchPrediction | null = null;
  try {
    pred = predictMatch(champModel, homeFD, awayFD);
  } catch { continue; }

  if (!pred) continue;
  // Remap team names back to display names
  pred = { ...pred, homeTeam: snap.homeTeam, awayTeam: snap.awayTeam };

  const bets = findBestAHLine(pred, snap, MIN_EDGE);
  allBets.push(...bets);
}

// ─── Apply conservative filters ──────────────────────────────────────────────

let filtered = allBets;

// Filter out draws
if (EXCLUDE_DRAWS) {
  filtered = filtered.filter(b => !b.selection.includes("Draw"));
}

// Cap maximum odds
filtered = filtered.filter(b => b.pinnacleOdds <= MAX_ODDS);

// Group by match, pick best per match (prefer AH/OU over ML)
const byMatch = new Map<string, TedBet[]>();
for (const b of filtered) {
  const key = b.match;
  if (!byMatch.has(key)) byMatch.set(key, []);
  byMatch.get(key)!.push(b);
}

const bestPerMatch: TedBet[] = [];
for (const [match, bets] of byMatch) {
  const ahBets = bets.filter(b => !b.selection.includes("ML") && !b.selection.includes("Draw"));
  const best = ahBets.length > 0 ? ahBets[0] : bets[0];
  bestPerMatch.push(best);
}

bestPerMatch.sort((a, b) => b.edge - a.edge);

// ─── Print results ───────────────────────────────────────────────────────────

if (bestPerMatch.length === 0) {
  console.log("  No bets found.");
} else {
  // Tag bets with variance signal if available
  let betNum = 0;
  for (const b of bestPerMatch) {
    betNum++;
    const edgePct = (b.edge * 100).toFixed(1);
    const pinnStr = b.pinnacleOdds.toFixed(2);
    const fairStr = b.fairOdds.toFixed(2);
    console.log(`  ${String(betNum).padStart(2)}. ${b.match.padEnd(38)} ${b.selection.padEnd(28)} +${edgePct.padStart(5)}%  @ ${pinnStr}  (fair ${fairStr})  [${b.signal}]`);
  }
  console.log();
}

console.log(`  ─────────────────────────────────────────────────────────────────`);
console.log(`  Filters: min edge ${(MIN_EDGE * 100).toFixed(0)}%, max odds ${MAX_ODDS}, no draws`);
console.log(`  Total: ${bestPerMatch.length} bets across ${new Set(bestPerMatch.map(b => b.match)).size} matches`);
if (bestPerMatch.length > 0) {
  console.log(`  Min edge: ${(Math.min(...bestPerMatch.map(b => b.edge)) * 100).toFixed(1)}%`);
  console.log(`  Max edge: ${(Math.max(...bestPerMatch.map(b => b.edge)) * 100).toFixed(1)}%`);
  console.log(`  Avg edge: ${(bestPerMatch.reduce((s, b) => s + b.edge, 0) / bestPerMatch.length * 100).toFixed(1)}%`);
  console.log(`  Avg odds: ${(bestPerMatch.reduce((s, b) => s + b.pinnacleOdds, 0) / bestPerMatch.length).toFixed(2)}`);
}
console.log();

// ─── Save bet log ────────────────────────────────────────────────────────────

const betLogDir = join(projectRoot, "data", "bet-log");
if (!existsSync(betLogDir)) mkdirSync(betLogDir, { recursive: true });

const today = new Date().toISOString().split("T")[0];
const betLog = {
  date: today,
  model: "MI Bivariate Poisson + Variance v2",
  generated: new Date().toISOString(),
  filters: { minEdge: MIN_EDGE, maxOdds: MAX_ODDS, excludeDraws: EXCLUDE_DRAWS },
  bets: bestPerMatch.map(b => ({
    match: b.match,
    league: b.match.includes("v") ? "auto" : "unknown",
    date: b.date,
    selection: b.selection,
    edge: Math.round(b.edge * 1000) / 1000,
    pinnacleOdds: b.pinnacleOdds,
    fairOdds: Math.round(b.fairOdds * 100) / 100,
    signal: b.signal,
  })),
};

// Determine league from the odds data
for (const bet of betLog.bets) {
  const isUCL = uclOdds.some(s => bet.match === `${s.homeTeam} v ${s.awayTeam}`);
  bet.league = isUCL ? "ucl" : "championship";
}

const betLogPath = join(betLogDir, `${today}.json`);
writeFileSync(betLogPath, JSON.stringify(betLog, null, 2));
console.log(`  Bet log saved to data/bet-log/${today}.json`);
console.log();
