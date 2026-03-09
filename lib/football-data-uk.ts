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

export type League = "serieA" | "serieB";

const LEAGUE_FILES: Record<League, string> = {
  serieA: "I1",
  serieB: "I2",
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
      }));
  } catch (e) {
    console.warn(`Failed to fetch football-data.co.uk for ${season}:`, e);
    return [];
  }
}

export function getAvailableSeasons(): string[] {
  return Object.keys(SEASON_CODES).sort().reverse();
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
