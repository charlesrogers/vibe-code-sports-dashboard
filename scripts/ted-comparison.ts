/**
 * Ted vs Our Model — Week-by-week comparison
 *
 * For each of Ted's newsletter dates:
 *  1. Solve MI ratings using matches before that date
 *  2. For each match Ted analyzed, generate our prediction
 *  3. Compare: which bets overlap, which are unique to each
 *  4. Score both against actual results
 *
 * Usage: npx tsx scripts/ted-comparison.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

import { prepareMarketMatches, devigOdds1X2, devigOdds2Way } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import { computeAllPPG } from "../lib/mi-model/ppg-converter";
import { predictMatch } from "../lib/mi-model/predictor";
import type { MISolverConfig, MatchPrediction } from "../lib/mi-model/types";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const dataDir = join(projectRoot, "data/football-data-cache");
const outDir = join(projectRoot, "data/backtest");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Default EPL-only: Championship has no team xG data, results corrupt the signal.
// Use --include-championship to add it back.
const EPL_ONLY_MODE = !process.argv.includes("--include-championship");

// ─── Load Ted's bets ─────────────────────────────────────────────────────────

interface TedBet {
  newsletter_date: string;
  league: string;
  match: string;
  selection: string;
  line: number;
  bet_type: string;
  source_file: string;
}

const tedBets: TedBet[] = JSON.parse(
  readFileSync(join(projectRoot, "data/ted-bets/all-bets.json"), "utf-8")
);

// Group by newsletter date
const tedByDate = new Map<string, TedBet[]>();
for (const b of tedBets) {
  if (!tedByDate.has(b.newsletter_date)) tedByDate.set(b.newsletter_date, []);
  tedByDate.get(b.newsletter_date)!.push(b);
}

const sortedDates = [...tedByDate.keys()].sort();
console.log(`[PROGRESS] Loaded ${tedBets.length} Ted bets across ${sortedDates.length} newsletter dates`);
console.log(`[PROGRESS] Date range: ${sortedDates[0]} to ${sortedDates[sortedDates.length - 1]}\n`);

// ─── MI model config ─────────────────────────────────────────────────────────

const baseConfig: MISolverConfig = {
  maxIterations: 50, convergenceThreshold: 1e-5,
  attackRange: [0.3, 3.0], defenseRange: [0.3, 3.0],
  homeAdvantageRange: [0.8, 1.8], lambda3Range: [-0.15, 0.05],
  avgGoalRateRange: [1.0, 1.8], gridSteps: 20,
  decayRate: 0.005, regularization: 0.001,
  klWeight: 1.0, ahWeight: 0.3, printEvery: 999,
  driftFactor: 0,
  outcomeWeight: 0.3, xgWeight: 0.2, recentFormBoost: 1.5,
};

// ─── Load all match data ─────────────────────────────────────────────────────

interface RawMatch {
  id: string; date: string; homeTeam: string; awayTeam: string;
  homeGoals: number; awayGoals: number; result: string; season: string;
  pinnacleHome: number; pinnacleDraw: number; pinnacleAway: number;
  pinnacleOver25: number; pinnacleUnder25: number;
  [key: string]: any;
}

function loadLeagueMatches(league: string): RawMatch[] {
  const all: RawMatch[] = [];
  const seasons = ["2023-24", "2024-25", "2025-26"];
  for (const s of seasons) {
    const f = join(dataDir, `${league}-${s}.json`);
    if (!existsSync(f)) continue;
    const data = JSON.parse(readFileSync(f, "utf-8"));
    all.push(...(data.matches || []));
  }
  return all.sort((a, b) => a.date.localeCompare(b.date));
}

console.log("[PROGRESS] Loading match data...");
const champMatches = loadLeagueMatches("championship");
const eplMatches = loadLeagueMatches("epl");
console.log(`[PROGRESS] Championship: ${champMatches.length} matches, EPL: ${eplMatches.length} matches\n`);

// ─── Team name mapping (Ted → football-data.co.uk) ──────────────────────────
// Maps each name variant to ALL possible football-data names (varies by season).
// EPL 2024-25 uses full names; 2025-26 uses abbreviations; Championship also varies.

const TEAM_VARIANTS: Record<string, string[]> = {
  // EPL — teams with season-varying names
  "Man City": ["Man City", "Manchester City"],
  "Manchester City": ["Man City", "Manchester City"],
  "Man United": ["Man United", "Manchester United"],
  "Manchester United": ["Man United", "Manchester United"],
  "Wolves": ["Wolves", "Wolverhampton"],
  "Wolverhampton": ["Wolves", "Wolverhampton"],
  "Forest": ["Nott'm Forest", "Nottingham Forest"],
  "Nott Forest": ["Nott'm Forest", "Nottingham Forest"],
  "Nottingham Forest": ["Nott'm Forest", "Nottingham Forest"],
  "Nott'm Forest": ["Nott'm Forest", "Nottingham Forest"],
  // EPL — stable names
  "Newcastle": ["Newcastle"], "Newcastle United": ["Newcastle"],
  "Brighton": ["Brighton"],
  "Crystal Palace": ["Crystal Palace"], "Palace": ["Crystal Palace"],
  "West Ham": ["West Ham"],
  "Aston Villa": ["Aston Villa"], "Tottenham": ["Tottenham"], "Spurs": ["Tottenham"],
  "Liverpool": ["Liverpool"], "Arsenal": ["Arsenal"], "Chelsea": ["Chelsea"],
  "Everton": ["Everton"], "Bournemouth": ["Bournemouth"], "Brentford": ["Brentford"],
  "Fulham": ["Fulham"],
  "Ipswich": ["Ipswich"], "Ipswich Town": ["Ipswich"],
  "Leicester": ["Leicester"], "Leicester City": ["Leicester"], "LCFC": ["Leicester"],
  "Southampton": ["Southampton"], "Burnley": ["Burnley"], "Luton": ["Luton"],
  "Sheffield United": ["Sheffield United", "Sheffield Utd"],
  "Sheff United": ["Sheffield United", "Sheffield Utd"],
  // Championship
  "Leeds": ["Leeds"], "Leeds United": ["Leeds"],
  "Sheffield Wednesday": ["Sheff Wed", "Sheffield Wed", "Sheffield Weds"],
  "Sheff Wed": ["Sheff Wed", "Sheffield Wed", "Sheffield Weds"],
  "Sheff Weds": ["Sheff Wed", "Sheffield Wed", "Sheffield Weds"],
  "Sheffield Weds": ["Sheff Wed", "Sheffield Wed", "Sheffield Weds"],
  "Sheffield Utd": ["Sheffield United", "Sheffield Utd"],
  "QPR": ["QPR"], "Sunderland": ["Sunderland"],
  "West Brom": ["West Brom"], "WBA": ["West Brom"], "West Bromwich Albion": ["West Brom"],
  "Hull": ["Hull"], "Hull City": ["Hull"],
  "Bristol City": ["Bristol City"], "Bristol": ["Bristol City"],
  "Stoke": ["Stoke"], "Stoke City": ["Stoke"],
  "Middlesbrough": ["Middlesbrough"], "Boro": ["Middlesbrough"],
  "Blackburn": ["Blackburn"], "Blackburn Rovers": ["Blackburn"],
  "Millwall": ["Millwall"], "Derby": ["Derby"], "Derby County": ["Derby"],
  "Watford": ["Watford"], "Coventry": ["Coventry"], "Coventry City": ["Coventry"],
  "Preston": ["Preston"], "Preston North End": ["Preston"], "PNE": ["Preston"],
  "Norwich": ["Norwich"], "Norwich City": ["Norwich"],
  "Swansea": ["Swansea"], "Swansea City": ["Swansea"],
  "Plymouth": ["Plymouth"], "Plymouth Argyle": ["Plymouth"],
  "Oxford": ["Oxford", "Oxford United"], "Oxford Utd": ["Oxford", "Oxford United"], "Oxford United": ["Oxford", "Oxford United"],
  "Luton Town": ["Luton"],
  "Cardiff": ["Cardiff"], "Cardiff City": ["Cardiff"],
  "Portsmouth": ["Portsmouth"], "Pompey": ["Portsmouth"],
  "Birmingham": ["Birmingham"], "Birmingham City": ["Birmingham"],
  "Wrexham": ["Wrexham"], "Wrexham AFC": ["Wrexham"],
  "Charlton": ["Charlton"], "Charlton Athletic": ["Charlton"],
};

function getTeamVariants(name: string): string[] {
  return TEAM_VARIANTS[name] || [name];
}

function mapTeam(name: string): string {
  const variants = TEAM_VARIANTS[name];
  return variants ? variants[0] : name;
}

// ─── Parse Ted's match into home/away ────────────────────────────────────────

function parseMatch(matchStr: string): { home: string; away: string } | null {
  // "Team1 v Team2" or "Team1 vs Team2" or "Team1-Team2"
  const parts = matchStr.split(/\s+(?:v|vs\.?)\s+/i);
  if (parts.length === 2) return { home: parts[0].trim(), away: parts[1].trim() };
  return null;
}

// ─── Score a bet ─────────────────────────────────────────────────────────────
// Returns { result, profit } where profit accounts for quarter-line half-win/half-loss

interface ScoreResult {
  result: "W" | "L" | "P" | "HW" | "HL" | "SKIP";
  profitMultiplier: number; // multiplied by (odds-1) for wins, -1 for losses
}

function matchesTeam(teamQuery: string, teamName: string): boolean {
  const q = teamQuery.toLowerCase();
  const t = teamName.toLowerCase();
  // Direct substring match
  if (t.includes(q) || q.includes(t)) return true;
  // Try all mapped variants
  for (const variant of getTeamVariants(teamName)) {
    const v = variant.toLowerCase();
    if (v.includes(q) || q.includes(v)) return true;
  }
  for (const variant of getTeamVariants(teamQuery)) {
    const v = variant.toLowerCase();
    if (v.includes(t) || t.includes(v)) return true;
  }
  return false;
}

function scoreBet(
  selection: string, homeGoals: number, awayGoals: number,
  homeTeam: string, awayTeam: string
): ScoreResult {
  const sel = selection.toLowerCase().trim();
  const margin = homeGoals - awayGoals;

  // Over/Under
  if (sel.startsWith("over ")) {
    const line = parseFloat(sel.replace("over ", ""));
    const total = homeGoals + awayGoals;
    const diff = total - line;
    // Quarter-line O/U
    if (line % 0.5 !== 0 && line % 0.25 === 0) {
      if (diff > 0.25) return { result: "W", profitMultiplier: 1 };
      if (diff < -0.25) return { result: "L", profitMultiplier: -1 };
      if (diff > 0) return { result: "HW", profitMultiplier: 0.5 }; // half win
      if (diff < 0) return { result: "HL", profitMultiplier: -0.5 }; // half loss
      return { result: "P", profitMultiplier: 0 };
    }
    return diff > 0 ? { result: "W", profitMultiplier: 1 }
      : diff < 0 ? { result: "L", profitMultiplier: -1 }
      : { result: "P", profitMultiplier: 0 };
  }
  if (sel.startsWith("under ")) {
    const line = parseFloat(sel.replace("under ", ""));
    const total = homeGoals + awayGoals;
    const diff = line - total;
    if (line % 0.5 !== 0 && line % 0.25 === 0) {
      if (diff > 0.25) return { result: "W", profitMultiplier: 1 };
      if (diff < -0.25) return { result: "L", profitMultiplier: -1 };
      if (diff > 0) return { result: "HW", profitMultiplier: 0.5 };
      if (diff < 0) return { result: "HL", profitMultiplier: -0.5 };
      return { result: "P", profitMultiplier: 0 };
    }
    return diff > 0 ? { result: "W", profitMultiplier: 1 }
      : diff < 0 ? { result: "L", profitMultiplier: -1 }
      : { result: "P", profitMultiplier: 0 };
  }

  // AH: "Team +0.5" or "Team -0.75"
  const ahMatch = selection.match(/(.+?)\s+([+-]?\d*\.?\d+)$/);
  if (ahMatch) {
    const team = ahMatch[1].trim();
    const line = parseFloat(ahMatch[2]);

    const isHome = matchesTeam(team, homeTeam);
    const isAway = matchesTeam(team, awayTeam);

    let adjustedMargin: number;
    if (isHome && !isAway) {
      adjustedMargin = margin + line;
    } else if (isAway && !isHome) {
      adjustedMargin = -margin + line;
    } else if (isHome && isAway) {
      // Both match (rare) — prefer exact match
      adjustedMargin = team.toLowerCase() === homeTeam.toLowerCase() ? margin + line : -margin + line;
    } else {
      return { result: "SKIP", profitMultiplier: 0 }; // can't determine side
    }

    // Quarter lines: half-win / half-loss
    if (line % 0.5 !== 0 && line % 0.25 === 0) {
      if (adjustedMargin > 0.25) return { result: "W", profitMultiplier: 1 };
      if (adjustedMargin < -0.25) return { result: "L", profitMultiplier: -1 };
      if (adjustedMargin > 0) return { result: "HW", profitMultiplier: 0.5 }; // half win: +0.5 * (odds-1)
      if (adjustedMargin < 0) return { result: "HL", profitMultiplier: -0.5 }; // half loss: -0.5
      return { result: "P", profitMultiplier: 0 };
    }

    return adjustedMargin > 0 ? { result: "W", profitMultiplier: 1 }
      : adjustedMargin < 0 ? { result: "L", profitMultiplier: -1 }
      : { result: "P", profitMultiplier: 0 };
  }

  // Draw
  if (sel === "draw") return margin === 0
    ? { result: "W", profitMultiplier: 1 }
    : { result: "L", profitMultiplier: -1 };

  // Moneyline
  if (sel.includes("ml") || sel.includes("moneyline")) {
    const teamPart = sel.replace(/\s*(ml|moneyline)\s*/i, "").trim();
    const isHome = matchesTeam(teamPart, homeTeam);
    if (isHome) return margin > 0 ? { result: "W", profitMultiplier: 1 } : { result: "L", profitMultiplier: -1 };
    return margin < 0 ? { result: "W", profitMultiplier: 1 } : { result: "L", profitMultiplier: -1 };
  }

  return { result: "SKIP", profitMultiplier: 0 };
}

