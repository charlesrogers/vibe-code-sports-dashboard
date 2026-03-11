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
import type { MISolverConfig, MatchPrediction, MarketMode } from "../lib/mi-model/types";
import { calculateTeamVariance, assessTotalsThesis } from "../lib/variance/calculator";
import type { TeamVariance, TotalsThesis } from "../lib/variance/calculator";
import { assessMatch } from "../lib/variance/match-assessor";
import type { TeamXg } from "../lib/types";

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
  klWeight: 0.6, ahWeight: 0.2,
  outcomeWeight: 0.3,    // NEW: actual results signal
  xgWeight: 0.2,         // NEW: xG signal (SoT proxy for Championship)
  recentFormBoost: 1.5,  // NEW: 50% weight boost for last 10 matches
  printEvery: 999,
  driftFactor: 0,
};

// ─── Cross-league strength factors (Fix #3) ──────────────────────────────────
// Based on UEFA coefficient + historical European performance
// EPL = 1.0 baseline. Others scaled relative to EPL.
const LEAGUE_STRENGTH: Record<string, number> = {
  "epl": 1.00,
  "la-liga": 0.98,
  "bundesliga": 0.92,
  "serie-a": 0.95,
  "ligue-1": 0.82,      // Significantly weaker — PSG inflated domestically
  "championship": 0.70,  // Second tier
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
  params.leagueStrength = LEAGUE_STRENGTH[leagueId] ?? 0.90;
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

// ─── Load xG data for variance (Phase 3) ────────────────────────────────────

const SOT_TO_XG = 0.32;  // shots-on-target to xG conversion factor

/** Aggregate Understat per-match xG into TeamXg for a league */
function loadUnderstatTeamXg(league: string): Map<string, TeamXg> {
  const UNDERSTAT_MAP: Record<string, string> = {
    epl: "premierLeague", "la-liga": "laLiga", bundesliga: "bundesliga",
    "serie-a": "serieA", "ligue-1": "ligue1",
  };
  const uLeague = UNDERSTAT_MAP[league];
  if (!uLeague) return new Map();

  const map = new Map<string, TeamXg>();
  for (const year of [2024, 2025]) {
    const fp = join(projectRoot, "data/understat-cache", `${uLeague}-${year}.json`);
    if (!existsSync(fp)) continue;
    try {
      const raw = JSON.parse(readFileSync(fp, "utf-8"));

      // Two formats: rawHistory (EPL) or teams dict (other leagues)
      let teamEntries: { name: string; matches: any[] }[] = [];

      if (raw.rawHistory?.length) {
        // EPL format: rawHistory[].team, rawHistory[].matches[]
        teamEntries = raw.rawHistory.map((t: any) => ({ name: t.team, matches: t.matches ?? [] }));
      } else if (raw.teams && typeof raw.teams === "object") {
        // Other leagues: teams[id].title, teams[id].history[]
        for (const id of Object.keys(raw.teams)) {
          const t = raw.teams[id];
          teamEntries.push({ name: t.title, matches: t.history ?? [] });
        }
      }

      for (const { name, matches } of teamEntries) {
        let xGFor = 0, xGAgainst = 0, goalsFor = 0, goalsAgainst = 0;
        for (const m of matches) {
          xGFor += m.xG ?? 0;
          xGAgainst += m.xGA ?? 0;
          goalsFor += m.scored ?? 0;
          goalsAgainst += m.missed ?? 0;
        }
        map.set(name, {
          team: name, xGFor, xGAgainst, goalsFor, goalsAgainst,
          xGDiff: xGFor - xGAgainst,
          overperformance: goalsFor - xGFor,
          matches: matches.length,
        });
      }
    } catch {}
  }
  return map;
}

/** Aggregate Championship TeamXg from football-data cache using SoT proxy */
function loadChampionshipTeamXg(): Map<string, TeamXg> {
  const map = new Map<string, TeamXg>();
  for (const f of ["championship-2024-25.json", "championship-2025-26.json"]) {
    const fp = join(dataDir, f);
    if (!existsSync(fp)) continue;
    try {
      const raw = JSON.parse(readFileSync(fp, "utf-8"));
      for (const m of raw.matches ?? []) {
        if (m.homeGoals == null || m.awayGoals == null) continue;
        const hSoT = m.homeShotsOnTarget ?? 0;
        const aSoT = m.awayShotsOnTarget ?? 0;
        for (const [team, isHome] of [[m.homeTeam, true], [m.awayTeam, false]] as [string, boolean][]) {
          const existing = map.get(team) ?? { team, xGFor: 0, xGAgainst: 0, goalsFor: 0, goalsAgainst: 0, xGDiff: 0, overperformance: 0, matches: 0 };
          existing.goalsFor += isHome ? m.homeGoals : m.awayGoals;
          existing.goalsAgainst += isHome ? m.awayGoals : m.homeGoals;
          existing.xGFor += (isHome ? hSoT : aSoT) * SOT_TO_XG;
          existing.xGAgainst += (isHome ? aSoT : hSoT) * SOT_TO_XG;
          existing.matches += 1;
          existing.xGDiff = existing.xGFor - existing.xGAgainst;
          existing.overperformance = existing.goalsFor - existing.xGFor;
          map.set(team, existing);
        }
      }
    } catch {}
  }
  return map;
}

console.log("[PROGRESS] Loading xG data for variance...");
const leagueXg: Record<string, Map<string, TeamXg>> = {};
for (const league of ["epl", "la-liga", "bundesliga", "serie-a", "ligue-1"]) {
  leagueXg[league] = loadUnderstatTeamXg(league);
}
leagueXg["championship"] = loadChampionshipTeamXg();

const xgCounts = Object.entries(leagueXg).map(([l, m]) => `${l}: ${m.size}`).join(", ");
console.log(`[PROGRESS] Loaded xG: ${xgCounts}`);

/** Get variance for a team from its league's xG data (fuzzy name matching) */
function getTeamVariance(teamName: string, league: string, venue?: "home" | "away"): TeamVariance | null {
  const xgMap = leagueXg[league];
  if (!xgMap) return null;

  // Try exact match first
  let xg = xgMap.get(teamName);

  // Fuzzy: try normalizing hyphens/spaces
  if (!xg) {
    const normalized = teamName.replace(/-/g, " ").toLowerCase();
    for (const [key, val] of xgMap) {
      if (key.replace(/-/g, " ").toLowerCase() === normalized) { xg = val; break; }
    }
  }

  // Fuzzy: try first word match (e.g. "Atalanta" matches "Atalanta")
  if (!xg) {
    const firstWord = teamName.split(" ")[0].toLowerCase();
    for (const [key, val] of xgMap) {
      if (key.toLowerCase().startsWith(firstWord)) { xg = val; break; }
    }
  }

  if (!xg) return null;
  return calculateTeamVariance(xg, venue);
}

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

  // ─── Multi-line O/U: collect all available totals lines from all bookmakers ──
  const totalsLines: { line: number; overPrice: number; underPrice: number; source: string }[] = [];

  for (const bk of snap.bookmakers) {
    // Primary O/U line (usually 2.5)
    if (bk.overOdds && bk.underOdds && bk.overLine != null) {
      totalsLines.push({ line: bk.overLine, overPrice: bk.overOdds, underPrice: bk.underOdds, source: bk.bookmakerKey });
    }
    // Alt totals lines (when available from per-event API)
    if (bk.altTotals) {
      for (const alt of bk.altTotals) {
        if (alt.over && alt.under) {
          totalsLines.push({ line: alt.line, overPrice: alt.over, underPrice: alt.under, source: bk.bookmakerKey });
        }
      }
    }
  }

  // Prefer Pinnacle totals, then any other bookmaker — deduplicate by line
  const bestTotalsByLine = new Map<number, typeof totalsLines[0]>();
  for (const tl of totalsLines) {
    const existing = bestTotalsByLine.get(tl.line);
    if (!existing || tl.source === "pinnacle") {
      bestTotalsByLine.set(tl.line, tl);
    }
  }

  // Evaluate each available line against model
  for (const [line, tl] of bestTotalsByLine) {
    const ouKey = String(line);
    const modelOU = pred.overUnder[ouKey];
    if (!modelOU) continue;

    const marketOU = devigOdds2Way(tl.overPrice, tl.underPrice);
    if (!marketOU) continue;

    const overEdge = modelOU.over - marketOU.prob1;
    if (overEdge >= minEdge) {
      bets.push({
        match: `${homeTeam} v ${awayTeam}`,
        date,
        selection: `Over ${line}`,
        modelProb: modelOU.over,
        marketProb: marketOU.prob1,
        edge: overEdge,
        pinnacleOdds: tl.overPrice,
        fairOdds: 1 / modelOU.over,
        signal: "model_only",
      });
    }
    const underEdge = modelOU.under - marketOU.prob2;
    if (underEdge >= minEdge) {
      bets.push({
        match: `${homeTeam} v ${awayTeam}`,
        date,
        selection: `Under ${line}`,
        modelProb: modelOU.under,
        marketProb: marketOU.prob2,
        edge: underEdge,
        pinnacleOdds: tl.underPrice,
        fairOdds: 1 / modelOU.under,
        signal: "model_only",
      });
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

  // Fix #3: Cross-league strength adjustment
  // Scale attack/defense by league strength relative to each other
  const homeStrength = hm.leagueStrength ?? 1.0;
  const awayStrength = am.leagueStrength ?? 1.0;

  // A team's attack from a weaker league should be deflated when facing stronger league defense
  // A team's defense from a weaker league should be inflated (worse) when facing stronger attack
  const homeAttackAdj = hr.attack * (homeStrength / awayStrength);
  const awayAttackAdj = ar.attack * (awayStrength / homeStrength);
  const homeDefenseAdj = hr.defense * (awayStrength / homeStrength);
  const awayDefenseAdj = ar.defense * (homeStrength / awayStrength);

  const lambdaHome = homeAttackAdj * awayDefenseAdj * avgHA * avgGR;
  const lambdaAway = awayAttackAdj * homeDefenseAdj * avgGR;
  const grid = generateScoreGrid(lambdaHome, lambdaAway, avgL3);

  return {
    homeTeam, awayTeam,
    lambdaHome, lambdaAway, lambda3: avgL3, scoreGrid: grid,
    probs1X2: derive1X2(grid),
    overUnder: deriveOverUnder(grid, [0.5, 1.5, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4, 4.5]),
    btts: deriveBTTS(grid),
    asianHandicap: deriveAsianHandicap(grid, [-2.5, -1.5, -1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1, 1.5, 2.5]),
    expectedGoals: { home: lambdaHome, away: lambdaAway, total: lambdaHome + lambdaAway },
    mostLikelyScore: mostLikelyScore(grid),
  };
}

// ─── Variance tagging (Phase 3) ──────────────────────────────────────────────

function tagBetsWithVariance(bets: TedBet[], homeV: TeamVariance, awayV: TeamVariance) {
  const sideAssess = assessMatch(homeV, awayV);
  const totalsThesis = assessTotalsThesis(homeV, awayV);

  for (const bet of bets) {
    const isTotal = bet.selection.startsWith("Over") || bet.selection.startsWith("Under");

    if (isTotal) {
      // Tag totals bets based on variance totals thesis
      if (totalsThesis.direction === "none") {
        bet.signal = "model_only";
        continue;
      }
      const betDir = bet.selection.startsWith("Over") ? "over" : "under";
      if (betDir === totalsThesis.direction && totalsThesis.confidence >= 0.4) {
        bet.signal = "model+variance";
      } else if (betDir !== totalsThesis.direction && totalsThesis.confidence >= 0.4) {
        bet.signal = "model_only (variance_conflict)";
      } else {
        bet.signal = "model_only";
      }
    } else {
      // Tag side bets based on match variance assessment
      if (!sideAssess.hasBet) {
        bet.signal = "model_only";
        continue;
      }
      // Check if variance agrees with the bet side
      const betTeam = bet.selection.split(" ")[0]; // first word is team name
      const matchStr = bet.match;
      const homeTeam = matchStr.split(" v ")[0];
      const varianceSide = sideAssess.betSide === "home" ? homeTeam : matchStr.split(" v ")[1];

      if (bet.selection.includes(varianceSide) || varianceSide?.includes(betTeam)) {
        bet.signal = `model+variance (${sideAssess.betGrade})`;
      } else {
        bet.signal = "model_only";
      }
    }
  }
}

// ─── Main output ─────────────────────────────────────────────────────────────

console.log("\n");
console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  OUR BETS — " + new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }));
console.log("  MI Bivariate Poisson + Variance Model");
console.log("═══════════════════════════════════════════════════════════════════════");

// ─── Market mode (Phase 2: totals-preference mechanism) ──────────────────────
// "sides_only" = AH + ML + Draw (current behavior, backtested)
// "totals_only" = O/U at all available lines (for debugging/research)
// "both" = all markets, up to 2 bets per match (one side + one total)
const MARKET_MODE: MarketMode = "both";

// ─── Totals filters (from backtest-totals.ts results) ────────────────────────
// Overs: -5.9% ROI across 2 seasons — model overestimates, public money efficient
// Unders: +2.3% ROI — contrarian edge survives, model good at spotting low-scoring
// Only bet Unders until Overs model improves
const TOTALS_UNDERS_ONLY = true;

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

  // Variance tagging for UCL
  const hi = UCL_MAP[snap.homeTeam];
  const ai = UCL_MAP[snap.awayTeam];
  if (hi?.league && ai?.league) {
    const hv = getTeamVariance(hi.fd, hi.league, "home");
    const av = getTeamVariance(ai.fd, ai.league, "away");
    if (hv && av) {
      tagBetsWithVariance(bets, hv, av);
    }
  }

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

  // Variance tagging for Championship
  const hv = getTeamVariance(homeFD, "championship", "home");
  const av = getTeamVariance(awayFD, "championship", "away");
  if (hv && av) {
    tagBetsWithVariance(bets, hv, av);
  }

  allBets.push(...bets);
}

// ─── Apply conservative filters ──────────────────────────────────────────────

let filtered = allBets;

// Filter out draws
if (EXCLUDE_DRAWS) {
  filtered = filtered.filter(b => !b.selection.includes("Draw"));
}

// Filter out Overs (backtested at -5.9% ROI — model overestimates)
if (TOTALS_UNDERS_ONLY) {
  filtered = filtered.filter(b => !b.selection.startsWith("Over"));
}

// Cap maximum odds
filtered = filtered.filter(b => b.pinnacleOdds <= MAX_ODDS);

// Group by match — market mode determines how many bets per match
const byMatch = new Map<string, TedBet[]>();
for (const b of filtered) {
  const key = b.match;
  if (!byMatch.has(key)) byMatch.set(key, []);
  byMatch.get(key)!.push(b);
}

const isTotalsBet = (b: TedBet) => b.selection.startsWith("Over") || b.selection.startsWith("Under");
const isSideBet = (b: TedBet) => !isTotalsBet(b);

const bestPerMatch: TedBet[] = [];
for (const [, bets] of byMatch) {
  // Sort all bets by edge descending
  bets.sort((a, b) => b.edge - a.edge);

  const sides = bets.filter(isSideBet);
  const totals = bets.filter(isTotalsBet);

  // For totals: keep only best per direction (Over or Under), then pick the best overall
  const bestOver = totals.filter(b => b.selection.startsWith("Over"))[0];
  const bestUnder = totals.filter(b => b.selection.startsWith("Under"))[0];
  const bestTotal = bestOver && bestUnder
    ? (bestOver.edge >= bestUnder.edge ? bestOver : bestUnder)
    : bestOver || bestUnder || null;

  // For sides: prefer AH over ML
  const ahSides = sides.filter(b => !b.selection.includes("ML") && !b.selection.includes("Draw"));
  const bestSide = ahSides.length > 0 ? ahSides[0] : sides[0] || null;

  if (MARKET_MODE === "sides_only") {
    if (bestSide) bestPerMatch.push(bestSide);
  } else if (MARKET_MODE === "totals_only") {
    if (bestTotal) bestPerMatch.push(bestTotal);
  } else {
    // "both" — up to one side + one total per match
    if (bestSide) bestPerMatch.push(bestSide);
    if (bestTotal) bestPerMatch.push(bestTotal);
  }
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
console.log(`  Market mode: ${MARKET_MODE}`);
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
  model: "MI Bivariate Poisson + Variance v2 + Totals",
  marketMode: MARKET_MODE,
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
