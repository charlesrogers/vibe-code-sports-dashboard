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

const TED_TO_FD: Record<string, string> = {
  // EPL
  "Man City": "Man City", "Man United": "Man United",
  "Nott Forest": "Nott'm Forest", "Nottingham Forest": "Nott'm Forest", "Nott'm Forest": "Nott'm Forest", "Forest": "Nott'm Forest",
  "Newcastle": "Newcastle", "Wolves": "Wolves", "Brighton": "Brighton",
  "Crystal Palace": "Crystal Palace", "West Ham": "West Ham",
  "Aston Villa": "Aston Villa", "Tottenham": "Tottenham", "Spurs": "Tottenham",
  "Liverpool": "Liverpool", "Arsenal": "Arsenal", "Chelsea": "Chelsea",
  "Everton": "Everton", "Bournemouth": "Bournemouth", "Brentford": "Brentford",
  "Fulham": "Fulham", "Ipswich": "Ipswich", "Leicester": "Leicester",
  "Southampton": "Southampton", "Burnley": "Burnley", "Luton": "Luton",
  "Sheffield United": "Sheffield United",
  // Championship
  "Leeds": "Leeds", "Burnley": "Burnley",
  "Sheffield Wednesday": "Sheff Wed", "Sheff Wed": "Sheff Wed",
  "Sheffield Utd": "Sheffield United",
  "QPR": "QPR", "Sunderland": "Sunderland",
  "West Brom": "West Brom", "WBA": "West Brom",
  "Hull": "Hull", "Hull City": "Hull",
  "Bristol City": "Bristol City", "Bristol": "Bristol City",
  "Stoke": "Stoke", "Stoke City": "Stoke",
  "Middlesbrough": "Middlesbrough", "Boro": "Middlesbrough",
  "Blackburn": "Blackburn", "Blackburn Rovers": "Blackburn",
  "Millwall": "Millwall", "Derby": "Derby", "Derby County": "Derby",
  "Watford": "Watford", "Coventry": "Coventry", "Coventry City": "Coventry",
  "Preston": "Preston", "Preston North End": "Preston", "PNE": "Preston",
  "Norwich": "Norwich", "Norwich City": "Norwich",
  "Swansea": "Swansea", "Swansea City": "Swansea",
  "Plymouth": "Plymouth", "Plymouth Argyle": "Plymouth",
  "Oxford": "Oxford United", "Oxford Utd": "Oxford United", "Oxford United": "Oxford United",
  "Luton": "Luton", "Luton Town": "Luton",
  "Cardiff": "Cardiff", "Cardiff City": "Cardiff",
  "Portsmouth": "Portsmouth", "Pompey": "Portsmouth",
  "Birmingham": "Birmingham", "Birmingham City": "Birmingham",
  "Wrexham": "Wrexham", "Wrexham AFC": "Wrexham",
  "Charlton": "Charlton", "Charlton Athletic": "Charlton",
};

function mapTeam(name: string): string {
  return TED_TO_FD[name] || name;
}

// ─── Parse Ted's match into home/away ────────────────────────────────────────

function parseMatch(matchStr: string): { home: string; away: string } | null {
  // "Team1 v Team2" or "Team1 vs Team2" or "Team1-Team2"
  const parts = matchStr.split(/\s+(?:v|vs\.?)\s+/i);
  if (parts.length === 2) return { home: parts[0].trim(), away: parts[1].trim() };
  return null;
}

// ─── Score a bet ─────────────────────────────────────────────────────────────