// ─── Solve model and generate predictions ────────────────────────────────────

interface ModelCache {
  params: any;
  solvedDate: string;
}

const modelCache: Record<string, ModelCache> = {};
const CACHE_VALIDITY_DAYS = 21; // Re-solve every 3 weeks to speed up backtest

function getModel(league: string, beforeDate: string): any | null {
  const cacheKey = league;
  const cached = modelCache[cacheKey];

  if (cached) {
    const daysSince = Math.floor(
      (new Date(beforeDate).getTime() - new Date(cached.solvedDate).getTime()) / 86400000
    );
    if (daysSince < CACHE_VALIDITY_DAYS && daysSince >= 0) return cached.params;
  }

  // Select matches for training
  const allMatches = league === "championship" ? champMatches : eplMatches;
  const training = allMatches.filter(m => m.date < beforeDate);
  if (training.length < 50) return null;

  const rawData = {
    matches: training, league,
    season: "2024-25", fetchedAt: beforeDate, matchCount: training.length,
  };

  const marketMatches = prepareMarketMatches(rawData, { useClosing: true, requirePinnacle: true });
  if (marketMatches.length < 50) return null;

  try {
    const params = solveRatings(marketMatches, league, "2024-25", {
      ...baseConfig,
      driftFactor: league === "championship" ? 0.1 : 0,
    });
    computeAllPPG(params);
    modelCache[cacheKey] = { params, solvedDate: beforeDate };
    console.log(`  [MODEL] Solved ${league} @ ${beforeDate} (${marketMatches.length} matches)`);
    return params;
  } catch {
    return null;
  }
}

