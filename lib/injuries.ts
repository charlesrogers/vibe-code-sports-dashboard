/**
 * Injury and suspension data from Fotmob
 *
 * Ted: "Injuries are the second most discussed topic. But Knutson never
 *  bets on injuries alone — they amplify or kill an xG-based thesis."
 *
 * Fetches per-team injury/suspension data from Fotmob's public team API.
 */

import { normalizeTeamName } from "./team-mapping";

export interface PlayerUnavailability {
  name: string;
  type: "injury" | "suspension" | "other";
  expectedReturn: string; // e.g. "Late March 2026", "Doubtful", "Out for season"
  isKeyPlayer: boolean; // based on market value or performance
  marketValue: number | null;
  seasonGoals: number;
  seasonAssists: number;
}

export interface TeamInjuryReport {
  team: string;
  fotmobId: number;
  unavailable: PlayerUnavailability[];
  injuredCount: number;
  suspendedCount: number;
  totalOut: number;
  severity: "none" | "minor" | "moderate" | "major" | "crisis";
  summary: string;
}

// Fotmob team IDs by league
// Keys use football-data cache names (what our-bets.ts uses)
const FOTMOB_TEAM_IDS: Record<string, Record<string, number>> = {
  epl: {
    "Arsenal": 9825,
    "Man City": 8456, "Manchester City": 8456,
    "Man United": 10260, "Manchester United": 10260,
    "Aston Villa": 10252,
    "Chelsea": 8455,
    "Liverpool": 8650,
    "Brentford": 9937,
    "Everton": 8668,
    "Bournemouth": 8678, "AFC Bournemouth": 8678,
    "Fulham": 9879,
    "Sunderland": 8472,
    "Newcastle": 10261, "Newcastle United": 10261,
    "Crystal Palace": 9826,
    "Brighton": 10204, "Brighton and Hove Albion": 10204,
    "Leeds": 8463, "Leeds United": 8463,
    "Tottenham": 8586, "Tottenham Hotspur": 8586,
    "Nott'm Forest": 10203, "Nottingham Forest": 10203,
    "West Ham": 8654, "West Ham United": 8654,
    "Burnley": 8191,
    "Wolves": 8602, "Wolverhampton Wanderers": 8602,
  },
  championship: {
    "Coventry": 8669, "Coventry City": 8669,
    "Middlesbrough": 8549,
    "Millwall": 10004,
    "Ipswich": 9902, "Ipswich Town": 9902,
    "Hull": 8667, "Hull City": 8667,
    "Wrexham": 9841, "Wrexham AFC": 9841,
    "Derby": 10170, "Derby County": 10170,
    "Southampton": 8466,
    "Watford": 9817,
    "Swansea": 10003, "Swansea City": 10003,
    "Bristol City": 8427,
    "Sheffield United": 8657, "Sheffield Utd": 8657,
    "Birmingham": 8658, "Birmingham City": 8658,
    "Preston": 8411, "Preston North End": 8411,
    "Stoke": 10194, "Stoke City": 10194,
    "QPR": 10172, "Queens Park Rangers": 10172,
    "Norwich": 9850, "Norwich City": 9850,
    "Charlton": 8451, "Charlton Athletic": 8451,
    "Portsmouth": 8462,
    "Blackburn": 8655, "Blackburn Rovers": 8655,
    "Leicester": 8197, "Leicester City": 8197,
    "West Brom": 8659, "West Bromwich Albion": 8659,
    "Oxford": 8653, "Oxford United": 8653,
    "Sheffield Weds": 10163, "Sheffield Wed": 10163, "Sheffield Wednesday": 10163,
  },
  "serie-a": {
    "Inter": 8636, "Milan": 8564, "Napoli": 9875,
    "Juventus": 9885, "Atalanta": 8524, "Roma": 8686,
    "Lazio": 8543, "Fiorentina": 8535, "Bologna": 9857,
    "Como": 10171, "Torino": 9804, "Genoa": 10233,
    "Udinese": 8600, "Cagliari": 8529, "Verona": 9876,
    "Parma": 10167, "Lecce": 9888, "Sassuolo": 7943,
    "Pisa": 6479, "Cremonese": 7801,
  },
  "la-liga": {
    "Real Madrid": 8633, "Barcelona": 8634, "Ath Madrid": 8302,
    "Atletico Madrid": 8302,
    "Ath Bilbao": 9906, "Athletic Bilbao": 9906,
    "Betis": 9600, "Real Betis": 9600,
    "Sociedad": 9740, "Real Sociedad": 9740,
    "Villarreal": 10205, "Mallorca": 8329, "RCD Mallorca": 8329,
    "Celta": 10243, "Celta Vigo": 10243,
    "Osasuna": 8371, "Sevilla": 8583,
    "Getafe": 8305, "Vallecano": 9768, "Rayo Vallecano": 9768,
    "Alaves": 9682, "Deportivo Alaves": 9682,
    "Leganes": 7942, "CD Leganes": 7942,
    "Las Palmas": 7626, "UD Las Palmas": 7626,
    "Girona": 7772, "Valencia": 10267,
    "Valladolid": 8077, "Espanyol": 8558,
  },
  bundesliga: {
    "Bayern Munich": 9823, "Dortmund": 9789, "Borussia Dortmund": 9789,
    "Leverkusen": 9871, "Bayer Leverkusen": 9871,
    "RB Leipzig": 178475,
    "Ein Frankfurt": 9810, "Eintracht Frankfurt": 9810,
    "Stuttgart": 10269, "VfB Stuttgart": 10269,
    "Freiburg": 9790, "SC Freiburg": 9790,
    "Wolfsburg": 9836, "VfL Wolfsburg": 9836,
    "M'gladbach": 9788, "Borussia Monchengladbach": 9788,
    "Mainz": 9905, "Augsburg": 9791, "FC Augsburg": 9791,
    "Hoffenheim": 9553, "TSG Hoffenheim": 9553,
    "Union Berlin": 36360,
    "St Pauli": 9776, "FC St. Pauli": 9776,
    "Heidenheim": 37042,
    "Bochum": 9911, "VfL Bochum": 9911,
    "Holstein Kiel": 9869,
  },
};

