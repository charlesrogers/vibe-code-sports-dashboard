// football-data.co.uk CSV importer
// Free, no auth, includes match results + betting odds from multiple bookmakers

import { normalizeTeamName } from "./team-mapping";

export interface MatchWithOdds {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  htHomeGoals: number;
  htAwayGoals: number;
  result: "H" | "D" | "A";
  season: string;
  // Match stats
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeCorners: number;
  awayCorners: number;
  homeFouls: number;
  awayFouls: number;
  homeYellow: number;
  awayYellow: number;
  homeRed: number;
  awayRed: number;
  // Betting odds (decimal)
  b365Home: number;
  b365Draw: number;
  b365Away: number;
  pinnacleHome: number;
  pinnacleDraw: number;
  pinnacleAway: number;
  maxHome: number;
  maxDraw: number;
  maxAway: number;
  avgHome: number;
  avgDraw: number;
  avgAway: number;
  // Over/Under 2.5
  b365Over25: number;
  b365Under25: number;
  pinnacleOver25: number;
  pinnacleUnder25: number;
  avgOver25: number;
  avgUnder25: number;
  // Pinnacle closing odds (PSCH/PSCD/PSCA columns)
  pinnacleCloseHome: number;
  pinnacleCloseDraw: number;
  pinnacleCloseAway: number;
  pinnacleCloseOver25: number;
  pinnacleCloseUnder25: number;
}

function parseFloat2(val: string): number {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    if (values.length < headers.length / 2) continue; // skip malformed rows
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || "").trim();
    }
    rows.push(row);
  }
  return rows;
}

// football-data.co.uk uses dd/mm/yyyy format
function parseUKDate(dateStr: string): string {
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const [day, month, year] = parts;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return dateStr;
}