function generateOurBet(
  homeTeam: string, awayTeam: string, league: string, pinnOdds: { h: number; d: number; a: number },
  pinnOU?: { over: number; under: number }
): { selection: string; edge: number; fairOdds: number; pinnacleOdds: number } | null {
  const leagueKey = league.toLowerCase().includes("champ") ? "championship" : "epl";
  const model = modelCache[leagueKey]?.params;
  if (!model) return null;

  const homeFD = mapTeam(homeTeam);
  const awayFD = mapTeam(awayTeam);

  let pred: MatchPrediction | null = null;
  try {
    pred = predictMatch(model, homeFD, awayFD);
  } catch { return null; }
  if (!pred) return null;

  // Devig market 1X2 odds
  const market = devigOdds1X2(pinnOdds.h, pinnOdds.d, pinnOdds.a);
  if (!market) return null;

  // ─── Ted-style bet selection ────────────────────────────────────────────
  // Key learnings from backtest v1:
  //  - NO draws (24% win rate, noise)
  //  - NO longshots > 3.0 odds (need 33%+ hit rate, model can't deliver)
  //  - Prefer AH lines: express as +0.5, -0.75, etc.
  //  - Min edge 5% (3% was too loose)
  //  - Cap odds at 2.5 (Ted's avg is ~1.9)

  const MIN_EDGE = 0.04;
  const MAX_ODDS = 2.80;

  interface Candidate {
    sel: string; edge: number; prob: number; odds: number;
  }
  const candidates: Candidate[] = [];

  // ─── Determine the "right" AH line from 1X2 implied ──────────────────
  // Ted picks the AH line closest to fair. We use the model's AH probs
  // and the market-implied 1X2 to find where the model sees value.

  // Key AH equivalences (from model score grid):
  // Home -0.5 cover prob = model home win prob
  // Home +0.5 cover prob = model home win + draw prob (≈ 1 - away win)
  // Home 0 cover prob = home win prob (push on draw)

  const ahChecks: { line: number; homeProb: number; marketHomeProb: number }[] = [];

  // -0.5: home must win outright
  const ah_neg05 = pred.asianHandicap["-0.5"];
  if (ah_neg05) {
    ahChecks.push({ line: -0.5, homeProb: ah_neg05.home, marketHomeProb: market.home });
  }

  // +0.5: home wins or draws (home doesn't lose)
  const ah_pos05 = pred.asianHandicap["0.5"];
  if (ah_pos05) {
    ahChecks.push({ line: 0.5, homeProb: ah_pos05.home, marketHomeProb: market.home + market.draw });
  }

  // 0: home wins (push on draw)
  const ah_0 = pred.asianHandicap["0"];
  if (ah_0) {
    ahChecks.push({ line: 0, homeProb: ah_0.home, marketHomeProb: market.home + market.draw * 0.5 });
  }

  // -0.75: between -0.5 and -1
  const ah_neg075 = pred.asianHandicap["-0.75"];
  if (ah_neg075) {
    ahChecks.push({ line: -0.75, homeProb: ah_neg075.home, marketHomeProb: market.home * 0.85 });
  }

  // +0.25: between 0 and +0.5
  const ah_pos025 = pred.asianHandicap["0.25"];
  if (ah_pos025) {
    ahChecks.push({ line: 0.25, homeProb: ah_pos025.home, marketHomeProb: market.home + market.draw * 0.75 });
  }

  // -0.25: between -0.5 and 0
  const ah_neg025 = pred.asianHandicap["-0.25"];
  if (ah_neg025) {
    ahChecks.push({ line: -0.25, homeProb: ah_neg025.home, marketHomeProb: market.home + market.draw * 0.25 });
  }

  // -1: home wins by 2+
  const ah_neg1 = pred.asianHandicap["-1"];
  if (ah_neg1) {
    ahChecks.push({ line: -1, homeProb: ah_neg1.home, marketHomeProb: market.home * 0.55 });
  }

  // +1: home can lose by 1 and push
  const ah_pos1 = pred.asianHandicap["1"];
  if (ah_pos1) {
    ahChecks.push({ line: 1, homeProb: ah_pos1.home, marketHomeProb: 1 - market.away * 0.55 });
  }

  // -1.5: home wins by 2+
  const ah_neg15 = pred.asianHandicap["-1.5"];
  if (ah_neg15) {
    ahChecks.push({ line: -1.5, homeProb: ah_neg15.home, marketHomeProb: market.home * 0.4 });
  }

  // +1.5: home can lose by 1 and still win
  const ah_pos15 = pred.asianHandicap["1.5"];
  if (ah_pos15) {
    ahChecks.push({ line: 1.5, homeProb: ah_pos15.home, marketHomeProb: 1 - market.away * 0.4 });
  }

  for (const ahc of ahChecks) {
    // Home side
    const homeEdge = ahc.homeProb - ahc.marketHomeProb;
    if (homeEdge >= MIN_EDGE) {
      const odds = 1 / ahc.marketHomeProb;
      if (odds <= MAX_ODDS) {
        const lineStr = ahc.line >= 0 ? `+${ahc.line}` : `${ahc.line}`;
        candidates.push({ sel: `${homeTeam} ${lineStr}`, edge: homeEdge, prob: ahc.homeProb, odds });
      }
    }

    // Away side (flip)
    const awayProb = 1 - ahc.homeProb;
    const marketAway = 1 - ahc.marketHomeProb;
    const awayEdge = awayProb - marketAway;
    if (awayEdge >= MIN_EDGE) {
      const odds = 1 / marketAway;
      if (odds <= MAX_ODDS) {
        const awayLine = -ahc.line;
        const lineStr = awayLine >= 0 ? `+${awayLine}` : `${awayLine}`;
        candidates.push({ sel: `${awayTeam} ${lineStr}`, edge: awayEdge, prob: awayProb, odds });
      }
    }
  }

  // ─── O/U 2.5 (only with real Pinnacle odds) ──────────────────────────
  const ou = pred.overUnder["2.5"];
  if (ou && pinnOU && pinnOU.over > 1 && pinnOU.under > 1) {
    const ouMarket = devigOdds2Way(pinnOU.over, pinnOU.under);
    if (ouMarket) {
      const overEdge = ou.over - ouMarket.prob1;
      if (overEdge >= MIN_EDGE && pinnOU.over <= MAX_ODDS) {
        candidates.push({ sel: "Over 2.5", edge: overEdge, prob: ou.over, odds: pinnOU.over });
      }
      const underEdge = ou.under - ouMarket.prob2;
      if (underEdge >= MIN_EDGE && pinnOU.under <= MAX_ODDS) {
        candidates.push({ sel: "Under 2.5", edge: underEdge, prob: ou.under, odds: pinnOU.under });
      }
    }
  }

  // ─── NO draws, NO longshots ───────────────────────────────────────────
  // Pick the best candidate (highest edge, already filtered by max odds)
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.edge - a.edge);
  const best = candidates[0];

  return {
    selection: best.sel,
    edge: best.edge,
    fairOdds: 1 / best.prob,
    pinnacleOdds: best.odds,
  };
}

