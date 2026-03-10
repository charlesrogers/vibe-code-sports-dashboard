/**
 * Data Prep — Convert football-data.co.uk cached JSON into MarketMatch[]
 *
 * Reads from data/football-data-cache/{league}-{season}.json
 * Devigs Pinnacle odds, computes time-decay weights, extracts AH data.
 */

import { MarketMatch } from "./types";

// ---------- Devig (multiplicative) ----------

/**
 * Devig 1X2 odds using multiplicative method.
 * Returns null if odds are invalid.
 */
export function devigOdds1X2(
  homeOdds: number,
  drawOdds: number,
  awayOdds: number
): { home: number; draw: number; away: number } | null {
  if (!homeOdds || !drawOdds || !awayOdds) return null;
  if (homeOdds <= 1 || drawOdds <= 1 || awayOdds <= 1) return null;

  const impliedH = 1 / homeOdds;
  const impliedD = 1 / drawOdds;
  const impliedA = 1 / awayOdds;
  const overround = impliedH + impliedD + impliedA;

  if (overround < 0.9 || overround > 1.3) return null;

  return {
    home: impliedH / overround,
    draw: impliedD / overround,
    away: impliedA / overround,
  };
}

/**
 * Devig 2-way odds (e.g., AH home/away).
 */
export function devigOdds2Way(
  odds1: number,
  odds2: number
): { prob1: number; prob2: number } | null {
  if (!odds1 || !odds2) return null;
  if (odds1 <= 1 || odds2 <= 1) return null;

  const implied1 = 1 / odds1;
  const implied2 = 1 / odds2;
  const overround = implied1 + implied2;

  if (overround < 0.9 || overround > 1.3) return null;

  return {
    prob1: implied1 / overround,
    prob2: implied2 / overround,
  };
}

// ---------- Time decay ----------

/**
 * Compute time-decay weight: exp(-decayRate * daysAgo)
 */
export function timeDecayWeight(matchDate: string, referenceDate: string, decayRate: number): number {
  const mDate = new Date(matchDate);
  const rDate = new Date(referenceDate);
  const daysAgo = (rDate.getTime() - mDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysAgo < 0) return 1.0; // future match, full weight
  return Math.exp(-decayRate * daysAgo);
}

// ---------- Raw match type from cached JSON ----------

interface RawCachedMatch {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals?: number;
  awayGoals?: number;
  result?: string;
  pinnacleHome?: number;
  pinnacleDraw?: number;
  pinnacleAway?: number;
  pinnacleCloseHome?: number;
  pinnacleCloseDraw?: number;
  pinnacleCloseAway?: number;
  ahLine?: number;
  pinnacleAHHome?: number;
  pinnacleAHAway?: number;
  ahCloseLine?: number;
  pinnacleCloseAHHome?: number;
  pinnacleCloseAHAway?: number;
  [key: string]: unknown;
}

interface CachedDataFile {
  league: string;
  season: string;
  fetchedAt: string;
  matchCount: number;
  matches: RawCachedMatch[];
}

// ---------- Main conversion ----------

export interface DataPrepOptions {
  /** Use closing odds instead of opening (default: true for backtesting accuracy) */
  useClosing?: boolean;
  /** Time decay rate (default: 0.005 ≈ 140 day half-life) */
  decayRate?: number;
  /** Reference date for time decay (default: latest match date) */
  referenceDate?: string;
  /** Minimum required: must have Pinnacle 1X2 odds */
  requirePinnacle?: boolean;
}

/**
 * Convert cached JSON data into MarketMatch[] suitable for the solver.
 */
export function prepareMarketMatches(
  data: CachedDataFile,
  options: DataPrepOptions = {}
): MarketMatch[] {
  const {
    useClosing = true,
    decayRate = 0.005,
    referenceDate,
    requirePinnacle = true,
  } = options;

  const matches = data.matches;
  if (!matches || matches.length === 0) {
    console.log("[data-prep] No matches found in data file");
    return [];
  }

  // Determine reference date (latest match date or provided)
  const refDate = referenceDate || matches.reduce((latest, m) => {
    return m.date > latest ? m.date : latest;
  }, matches[0].date);

  console.log(`[data-prep] Processing ${matches.length} matches from ${data.league} ${data.season}`);
  console.log(`[data-prep] Reference date for decay: ${refDate}, decay rate: ${decayRate}`);

  const result: MarketMatch[] = [];
  let skipped = 0;

  for (const m of matches) {
    // Pick odds source
    const homeOdds = useClosing ? (m.pinnacleCloseHome || m.pinnacleHome) : m.pinnacleHome;
    const drawOdds = useClosing ? (m.pinnacleCloseDraw || m.pinnacleDraw) : m.pinnacleDraw;
    const awayOdds = useClosing ? (m.pinnacleCloseAway || m.pinnacleAway) : m.pinnacleAway;

    if (!homeOdds || !drawOdds || !awayOdds) {
      if (requirePinnacle) {
        skipped++;
        continue;
      }
    }

    // Devig 1X2
    const probs = homeOdds && drawOdds && awayOdds
      ? devigOdds1X2(homeOdds, drawOdds, awayOdds)
      : null;

    if (!probs) {
      skipped++;
      continue;
    }

    // Time decay weight
    const weight = timeDecayWeight(m.date, refDate, decayRate);

    // Asian handicap data
    let ahLine: number | null = null;
    let ahHomeProb: number | null = null;

    const rawAHLine = useClosing ? (m.ahCloseLine ?? m.ahLine) : m.ahLine;
    const ahHomeOdds = useClosing ? (m.pinnacleCloseAHHome || m.pinnacleAHHome) : m.pinnacleAHHome;
    const ahAwayOdds = useClosing ? (m.pinnacleCloseAHAway || m.pinnacleAHAway) : m.pinnacleAHAway;

    if (rawAHLine != null && ahHomeOdds && ahAwayOdds) {
      const ahProbs = devigOdds2Way(ahHomeOdds, ahAwayOdds);
      if (ahProbs) {
        ahLine = rawAHLine;
        ahHomeProb = ahProbs.prob1;
      }
    }

    // Result
    const matchResult = (m.homeGoals != null && m.awayGoals != null)
      ? { homeGoals: m.homeGoals, awayGoals: m.awayGoals }
      : null;

    result.push({
      id: m.id,
      date: m.date,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      marketProbs: probs,
      ahLine,
      ahHomeProb,
      result: matchResult,
      weight,
    });
  }

  console.log(`[data-prep] Prepared ${result.length} matches (skipped ${skipped} without valid odds)`);
  console.log(`[data-prep] Matches with AH data: ${result.filter(m => m.ahLine != null).length}`);

  // Collect unique teams
  const teams = new Set<string>();
  result.forEach(m => { teams.add(m.homeTeam); teams.add(m.awayTeam); });
  console.log(`[data-prep] Unique teams: ${teams.size}`);

  return result;
}

/**
 * Load and prepare data from a cached file path (for use in Node.js scripts).
 */
export async function loadAndPrepare(
  filePath: string,
  options?: DataPrepOptions
): Promise<{ data: CachedDataFile; matches: MarketMatch[] }> {
  // Dynamic import for Node.js fs
  const fs = await import("fs");
  const raw = fs.readFileSync(filePath, "utf-8");
  const data: CachedDataFile = JSON.parse(raw);
  const matches = prepareMarketMatches(data, options);
  return { data, matches };
}