// Legacy alias
const SERIE_A_TEAM_IDS = FOTMOB_TEAM_IDS["serie-a"];

// Market value threshold for "key player" (in euros)
const KEY_PLAYER_VALUE_THRESHOLD = 15_000_000;

function classifySeverity(
  totalOut: number,
  keyPlayersOut: number
): TeamInjuryReport["severity"] {
  // Ted's framework:
  // "4-5 injured players is notable. 7-8+ is a major factor."
  // "Two first-choice center-backs missing is worse than six squad players."
  if (totalOut === 0) return "none";
  if (keyPlayersOut >= 3 || totalOut >= 7) return "crisis";
  if (keyPlayersOut >= 2 || totalOut >= 5) return "major";
  if (keyPlayersOut >= 1 || totalOut >= 3) return "moderate";
  return "minor";
}

function buildSummary(report: {
  team: string;
  totalOut: number;
  injuredCount: number;
  suspendedCount: number;
  severity: string;
  unavailable: PlayerUnavailability[];
}): string {
  if (report.totalOut === 0) return `${report.team} have a clean bill of health.`;

  const parts: string[] = [];
  parts.push(`${report.team}: ${report.totalOut} players unavailable`);

  if (report.injuredCount > 0 && report.suspendedCount > 0) {
    parts.push(`(${report.injuredCount} injured, ${report.suspendedCount} suspended)`);
  }

  const keyPlayers = report.unavailable.filter((p) => p.isKeyPlayer);
  if (keyPlayers.length > 0) {
    const names = keyPlayers.map((p) => p.name).join(", ");
    parts.push(`— key absences: ${names}`);
  }

  return parts.join(" ");
}