// ─── Main comparison loop ────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  TED vs OUR MODEL — Historical Comparison");
console.log("═══════════════════════════════════════════════════════════════════════\n");

interface WeekResult {
  date: string;
  tedBets: number;
  ourBets: number;
  overlap: number;
  tedOnlyW: number; tedOnlyL: number;
  ourOnlyW: number; ourOnlyL: number;
  overlapW: number; overlapL: number;
  tedProfit: number;
  ourProfit: number;
}

const weekResults: WeekResult[] = [];
const eplWeekResults: WeekResult[] = [];
let processedWeeks = 0;
let cumTedProfit = 0;
let cumOurProfit = 0;

// EPL-only accumulators
const eplOnly = {
  tedBets: 0, tedW: 0, tedL: 0, tedProfit: 0,
  ourBets: 0, ourW: 0, ourL: 0, ourProfit: 0,
  overlap: 0,
};

// ─── Diagnostic counters ──────────────────────────────────────────────────────
const diag = {
  totalBets: tedBets.length,
  relevantBets: 0,
  matchFound: 0,
  scored: 0,
  skipped: 0,
  usedRealOdds: 0,
  usedEstimatedOdds: 0,
  excludedLeagues: new Map<string, number>(),
  unmatchedBets: [] as { bet: TedBet; reason: string }[],
};