// Map football-data.co.uk team names to canonical names
function normalizeUKTeamName(name: string): string {
  // football-data.co.uk uses its own naming convention
  const ukMap: Record<string, string> = {
    "AC Milan": "Milan",
    "Atalanta": "Atalanta",
    "Bologna": "Bologna",
    "Cagliari": "Cagliari",
    "Como": "Como",
    "Cremonese": "Cremonese",
    "Empoli": "Empoli",
    "Fiorentina": "Fiorentina",
    "Frosinone": "Frosinone",
    "Genoa": "Genoa",
    "Hellas Verona": "Verona",
    "Inter": "Inter",
    "Juventus": "Juventus",
    "Lazio": "Lazio",
    "Lecce": "Lecce",
    "Milan": "Milan",
    "Monza": "Monza",
    "Napoli": "Napoli",
    "Parma": "Parma",
    "Roma": "Roma",
    "Salernitana": "Salernitana",
    "Sampdoria": "Sampdoria",
    "Sassuolo": "Sassuolo",
    "Spezia": "Spezia",
    "Torino": "Torino",
    "Udinese": "Udinese",
    "Venezia": "Venezia",
    "Verona": "Verona",
    "Pisa": "Pisa",
    // Serie B teams
    "Bari": "Bari",
    "Palermo": "Palermo",
    "Brescia": "Brescia",
    "Cittadella": "Cittadella",
    "Cosenza": "Cosenza",
    "Reggiana": "Reggiana",
    "Catanzaro": "Catanzaro",
    "Sudtirol": "Sudtirol",
    "Modena": "Modena",
    "Carrarese": "Carrarese",
    "Juve Stabia": "Juve Stabia",
    "Mantova": "Mantova",
    "Cesena": "Cesena",
    "Padova": "Padova",
    "Pescara": "Pescara",
    "Avellino": "Avellino",
    "Virtus Entella": "Virtus Entella",
    // EPL teams (football-data.co.uk names → canonical)
    "Arsenal": "Arsenal",
    "Aston Villa": "Aston Villa",
    "Bournemouth": "Bournemouth",
    "Brentford": "Brentford",
    "Brighton": "Brighton",
    "Burnley": "Burnley",
    "Chelsea": "Chelsea",
    "Crystal Palace": "Crystal Palace",
    "Everton": "Everton",
    "Fulham": "Fulham",
    "Ipswich": "Ipswich",
    "Leeds": "Leeds",
    "Leicester": "Leicester",
    "Liverpool": "Liverpool",
    "Luton": "Luton",
    "Man City": "Manchester City",
    "Man United": "Manchester United",
    "Newcastle": "Newcastle United",
    "Nott'm Forest": "Nottingham Forest",
    "Sheffield United": "Sheffield United",
    "Southampton": "Southampton",
    "Tottenham": "Tottenham",
    "West Ham": "West Ham",
    "Wolves": "Wolverhampton Wanderers",
    // Championship teams (common ones)
    "Birmingham": "Birmingham",
    "Blackburn": "Blackburn",
    "Bristol City": "Bristol City",
    "Cardiff": "Cardiff",
    "Coventry": "Coventry",
    "Derby": "Derby",
    "Hull": "Hull City",
    "Middlesbrough": "Middlesbrough",
    "Millwall": "Millwall",
    "Norwich": "Norwich",
    "Plymouth": "Plymouth",
    "Preston": "Preston",
    "QPR": "QPR",
    "Rotherham": "Rotherham",
    "Sheff Wed": "Sheffield Wednesday",
    "Stoke": "Stoke",
    "Sunderland": "Sunderland",
    "Swansea": "Swansea",
    "Watford": "Watford",
    "West Brom": "West Brom",
    "Wigan": "Wigan",
    // La Liga teams
    "Ath Madrid": "Atletico Madrid",
    "Ath Bilbao": "Athletic Bilbao",
    "Betis": "Real Betis",
    "Sociedad": "Real Sociedad",
    "Vallecano": "Rayo Vallecano",
    "La Coruna": "Deportivo La Coruna",
    // Bundesliga teams
    "Dortmund": "Borussia Dortmund",
    "M'gladbach": "Monchengladbach",
    "Leverkusen": "Bayer Leverkusen",
    "Ein Frankfurt": "Eintracht Frankfurt",
    "Mainz": "Mainz 05",
    "FC Koln": "FC Cologne",
  };
  return ukMap[name] ?? name;
}

const SEASON_CODES: Record<string, string> = {
  "2025-26": "2526",
  "2024-25": "2425",
  "2023-24": "2324",
  "2022-23": "2223",
  "2021-22": "2122",
  "2020-21": "2021",
  "2019-20": "1920",
  "2018-19": "1819",
};

export type League = "serieA" | "serieB" | "epl" | "championship" | "laLiga" | "bundesliga" | "ligue1" | "serie-a" | "la-liga" | "serie-b" | "ligue-1";

const LEAGUE_FILES: Record<string, string> = {
  serieA: "I1",
  "serie-a": "I1",
  serieB: "I2",
  epl: "E0",
  championship: "E1",
  laLiga: "SP1",
  "la-liga": "SP1",
  bundesliga: "D1",
  ligue1: "F1",
  "serie-b": "I2",
  "ligue-1": "F1",
};