async function fetchTeamInjuries(
  teamName: string,
  fotmobId: number
): Promise<TeamInjuryReport> {
  try {
    const res = await fetch(
      `https://www.fotmob.com/api/teams?id=${fotmobId}&ccode3=USA`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 3600 }, // 1 hour cache
      }
    );

    if (!res.ok) {
      return {
        team: teamName,
        fotmobId,
        unavailable: [],
        injuredCount: 0,
        suspendedCount: 0,
        totalOut: 0,
        severity: "none",
        summary: `Could not fetch injury data (HTTP ${res.status})`,
      };
    }

    const data = await res.json();

    const unavailable: PlayerUnavailability[] = [];

    // Method 1: Squad injury field (more comprehensive)
    const squad = data?.squad?.squad || [];
    for (const section of squad) {
      for (const player of section?.members || []) {
        const injury = player?.injury;
        if (injury) {
          unavailable.push({
            name: player.name || "Unknown",
            type: "injury",
            expectedReturn: injury.expectedReturn || "Unknown",
            isKeyPlayer: (player.marketValue || 0) >= KEY_PLAYER_VALUE_THRESHOLD,
            marketValue: player.marketValue || null,
            seasonGoals: player.seasonGoals || 0,
            seasonAssists: player.seasonAssists || 0,
          });
        }
      }
    }

    // Method 2: Unavailable list (includes suspensions)
    const unavailList =
      data?.overview?.lastLineupStats?.unavailable || [];
    for (const u of unavailList) {
      const unavailType = u?.unavailability?.type || "other";
      // Only add if not already in the injury list
      const alreadyListed = unavailable.some((p) => p.name === u.name);
      if (!alreadyListed) {
        unavailable.push({
          name: u.name || "Unknown",
          type: unavailType === "suspension" ? "suspension" : unavailType === "injury" ? "injury" : "other",
          expectedReturn: u?.unavailability?.expectedReturn || "Unknown",
          isKeyPlayer: (u.marketValue || 0) >= KEY_PLAYER_VALUE_THRESHOLD,
          marketValue: u.marketValue || null,
          seasonGoals: u?.performance?.seasonGoals || 0,
          seasonAssists: u?.performance?.seasonAssists || 0,
        });
      } else if (unavailType === "suspension") {
        // Update type if it was listed as injury but is actually suspended
        const existing = unavailable.find((p) => p.name === u.name);
        if (existing) existing.type = "suspension";
      }
    }

    const injuredCount = unavailable.filter((p) => p.type === "injury").length;
    const suspendedCount = unavailable.filter(
      (p) => p.type === "suspension"
    ).length;
    const totalOut = unavailable.length;
    const keyPlayersOut = unavailable.filter((p) => p.isKeyPlayer).length;

    const severity = classifySeverity(totalOut, keyPlayersOut);

    const report: TeamInjuryReport = {
      team: teamName,
      fotmobId,
      unavailable,
      injuredCount,
      suspendedCount,
      totalOut,
      severity,
      summary: "",
    };
    report.summary = buildSummary(report);

    return report;
  } catch (e) {
    return {
      team: teamName,
      fotmobId,
      unavailable: [],
      injuredCount: 0,
      suspendedCount: 0,
      totalOut: 0,
      severity: "none",
      summary: `Error fetching injuries: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/** Map league identifiers to FOTMOB_TEAM_IDS keys */
const LEAGUE_ALIASES: Record<string, string> = {
  serieA: "serie-a", "serie-a": "serie-a",
  epl: "epl", premierLeague: "epl",
  championship: "championship",
  "la-liga": "la-liga", laLiga: "la-liga",
  bundesliga: "bundesliga",
};

/**
 * Fetch injury reports for all teams in a league.
 * Rate-limited to avoid hammering Fotmob.
 */
export async function fetchAllInjuries(
  league: string = "serieA"
): Promise<TeamInjuryReport[]> {
  const leagueKey = LEAGUE_ALIASES[league] ?? league;
  const teamIds = FOTMOB_TEAM_IDS[leagueKey];
  if (!teamIds) return [];

  // Deduplicate (multiple name aliases point to same ID)
  const seen = new Set<number>();
  const entries: [string, number][] = [];
  for (const [name, id] of Object.entries(teamIds)) {
    if (!seen.has(id)) {
      seen.add(id);
      entries.push([name, id]);
    }
  }

  // Fetch in batches of 5 to be polite
  const results: TeamInjuryReport[] = [];
  for (let i = 0; i < entries.length; i += 5) {
    const batch = entries.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(([name, id]) => fetchTeamInjuries(name, id))
    );
    results.push(...batchResults);

    // Small delay between batches
    if (i + 5 < entries.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}

/**
 * Get injury report for a specific team by name.
 * Tries exact match then fuzzy (first word).
 */
export async function fetchTeamInjuryReport(
  team: string,
  league: string = "serieA"
): Promise<TeamInjuryReport | null> {
  const leagueKey = LEAGUE_ALIASES[league] ?? league;
  const teamIds = FOTMOB_TEAM_IDS[leagueKey];
  if (!teamIds) return null;

  // Exact match
  let id = teamIds[team];

  // Fuzzy: first word
  if (!id) {
    const firstWord = team.split(" ")[0].toLowerCase();
    for (const [name, fid] of Object.entries(teamIds)) {
      if (name.toLowerCase().startsWith(firstWord)) { id = fid; break; }
    }
  }

  if (!id) return null;
  return fetchTeamInjuries(team, id);
}

/**
 * Fetch injury reports for a list of specific teams (faster than fetching whole league).
 * Accepts team names as they appear in our odds data.
 */
export async function fetchInjuriesForTeams(
  teams: string[],
  league: string,
): Promise<Map<string, TeamInjuryReport>> {
  const leagueKey = LEAGUE_ALIASES[league] ?? league;
  const teamIds = FOTMOB_TEAM_IDS[leagueKey];
  const results = new Map<string, TeamInjuryReport>();
  if (!teamIds) return results;

  const toFetch: { name: string; id: number }[] = [];
  for (const team of teams) {
    let id = teamIds[team];
    // Fuzzy: first word
    if (!id) {
      const firstWord = team.split(" ")[0].toLowerCase();
      for (const [name, fid] of Object.entries(teamIds)) {
        if (name.toLowerCase().startsWith(firstWord)) { id = fid; break; }
      }
    }
    if (id) toFetch.push({ name: team, id });
  }

  // Fetch in batches of 5
  for (let i = 0; i < toFetch.length; i += 5) {
    const batch = toFetch.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(({ name, id }) => fetchTeamInjuries(name, id))
    );
    for (const r of batchResults) {
      results.set(r.team, r);
    }
    if (i + 5 < toFetch.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}