// Count excluded leagues
for (const b of tedBets) {
  if (b.league !== "Championship" && b.league !== "EPL") {
    diag.excludedLeagues.set(b.league, (diag.excludedLeagues.get(b.league) || 0) + 1);
  }
}

// ─── Match finder: searches BOTH leagues, 7-day window ────────────────────────

function findMatchInData(
  homeVariants: string[], awayVariants: string[], newsletterDate: string
): RawMatch | null {
  const dateObj = new Date(newsletterDate);
  const allPools = [eplMatches, champMatches]; // Search BOTH leagues regardless of Ted's label
  let bestMatch: RawMatch | null = null;
  let bestDayDiff = Infinity;

  for (const pool of allPools) {
    for (const m of pool) {
      const mDate = new Date(m.date);
      const dayDiff = (mDate.getTime() - dateObj.getTime()) / 86400000;
      // Look 2 days before to 7 days after the newsletter date
      if (dayDiff < -2 || dayDiff > 7) continue;
      const absDiff = Math.abs(dayDiff);

      const homeMatch = homeVariants.some(v => v === m.homeTeam);
      const awayMatch = awayVariants.some(v => v === m.awayTeam);
      if (homeMatch && awayMatch && absDiff < bestDayDiff) {
        bestMatch = m;
        bestDayDiff = absDiff;
      }
    }
  }
  return bestMatch;
}

// ─── Resolve Ted's selection for "or" bets ──────────────────────────────────

function resolveSelection(selection: string): string {
  // Handle "or" selections: "Portsmouth +.75 or +.5" → take first line
  const orMatch = selection.match(/^(.+?)\s+or\s+/i);
  if (orMatch) return orMatch[1].trim();
  return selection;
}

// ─── Compute Ted's profit using real Pinnacle odds when available ──────────

function computeTedProfit(
  scoreResult: ScoreResult,
  bet: TedBet,
  matchData: RawMatch,
  homeTeam: string, awayTeam: string
): { profit: number; usedRealOdds: boolean } {
  const DEFAULT_ODDS = 1.90;

  // Try to find real Pinnacle odds
  let realOdds: number | null = null;

  if (bet.bet_type === "ah") {
    const ahMatch = bet.selection.match(/(.+?)\s+([+-]?\d*\.?\d+)$/);
    if (ahMatch) {
      const teamName = ahMatch[1].trim();
      const tedLine = parseFloat(ahMatch[2]);
      const isHome = matchesTeam(teamName, homeTeam);
      const isAway = matchesTeam(teamName, awayTeam);

      // Try opening AH first, then closing AH as fallback
      const ahSources: { line: number | null; homeOdds: number; awayOdds: number }[] = [];
      if (matchData.ahLine != null && matchData.pinnacleAHHome > 1 && matchData.pinnacleAHAway > 1) {
        ahSources.push({ line: matchData.ahLine, homeOdds: matchData.pinnacleAHHome, awayOdds: matchData.pinnacleAHAway });
      }
      if (matchData.ahCloseLine != null && matchData.pinnacleCloseAHHome > 1 && matchData.pinnacleCloseAHAway > 1) {
        ahSources.push({ line: matchData.ahCloseLine, homeOdds: matchData.pinnacleCloseAHHome, awayOdds: matchData.pinnacleCloseAHAway });
      }

      for (const src of ahSources) {
        if (realOdds !== null) break;
        if (isHome && !isAway) {
          if (Math.abs(tedLine - src.line!) < 0.01) {
            realOdds = src.homeOdds;
          }
        } else if (isAway && !isHome) {
          if (Math.abs(tedLine - (-src.line!)) < 0.01) {
            realOdds = src.awayOdds;
          }
        }
      }
    }
  } else if (bet.bet_type === "ou") {
    const sel = bet.selection.toLowerCase().trim();
    // Only have Pinnacle O/U for 2.5 line
    if ((sel.includes("over 2.5") || sel.includes("under 2.5")) &&
        matchData.pinnacleOver25 > 1 && matchData.pinnacleUnder25 > 1) {
      realOdds = sel.includes("over") ? matchData.pinnacleOver25 : matchData.pinnacleUnder25;
    }
  }

  const odds = realOdds || DEFAULT_ODDS;
  const usedReal = realOdds !== null;

  // Compute profit using score result's profitMultiplier
  let profit: number;
  if (scoreResult.profitMultiplier > 0) {
    // Win or half-win: profit = multiplier * (odds - 1)
    profit = scoreResult.profitMultiplier * (odds - 1);
  } else if (scoreResult.profitMultiplier < 0) {
    // Loss or half-loss: profit = multiplier (already negative, 1u stake)
    profit = scoreResult.profitMultiplier;
  } else {
    profit = 0;
  }

  return { profit, usedRealOdds: usedReal };
}

// Filter leagues: EPL only by default (Championship has no team xG, drags P/L)
const RELEVANT_LEAGUES = EPL_ONLY_MODE ? ["EPL"] : ["EPL", "Championship"];
const relevantDates = sortedDates.filter(d => {
  const bets = tedByDate.get(d) || [];
  return bets.some(b => RELEVANT_LEAGUES.includes(b.league));
});

console.log(`[PROGRESS] Mode: ${EPL_ONLY_MODE ? "EPL-only" : "EPL + Championship"}`);
console.log(`[PROGRESS] Processing ${relevantDates.length} relevant newsletter dates\n`);