function scoreBet(
  selection: string, homeGoals: number, awayGoals: number,
  homeTeam: string, awayTeam: string
): "W" | "L" | "P" {
  const sel = selection.toLowerCase().trim();
  const margin = homeGoals - awayGoals;

  // Over/Under
  if (sel.startsWith("over ")) {
    const line = parseFloat(sel.replace("over ", ""));
    const total = homeGoals + awayGoals;
    return total > line ? "W" : total < line ? "L" : "P";
  }
  if (sel.startsWith("under ")) {
    const line = parseFloat(sel.replace("under ", ""));
    const total = homeGoals + awayGoals;
    return total < line ? "W" : total > line ? "L" : "P";
  }

  // AH: "Team +0.5" or "Team -0.75"
  const ahMatch = selection.match(/(.+?)\s+([+-]?\d*\.?\d+)$/);
  if (ahMatch) {
    const team = ahMatch[1].trim().toLowerCase();
    const line = parseFloat(ahMatch[2]);

    // Determine if bet is on home or away
    const isHome = homeTeam.toLowerCase().includes(team) || team.includes(homeTeam.toLowerCase());
    const isAway = awayTeam.toLowerCase().includes(team) || team.includes(awayTeam.toLowerCase());

    let adjustedMargin: number;
    if (isHome) {
      adjustedMargin = margin + line;
    } else if (isAway) {
      adjustedMargin = -margin + line;
    } else {
      // Try mapping
      const mappedHome = mapTeam(homeTeam).toLowerCase();
      const mappedAway = mapTeam(awayTeam).toLowerCase();
      if (team.includes(mappedHome) || mappedHome.includes(team)) {
        adjustedMargin = margin + line;
      } else if (team.includes(mappedAway) || mappedAway.includes(team)) {
        adjustedMargin = -margin + line;
      } else {
        return "L"; // can't determine side
      }
    }

    // Handle quarter lines
    if (line % 0.5 !== 0 && line % 0.25 === 0) {
      // Quarter line = half on each adjacent line
      const lowerLine = line - 0.25;
      const upperLine = line + 0.25;
      const lowerResult = adjustedMargin - 0.25 > 0 ? 1 : adjustedMargin - 0.25 < 0 ? -1 : 0;
      const upperResult = adjustedMargin + 0.25 > 0 ? 1 : adjustedMargin + 0.25 < 0 ? -1 : 0;

      // Actually for quarter lines, simplified:
      if (adjustedMargin > 0.25) return "W";
      if (adjustedMargin < -0.25) return "L";
      if (adjustedMargin === 0) return "P"; // half win half push essentially
      return adjustedMargin > 0 ? "W" : "L"; // half win or half loss
    }

    return adjustedMargin > 0 ? "W" : adjustedMargin < 0 ? "L" : "P";
  }

  // Draw
  if (sel === "draw") return margin === 0 ? "W" : "L";

  // Moneyline
  if (sel.includes("ml") || sel.includes("moneyline")) {
    // Determine team
    const teamPart = sel.replace(/\s*(ml|moneyline)\s*/i, "").trim();
    const isHome = homeTeam.toLowerCase().includes(teamPart) || teamPart.includes(homeTeam.toLowerCase());
    if (isHome) return margin > 0 ? "W" : "L";
    return margin < 0 ? "W" : "L";
  }

  return "L";
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
let processedWeeks = 0;
let cumTedProfit = 0;
let cumOurProfit = 0;

// Only process Championship and EPL (not UCL/MLS as we don't have model for those)
const relevantDates = sortedDates.filter(d => {
  const bets = tedByDate.get(d) || [];
  return bets.some(b => b.league === "Championship" || b.league === "EPL");
});

console.log(`[PROGRESS] Processing ${relevantDates.length} relevant newsletter dates (Championship + EPL)\n`);

for (let i = 0; i < relevantDates.length; i++) {
  const date = relevantDates[i];
  const tedWeekBets = (tedByDate.get(date) || []).filter(
    b => b.league === "Championship" || b.league === "EPL"
  );

  if (tedWeekBets.length === 0) continue;

  // Solve models for this date
  const leaguesNeeded = new Set(tedWeekBets.map(b => b.league === "Championship" ? "championship" : "epl"));
  for (const l of leaguesNeeded) {
    getModel(l, date);
  }

  // For each Ted bet, find the match in our data to get Pinnacle odds and results
  const tedResults: { bet: TedBet; matchData: any; result: "W" | "L" | "P" | "?"; profit: number }[] = [];
  const ourResults: { match: string; selection: string; edge: number; result: "W" | "L" | "P" | "?"; profit: number; pinnOdds: number }[] = [];
  const overlapMatches = new Set<string>();

  // Also track which matches Ted analyzed but didn't bet (so we can show our bets on those)
  const allMatchesThisWeek: { match: string; homeTeam: string; awayTeam: string; league: string; found: any }[] = [];

  for (const tb of tedWeekBets) {
    const parsed = parseMatch(tb.match);
    if (!parsed) continue;

    const homeFD = mapTeam(parsed.home);
    const awayFD = mapTeam(parsed.away);
    const leagueKey = tb.league === "Championship" ? "championship" : "epl";
    const allMatches = leagueKey === "championship" ? champMatches : eplMatches;

    // Find the match in our data (within 5 days of newsletter date)
    const dateObj = new Date(date);
    const match = allMatches.find(m => {
      const mDate = new Date(m.date);
      const dayDiff = Math.abs(mDate.getTime() - dateObj.getTime()) / 86400000;
      return dayDiff <= 5 &&
        ((m.homeTeam === homeFD && m.awayTeam === awayFD) ||
         (m.homeTeam === parsed.home && m.awayTeam === parsed.away));
    });

    if (!match) continue;

    // Score Ted's bet
    const tedResult = scoreBet(tb.selection, match.homeGoals, match.awayGoals, match.homeTeam, match.awayTeam);
    tedResults.push({
      bet: tb,
      matchData: match,
      result: tedResult,
      profit: tedResult === "W" ? 0.9 : tedResult === "L" ? -1 : 0, // ~1.9 avg odds
    });

    // Generate our bet for same match
    if (match.pinnacleHome > 1 && match.pinnacleDraw > 1 && match.pinnacleAway > 1) {
      const ourBet = generateOurBet(
        match.homeTeam, match.awayTeam, tb.league,
        { h: match.pinnacleHome, d: match.pinnacleDraw, a: match.pinnacleAway },
        match.pinnacleOver25 > 1 && match.pinnacleUnder25 > 1
          ? { over: match.pinnacleOver25, under: match.pinnacleUnder25 }
          : undefined
      );

      if (ourBet) {
        const ourResult = scoreBet(ourBet.selection, match.homeGoals, match.awayGoals, match.homeTeam, match.awayTeam);
        ourResults.push({
          match: tb.match,
          selection: ourBet.selection,
          edge: ourBet.edge,
          result: ourResult,
          profit: ourResult === "W" ? ourBet.pinnacleOdds - 1 : ourResult === "L" ? -1 : 0,
          pinnOdds: ourBet.pinnacleOdds,
        });

        // Check overlap
        const ourTeam = ourBet.selection.split(" ")[0].toLowerCase();
        const tedTeam = tb.selection.split(" ")[0].toLowerCase();
        if (ourTeam === tedTeam || tb.selection.toLowerCase().includes(ourTeam)) {
          overlapMatches.add(tb.match);
        }
      }
    }
  }

  const tedW = tedResults.filter(r => r.result === "W").length;
  const tedL = tedResults.filter(r => r.result === "L").length;
  const tedP = tedResults.filter(r => r.result === "P").length;
  const ourW = ourResults.filter(r => r.result === "W").length;
  const ourL = ourResults.filter(r => r.result === "L").length;
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

  processedWeeks++;

  // ─── PRINT EVERY WEEK IN DETAIL ─────────────────────────────────────
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  WEEK ${processedWeeks} — ${date}`);
  console.log(`${"═".repeat(70)}`);

  // Ted's bets
  console.log(`\n  TED'S BETS (${tedResults.length}):`);
  for (const tr of tedResults) {
    const icon = tr.result === "W" ? "W" : tr.result === "L" ? "L" : "P";
    const score = tr.matchData ? `${tr.matchData.homeGoals}-${tr.matchData.awayGoals}` : "?-?";
    console.log(`    [${icon}] ${tr.bet.match.padEnd(35)} ${tr.bet.selection.padEnd(22)} (${score})`);
  }

  // Our bets
  console.log(`\n  OUR BETS (${ourResults.length}):`);
  if (ourResults.length === 0) {
    console.log(`    (no value found)`);
  } else {
    for (const or2 of ourResults) {
      const icon = or2.result === "W" ? "W" : or2.result === "L" ? "L" : "P";
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
console.log(`    Total: ${totalTedBets} | W: ${totalTedW} | L: ${totalTedL}`);
console.log(`    Win rate: ${(totalTedW / Math.max(1, totalTedBets) * 100).toFixed(1)}%`);
console.log(`    Est. P/L: ${totalTedProfit >= 0 ? "+" : ""}${totalTedProfit.toFixed(1)} units`);
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

// Save results
const output = {
  generated: new Date().toISOString(),
  summary: {
    ted: { bets: totalTedBets, wins: totalTedW, losses: totalTedL, profit: totalTedProfit },
    ours: { bets: totalOurBets, wins: totalOurW, losses: totalOurL, profit: totalOurProfit },
    overlap: totalOverlap, weeksProcessed: processedWeeks,
  },
  weekResults,
};

writeFileSync(join(outDir, "ted-comparison.json"), JSON.stringify(output, null, 2));
console.log(`\n  Results saved to data/backtest/ted-comparison.json\n`);
console.log(`  [DONE]\n`);