export async function fetchMatchesWithOdds(season: string, league: League = "serieA"): Promise<MatchWithOdds[]> {
  const code = SEASON_CODES[season];
  if (!code) return [];

  const leagueFile = LEAGUE_FILES[league];
  const url = `https://www.football-data.co.uk/mmz4281/${code}/${leagueFile}.csv`;

  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];

    const text = await res.text();
    const rows = parseCSV(text);

    return rows
      .filter((r) => r.HomeTeam && r.AwayTeam && r.FTHG !== "" && r.FTAG !== "")
      .map((r) => ({
        id: `uk-${season}-${r.Date}-${r.HomeTeam}-${r.AwayTeam}`,
        date: parseUKDate(r.Date),
        homeTeam: normalizeUKTeamName(r.HomeTeam),
        awayTeam: normalizeUKTeamName(r.AwayTeam),
        homeGoals: parseInt(r.FTHG) || 0,
        awayGoals: parseInt(r.FTAG) || 0,
        htHomeGoals: parseInt(r.HTHG) || 0,
        htAwayGoals: parseInt(r.HTAG) || 0,
        result: (r.FTR || "D") as "H" | "D" | "A",
        season,
        homeShots: parseInt(r.HS) || 0,
        awayShots: parseInt(r.AS) || 0,
        homeShotsOnTarget: parseInt(r.HST) || 0,
        awayShotsOnTarget: parseInt(r.AST) || 0,
        homeCorners: parseInt(r.HC) || 0,
        awayCorners: parseInt(r.AC) || 0,
        homeFouls: parseInt(r.HF) || 0,
        awayFouls: parseInt(r.AF) || 0,
        homeYellow: parseInt(r.HY) || 0,
        awayYellow: parseInt(r.AY) || 0,
        homeRed: parseInt(r.HR) || 0,
        awayRed: parseInt(r.AR) || 0,
        b365Home: parseFloat2(r.B365H),
        b365Draw: parseFloat2(r.B365D),
        b365Away: parseFloat2(r.B365A),
        pinnacleHome: parseFloat2(r.PSH),
        pinnacleDraw: parseFloat2(r.PSD),
        pinnacleAway: parseFloat2(r.PSA),
        maxHome: parseFloat2(r.MaxH),
        maxDraw: parseFloat2(r.MaxD),
        maxAway: parseFloat2(r.MaxA),
        avgHome: parseFloat2(r.AvgH),
        avgDraw: parseFloat2(r.AvgD),
        avgAway: parseFloat2(r.AvgA),
        b365Over25: parseFloat2(r["B365>2.5"]),
        b365Under25: parseFloat2(r["B365<2.5"]),
        pinnacleOver25: parseFloat2(r["P>2.5"]),
        pinnacleUnder25: parseFloat2(r["P<2.5"]),
        avgOver25: parseFloat2(r["Avg>2.5"]),
        avgUnder25: parseFloat2(r["Avg<2.5"]),
        // Pinnacle closing odds (PSCH/PSCD/PSCA) — fall back to PSH/PSD/PSA if close not available
        pinnacleCloseHome: parseFloat2(r.PSCH) || parseFloat2(r.PSH),
        pinnacleCloseDraw: parseFloat2(r.PSCD) || parseFloat2(r.PSD),
        pinnacleCloseAway: parseFloat2(r.PSCA) || parseFloat2(r.PSA),
        pinnacleCloseOver25: parseFloat2(r["PC>2.5"]) || parseFloat2(r["P>2.5"]),
        pinnacleCloseUnder25: parseFloat2(r["PC<2.5"]) || parseFloat2(r["P<2.5"]),
      }));
  } catch (e) {
    console.warn(`Failed to fetch football-data.co.uk for ${season}:`, e);
    return [];
  }
}

export function getAvailableSeasons(): string[] {
  return Object.keys(SEASON_CODES).sort().reverse();
}

/**
 * Load matches from local football-data cache (populated by backfill-historical.ts).
 * Falls back to live fetch if cache is missing.
 */
export async function fetchMatchesWithOddsCached(season: string, league: League = "serieA"): Promise<MatchWithOdds[]> {
  // Try local cache first
  try {
    const fs = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const cacheFile = join(process.cwd(), "data", "football-data-cache", `${league}-${season}.json`);
    if (fs.existsSync(cacheFile)) {
      const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
      console.log(`[football-data] Loaded ${data.matches?.length ?? 0} matches from cache: ${league}-${season}`);
      return (data.matches || []) as MatchWithOdds[];
    }
  } catch { /* fall through to live fetch */ }

  // No cache — fetch live
  return fetchMatchesWithOdds(season, league);
}