for (let i = 0; i < relevantDates.length; i++) {
  const date = relevantDates[i];
  const tedWeekBets = (tedByDate.get(date) || []).filter(
    b => RELEVANT_LEAGUES.includes(b.league)
  );

  if (tedWeekBets.length === 0) continue;
  diag.relevantBets += tedWeekBets.length;

  // Solve models for this date
  if (!EPL_ONLY_MODE) getModel("championship", date);
  getModel("epl", date);

  // For each Ted bet, find the match in our data to get Pinnacle odds and results
  const tedResults: { bet: TedBet; matchData: any; result: ScoreResult["result"]; profit: number; usedRealOdds: boolean; isEPL: boolean }[] = [];
  const ourResults: { match: string; selection: string; edge: number; result: ScoreResult["result"]; profit: number; pinnOdds: number; isEPL: boolean }[] = [];
  const overlapMatches = new Set<string>();

  for (const tb of tedWeekBets) {
    const parsed = parseMatch(tb.match);
    if (!parsed) {
      diag.unmatchedBets.push({ bet: tb, reason: "unparseable match string" });
      continue;
    }

    // Resolve "or" selections
    const resolvedSelection = resolveSelection(tb.selection);
    const wasOr = resolvedSelection !== tb.selection;

    const homeVariants = getTeamVariants(parsed.home);
    const awayVariants = getTeamVariants(parsed.away);

    // Search BOTH leagues
    const match = findMatchInData(homeVariants, awayVariants, date);

    if (!match) {
      diag.unmatchedBets.push({ bet: tb, reason: `no match found for ${homeVariants.join("/")} v ${awayVariants.join("/")}` });
      continue;
    }
    diag.matchFound++;

    // Determine actual league from which pool the match came from
    const isEPL = eplMatches.some(m => m.id === match.id);

    // Score Ted's bet
    const scoreResult = scoreBet(resolvedSelection, match.homeGoals, match.awayGoals, match.homeTeam, match.awayTeam);

    if (scoreResult.result === "SKIP") {
      diag.skipped++;
      diag.unmatchedBets.push({ bet: tb, reason: `team unresolvable in selection: "${resolvedSelection}" vs ${match.homeTeam}/${match.awayTeam}` });
      continue;
    }

    diag.scored++;

    // Compute Ted's profit with real odds
    const { profit: tedProfit, usedRealOdds } = computeTedProfit(scoreResult, tb, match, match.homeTeam, match.awayTeam);
    if (usedRealOdds) diag.usedRealOdds++;
    else diag.usedEstimatedOdds++;

    tedResults.push({
      bet: { ...tb, selection: resolvedSelection },
      matchData: match,
      result: scoreResult.result,
      profit: tedProfit,
      usedRealOdds,
      isEPL,
    });

    // EPL-only tracking for Ted
    if (isEPL) {
      eplOnly.tedBets++;
      if (scoreResult.result === "W" || scoreResult.result === "HW") eplOnly.tedW++;
      if (scoreResult.result === "L" || scoreResult.result === "HL") eplOnly.tedL++;
      eplOnly.tedProfit += tedProfit;
    }

    // Generate our bet for same match — require real Pinnacle odds (avg odds produce noisy edge signals)
    if (match.pinnacleHome > 1 && match.pinnacleDraw > 1 && match.pinnacleAway > 1) {
      const ourBet = generateOurBet(
        match.homeTeam, match.awayTeam, tb.league,
        { h: match.pinnacleHome, d: match.pinnacleDraw, a: match.pinnacleAway },
        match.pinnacleOver25 > 1 && match.pinnacleUnder25 > 1
          ? { over: match.pinnacleOver25, under: match.pinnacleUnder25 }
          : undefined
      );

      if (ourBet) {
        const ourScore = scoreBet(ourBet.selection, match.homeGoals, match.awayGoals, match.homeTeam, match.awayTeam);
        let ourProfit: number;
        if (ourScore.profitMultiplier > 0) {
          ourProfit = ourScore.profitMultiplier * (ourBet.pinnacleOdds - 1);
        } else {
          ourProfit = ourScore.profitMultiplier;
        }
        ourResults.push({
          match: tb.match,
          selection: ourBet.selection,
          edge: ourBet.edge,
          result: ourScore.result,
          profit: ourProfit,
          pinnOdds: ourBet.pinnacleOdds,
          isEPL,
        });

        // EPL-only tracking for our model
        if (isEPL) {
          eplOnly.ourBets++;
          if (ourScore.result === "W" || ourScore.result === "HW") eplOnly.ourW++;
          if (ourScore.result === "L" || ourScore.result === "HL") eplOnly.ourL++;
          eplOnly.ourProfit += ourProfit;
        }

        // Check overlap
        const ourTeam = ourBet.selection.split(" ")[0].toLowerCase();
        const tedTeam = resolvedSelection.split(" ")[0].toLowerCase();
        if (ourTeam === tedTeam || resolvedSelection.toLowerCase().includes(ourTeam)) {
          overlapMatches.add(tb.match);
        }
      }
    }
  }

  const tedW = tedResults.filter(r => r.result === "W" || r.result === "HW").length;
  const tedL = tedResults.filter(r => r.result === "L" || r.result === "HL").length;
  const tedP = tedResults.filter(r => r.result === "P").length;
  const ourW = ourResults.filter(r => r.result === "W" || r.result === "HW").length;
  const ourL = ourResults.filter(r => r.result === "L" || r.result === "HL").length;
  const ourP = ourResults.filter(r => r.result === "P").length;
  const tedWeekProfit = tedResults.reduce((s, r) => s + r.profit, 0);
  const ourWeekProfit = ourResults.reduce((s, r) => s + r.profit, 0);
  cumTedProfit += tedWeekProfit;
  cumOurProfit += ourWeekProfit;

  weekResults.push({
    date,
    tedBets: tedResults.length,
    ourBets: ourResults.length,
    overlap: overlapMatches.size,
    tedOnlyW: tedW, tedOnlyL: tedL,
    ourOnlyW: ourW, ourOnlyL: ourL,
    overlapW: 0, overlapL: 0,
    tedProfit: tedWeekProfit, ourProfit: ourWeekProfit,
  });

  // EPL-only per-week results
  const eplTed = tedResults.filter(r => r.isEPL);
  const eplOur = ourResults.filter(r => r.isEPL);
  if (eplTed.length > 0 || eplOur.length > 0) {
    const eTedW = eplTed.filter(r => r.result === "W" || r.result === "HW").length;
    const eTedL = eplTed.filter(r => r.result === "L" || r.result === "HL").length;
    const eOurW = eplOur.filter(r => r.result === "W" || r.result === "HW").length;
    const eOurL = eplOur.filter(r => r.result === "L" || r.result === "HL").length;
    eplWeekResults.push({
      date,
      tedBets: eplTed.length, ourBets: eplOur.length, overlap: 0,
      tedOnlyW: eTedW, tedOnlyL: eTedL,
      ourOnlyW: eOurW, ourOnlyL: eOurL,
      overlapW: 0, overlapL: 0,
      tedProfit: eplTed.reduce((s, r) => s + r.profit, 0),
      ourProfit: eplOur.reduce((s, r) => s + r.profit, 0),
    });
  }

  processedWeeks++;

  // ─── PRINT EVERY WEEK IN DETAIL ─────────────────────────────────────
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  WEEK ${processedWeeks} — ${date}`);
  console.log(`${"═".repeat(70)}`);

  // Ted's bets
  console.log(`\n  TED'S BETS (${tedResults.length}):`);
  for (const tr of tedResults) {
    const icon = tr.result === "HW" ? "½W" : tr.result === "HL" ? "½L" : tr.result;
    const score = tr.matchData ? `${tr.matchData.homeGoals}-${tr.matchData.awayGoals}` : "?-?";
    const oddsTag = tr.usedRealOdds ? "" : " [est]";
    console.log(`    [${icon}] ${tr.bet.match.padEnd(35)} ${tr.bet.selection.padEnd(22)} (${score}) ${tr.profit >= 0 ? "+" : ""}${tr.profit.toFixed(2)}u${oddsTag}`);
  }

  // Our bets
  console.log(`\n  OUR BETS (${ourResults.length}):`);
  if (ourResults.length === 0) {
    console.log(`    (no value found)`);
  } else {
    for (const or2 of ourResults) {
      const icon = or2.result === "HW" ? "½W" : or2.result === "HL" ? "½L" : or2.result;
      console.log(`    [${icon}] ${or2.match.padEnd(35)} ${or2.selection.padEnd(22)} edge: +${(or2.edge * 100).toFixed(1)}%  @ ${or2.pinnOdds.toFixed(2)}`);
    }
  }

  // Week summary line
  console.log(`\n  Week P/L:  Ted ${tedWeekProfit >= 0 ? "+" : ""}${tedWeekProfit.toFixed(1)}u (${tedW}W/${tedL}L/${tedP}P)  |  Ours ${ourWeekProfit >= 0 ? "+" : ""}${ourWeekProfit.toFixed(1)}u (${ourW}W/${ourL}L/${ourP}P)  |  Overlap: ${overlapMatches.size}`);
  console.log(`  Cumulative: Ted ${cumTedProfit >= 0 ? "+" : ""}${cumTedProfit.toFixed(1)}u  |  Ours ${cumOurProfit >= 0 ? "+" : ""}${cumOurProfit.toFixed(1)}u`);
}

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log("\n");
console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  COMPARISON SUMMARY");
console.log("═══════════════════════════════════════════════════════════════════════\n");

const totalTedBets = weekResults.reduce((s, w) => s + w.tedBets, 0);
const totalOurBets = weekResults.reduce((s, w) => s + w.ourBets, 0);
const totalTedW = weekResults.reduce((s, w) => s + w.tedOnlyW, 0);
const totalTedL = weekResults.reduce((s, w) => s + w.tedOnlyL, 0);
const totalOurW = weekResults.reduce((s, w) => s + w.ourOnlyW, 0);
const totalOurL = weekResults.reduce((s, w) => s + w.ourOnlyL, 0);
const totalTedProfit = weekResults.reduce((s, w) => s + w.tedProfit, 0);
const totalOurProfit = weekResults.reduce((s, w) => s + w.ourProfit, 0);

console.log(`  Ted's Bets:`);
console.log(`    Total scored: ${totalTedBets} | W: ${totalTedW} | L: ${totalTedL}`);
console.log(`    Win rate: ${(totalTedW / Math.max(1, totalTedBets) * 100).toFixed(1)}%`);
console.log(`    P/L: ${totalTedProfit >= 0 ? "+" : ""}${totalTedProfit.toFixed(1)} units`);
console.log(`    ROI: ${(totalTedProfit / Math.max(1, totalTedBets) * 100).toFixed(1)}%`);
console.log();

console.log(`  Our Model (MI Poisson):`);
console.log(`    Total: ${totalOurBets} | W: ${totalOurW} | L: ${totalOurL}`);
console.log(`    Win rate: ${(totalOurW / Math.max(1, totalOurBets) * 100).toFixed(1)}%`);
console.log(`    P/L: ${totalOurProfit >= 0 ? "+" : ""}${totalOurProfit.toFixed(1)} units`);
console.log(`    ROI: ${(totalOurProfit / Math.max(1, totalOurBets) * 100).toFixed(1)}%`);
console.log();

const totalOverlap = weekResults.reduce((s, w) => s + w.overlap, 0);
console.log(`  Overlap: ${totalOverlap} matches where both picked same side`);
console.log(`  Weeks processed: ${processedWeeks}`);
console.log();

// EPL-only summary
console.log(`${"═".repeat(70)}`);
console.log("  EPL-ONLY COMPARISON (where we have team xG data)");
console.log(`${"═".repeat(70)}\n`);
console.log(`  Ted (EPL only):`);
console.log(`    Total: ${eplOnly.tedBets} | W: ${eplOnly.tedW} | L: ${eplOnly.tedL}`);
console.log(`    Win rate: ${(eplOnly.tedW / Math.max(1, eplOnly.tedBets) * 100).toFixed(1)}%`);
console.log(`    P/L: ${eplOnly.tedProfit >= 0 ? "+" : ""}${eplOnly.tedProfit.toFixed(1)} units`);
console.log(`    ROI: ${(eplOnly.tedProfit / Math.max(1, eplOnly.tedBets) * 100).toFixed(1)}%`);
console.log();
console.log(`  Our Model (EPL only):`);
console.log(`    Total: ${eplOnly.ourBets} | W: ${eplOnly.ourW} | L: ${eplOnly.ourL}`);
console.log(`    Win rate: ${(eplOnly.ourW / Math.max(1, eplOnly.ourBets) * 100).toFixed(1)}%`);
console.log(`    P/L: ${eplOnly.ourProfit >= 0 ? "+" : ""}${eplOnly.ourProfit.toFixed(1)} units`);
console.log(`    ROI: ${(eplOnly.ourProfit / Math.max(1, eplOnly.ourBets) * 100).toFixed(1)}%`);
console.log();