/**
 * Load training Match[] data from cached football-data.co.uk CSVs.
 * Useful for EPL/Championship where openfootball doesn't have data.
 */
export async function fetchTrainingMatchesFromCache(
  seasons: string[],
  league: League
): Promise<import("./types").Match[]> {
  const fs = require("fs") as typeof import("fs");
  const { join } = require("path") as typeof import("path");
  const matches: import("./types").Match[] = [];

  for (const season of seasons) {
    const cacheFile = join(process.cwd(), "data", "football-data-cache", `${league}-${season}.json`);
    try {
      if (fs.existsSync(cacheFile)) {
        const data = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
        for (const m of data.matches || []) {
          matches.push({
            id: m.id,
            date: m.date,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            homeGoals: m.homeGoals,
            awayGoals: m.awayGoals,
            season: m.season,
          });
        }
        console.log(`[football-data] Training data: ${data.matches?.length ?? 0} matches from ${league}-${season}`);
      } else {
        // Try live fetch as fallback
        const odds = await fetchMatchesWithOdds(season, league);
        for (const m of odds) {
          matches.push({
            id: m.id,
            date: m.date,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            homeGoals: m.homeGoals,
            awayGoals: m.awayGoals,
            season: m.season,
          });
        }
        console.log(`[football-data] Training data (live): ${odds.length} matches from ${league}-${season}`);
      }
    } catch (e) {
      console.warn(`[football-data] Failed to load training data for ${league}-${season}:`, e);
    }
  }

  return matches.sort((a, b) => a.date.localeCompare(b.date));
}

// Calculate value: model probability vs implied market probability
export interface ValueBet {
  date: string;
  homeTeam: string;
  awayTeam: string;
  market: string; // "Home", "Draw", "Away", "Over 2.5", "Under 2.5"
  modelProb: number;
  marketOdds: number;
  impliedProb: number;
  edge: number; // modelProb - impliedProb
  kellyStake: number;
  result?: "W" | "L" | "P"; // if match already played
}

export function findValueBets(
  modelProbs: { home: number; draw: number; away: number; over25: number; under25: number },
  odds: {
    b365Home: number; b365Draw: number; b365Away: number;
    pinnacleHome: number; pinnacleDraw: number; pinnacleAway: number;
    avgHome: number; avgDraw: number; avgAway: number;
    avgOver25: number; avgUnder25: number;
  },
  minEdge: number = 0.03
): ValueBet[] {
  const bets: ValueBet[] = [];

  const checks = [
    { market: "Home", modelProb: modelProbs.home, marketOdds: odds.pinnacleHome || odds.avgHome },
    { market: "Draw", modelProb: modelProbs.draw, marketOdds: odds.pinnacleDraw || odds.avgDraw },
    { market: "Away", modelProb: modelProbs.away, marketOdds: odds.pinnacleAway || odds.avgAway },
    { market: "Over 2.5", modelProb: modelProbs.over25, marketOdds: odds.avgOver25 },
    { market: "Under 2.5", modelProb: modelProbs.under25, marketOdds: odds.avgUnder25 },
  ];

  for (const { market, modelProb, marketOdds } of checks) {
    if (marketOdds <= 1) continue;
    const impliedProb = 1 / marketOdds;
    const edge = modelProb - impliedProb;

    if (edge >= minEdge) {
      // Kelly criterion: f = (bp - q) / b where b = odds - 1, p = model prob, q = 1-p
      const b = marketOdds - 1;
      const kelly = Math.max(0, (b * modelProb - (1 - modelProb)) / b);

      bets.push({
        date: "",
        homeTeam: "",
        awayTeam: "",
        market,
        modelProb,
        marketOdds,
        impliedProb,
        edge,
        kellyStake: Math.round(kelly * 1000) / 10, // as % of bankroll
      });
    }
  }

  return bets.sort((a, b) => b.edge - a.edge);
}