// Weekly comparison table
console.log(`  ─── WEEKLY COMPARISON ─────────────────────────────────────────\n`);
console.log(`  ${"Date".padEnd(12)} ${"Ted".padStart(4)} ${"W/L".padStart(5)} ${"P/L".padStart(7)} ${"Ours".padStart(5)} ${"W/L".padStart(5)} ${"P/L".padStart(7)} ${"CumTed".padStart(8)} ${"CumOurs".padStart(8)}`);
console.log(`  ${"─".repeat(70)}`);

let cumTed = 0, cumOurs = 0;
for (const w of weekResults) {
  cumTed += w.tedProfit;
  cumOurs += w.ourProfit;
  console.log(
    `  ${w.date.padEnd(12)} ` +
    `${String(w.tedBets).padStart(4)} ` +
    `${w.tedOnlyW}/${w.tedOnlyL}`.padStart(5) + ` ` +
    `${(w.tedProfit >= 0 ? "+" : "") + w.tedProfit.toFixed(1)}`.padStart(7) + ` ` +
    `${String(w.ourBets).padStart(5)} ` +
    `${w.ourOnlyW}/${w.ourOnlyL}`.padStart(5) + ` ` +
    `${(w.ourProfit >= 0 ? "+" : "") + w.ourProfit.toFixed(1)}`.padStart(7) + ` ` +
    `${(cumTed >= 0 ? "+" : "") + cumTed.toFixed(1)}`.padStart(8) + ` ` +
    `${(cumOurs >= 0 ? "+" : "") + cumOurs.toFixed(1)}`.padStart(8)
  );
}

// EPL-only weekly table
console.log(`\n  ─── EPL-ONLY WEEKLY COMPARISON ────────────────────────────────────\n`);
console.log(`  ${"Date".padEnd(12)} ${"Ted".padStart(4)} ${"W/L".padStart(5)} ${"P/L".padStart(7)} ${"Ours".padStart(5)} ${"W/L".padStart(5)} ${"P/L".padStart(7)} ${"CumTed".padStart(8)} ${"CumOurs".padStart(8)}`);
console.log(`  ${"─".repeat(70)}`);

let eCumTed = 0, eCumOurs = 0;
for (const w of eplWeekResults) {
  eCumTed += w.tedProfit;
  eCumOurs += w.ourProfit;
  console.log(
    `  ${w.date.padEnd(12)} ` +
    `${String(w.tedBets).padStart(4)} ` +
    `${w.tedOnlyW}/${w.tedOnlyL}`.padStart(5) + ` ` +
    `${(w.tedProfit >= 0 ? "+" : "") + w.tedProfit.toFixed(1)}`.padStart(7) + ` ` +
    `${String(w.ourBets).padStart(5)} ` +
    `${w.ourOnlyW}/${w.ourOnlyL}`.padStart(5) + ` ` +
    `${(w.ourProfit >= 0 ? "+" : "") + w.ourProfit.toFixed(1)}`.padStart(7) + ` ` +
    `${(eCumTed >= 0 ? "+" : "") + eCumTed.toFixed(1)}`.padStart(8) + ` ` +
    `${(eCumOurs >= 0 ? "+" : "") + eCumOurs.toFixed(1)}`.padStart(8)
  );
}

// ─── Diagnostic summary ─────────────────────────────────────────────────────

console.log(`\n${"═".repeat(70)}`);
console.log("  SCORING DIAGNOSTICS");
console.log(`${"═".repeat(70)}\n`);
console.log(`  Total Ted bets in data:       ${diag.totalBets}`);
console.log(`  Relevant (EPL+Champ):          ${diag.relevantBets}`);
console.log(`  Match found in FD data:        ${diag.matchFound}`);
console.log(`  Successfully scored:           ${diag.scored}`);
console.log(`  Skipped (unresolvable):        ${diag.skipped}`);
console.log(`  Used real Pinnacle odds:       ${diag.usedRealOdds}`);
console.log(`  Used estimated 1.90 odds:      ${diag.usedEstimatedOdds}`);
console.log(`  Leagues excluded:`);
for (const [league, count] of diag.excludedLeagues) {
  console.log(`    ${league}: ${count}`);
}

if (diag.unmatchedBets.length > 0) {
  console.log(`\n  Unmatched/skipped bets (${diag.unmatchedBets.length}):`);
  for (const { bet, reason } of diag.unmatchedBets.slice(0, 30)) {
    console.log(`    ${bet.newsletter_date} | ${bet.match.padEnd(30)} | ${reason}`);
  }
  if (diag.unmatchedBets.length > 30) {
    console.log(`    ... and ${diag.unmatchedBets.length - 30} more`);
  }
}
console.log();

// Save results
const output = {
  generated: new Date().toISOString(),
  summary: {
    ted: { bets: totalTedBets, wins: totalTedW, losses: totalTedL, profit: totalTedProfit },
    ours: { bets: totalOurBets, wins: totalOurW, losses: totalOurL, profit: totalOurProfit },
    overlap: totalOverlap, weeksProcessed: processedWeeks,
  },
  eplOnly: {
    ted: { bets: eplOnly.tedBets, wins: eplOnly.tedW, losses: eplOnly.tedL, profit: eplOnly.tedProfit },
    ours: { bets: eplOnly.ourBets, wins: eplOnly.ourW, losses: eplOnly.ourL, profit: eplOnly.ourProfit },
  },
  diagnostics: {
    totalBets: diag.totalBets,
    relevantBets: diag.relevantBets,
    matchFound: diag.matchFound,
    scored: diag.scored,
    skipped: diag.skipped,
    usedRealOdds: diag.usedRealOdds,
    usedEstimatedOdds: diag.usedEstimatedOdds,
    excludedLeagues: Object.fromEntries(diag.excludedLeagues),
  },
  weekResults,
  eplWeekResults,
};

writeFileSync(join(outDir, "ted-comparison.json"), JSON.stringify(output, null, 2));
console.log(`  Results saved to data/backtest/ted-comparison.json\n`);
console.log(`  [DONE]\n`);
