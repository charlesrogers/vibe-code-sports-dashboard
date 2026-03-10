/**
 * Understat xG data fetcher — direct HTTP API (no browser needed)
 *
 * Provides per-match xG data with home/away flags, enabling the
 * venue-split analysis Ted Knutson requires.
 *
 * "Knutson never uses a team's overall season xGD.
 *  He always breaks it into home and away splits."
 */

import type { TeamXg } from "./types";
import { normalizeTeamName } from "./team-mapping";

export interface VenueSplitXg {
  team: string;
  home: TeamXg;
  away: TeamXg;
  overall: TeamXg;
}

interface UnderstatMatch {
  h_a: "h" | "a";
  xG: number;
  xGA: number;
  scored: number;
  missed: number;
  date: string;
}

interface UnderstatTeamData {
  id: string;
  title: string;
  history: UnderstatMatch[];
}

interface UnderstatLeagueData {
  teams: Record<string, UnderstatTeamData>;
}

const LEAGUE_SLUGS: Record<string, string> = {
  serieA: "Serie_A",
  serieB: "Serie_B",
  premierLeague: "EPL",
  laLiga: "La_liga",
  bundesliga: "Bundesliga",
  ligue1: "Ligue_1",
};

function aggregateMatches(team: string, matches: UnderstatMatch[]): TeamXg {
  const xGFor = matches.reduce((s, m) => s + m.xG, 0);
  const xGAgainst = matches.reduce((s, m) => s + m.xGA, 0);
  const goalsFor = matches.reduce((s, m) => s + m.scored, 0);
  const goalsAgainst = matches.reduce((s, m) => s + m.missed, 0);

  return {
    team,
    xGFor: Math.round(xGFor * 100) / 100,
    xGAgainst: Math.round(xGAgainst * 100) / 100,
    goalsFor,
    goalsAgainst,
    xGDiff: Math.round((xGFor - xGAgainst) * 100) / 100,
    overperformance: Math.round((goalsFor - xGFor) * 100) / 100,
    matches: matches.length,
  };
}

/**
 * Fetch venue-split xG data directly from Understat's HTTP API.
 * No Playwright or headless browser needed.
 */
export async function fetchUnderstatVenueSplitXg(
  league: string = "serieA",
  season: string = "2025"
): Promise<VenueSplitXg[]> {
  const slug = LEAGUE_SLUGS[league];
  if (!slug) throw new Error(`Unsupported league for Understat: ${league}`);

  const res = await fetch(
    `https://understat.com/getLeagueData/${slug}/${season}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
      },
      signal: AbortSignal.timeout(15000),
      next: { revalidate: 3600 }, // 1 hour cache
    }
  );

  if (!res.ok) {
    throw new Error(`Understat API returned ${res.status}`);
  }

  const data: UnderstatLeagueData = await res.json();

  if (!data.teams || Object.keys(data.teams).length === 0) {
    throw new Error("Understat returned no team data");
  }

  const results: VenueSplitXg[] = [];

  for (const [, team] of Object.entries(data.teams)) {
    const name = normalizeTeamName(team.title, "understat");
    const homeMatches = team.history.filter((m) => m.h_a === "h");
    const awayMatches = team.history.filter((m) => m.h_a === "a");

    results.push({
      team: name,
      home: aggregateMatches(name, homeMatches),
      away: aggregateMatches(name, awayMatches),
      overall: aggregateMatches(name, team.history),
    });
  }

  return results.sort((a, b) => b.overall.xGDiff - a.overall.xGDiff);
}

/**
 * Fetch raw per-match xG data with dates — needed for walk-forward evaluation.
 * Returns the raw match-level history so callers can filter by date.
 */
export interface UnderstatTeamHistory {
  team: string;
  matches: { date: string; h_a: "h" | "a"; xG: number; xGA: number; scored: number; missed: number }[];
}

export async function fetchUnderstatRawHistory(
  league: string = "serieA",
  season: string = "2025"
): Promise<UnderstatTeamHistory[]> {
  const slug = LEAGUE_SLUGS[league];
  if (!slug) throw new Error(`Unsupported league for Understat: ${league}`);

  const res = await fetch(
    `https://understat.com/getLeagueData/${slug}/${season}`,
    {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "X-Requested-With": "XMLHttpRequest",
      },
      next: { revalidate: 3600 },
    }
  );

  if (!res.ok) throw new Error(`Understat API returned ${res.status}`);
  const data: UnderstatLeagueData = await res.json();
  if (!data.teams || Object.keys(data.teams).length === 0) {
    throw new Error("Understat returned no team data");
  }

  const results: UnderstatTeamHistory[] = [];
  for (const [, team] of Object.entries(data.teams)) {
    const name = normalizeTeamName(team.title, "understat");
    results.push({
      team: name,
      matches: team.history.map((m) => ({
        date: m.date,
        h_a: m.h_a,
        xG: m.xG,
        xGA: m.xGA,
        scored: m.scored,
        missed: m.missed,
      })),
    });
  }
  return results;
}

/**
 * Aggregate a team's xG history up to (but not including) a cutoff date.
 * This prevents look-ahead bias in walk-forward evaluation.
 */
export function aggregateXgBeforeDate(
  teamHistory: UnderstatTeamHistory,
  beforeDate: string,
  venue?: "h" | "a"
): TeamXg | null {
  let filtered = teamHistory.matches.filter((m) => m.date < beforeDate);
  if (venue) filtered = filtered.filter((m) => m.h_a === venue);
  if (filtered.length < 3) return null; // need minimum data

  return aggregateMatches(teamHistory.team, filtered as UnderstatMatch[]);
}

/**
 * Legacy: fetch overall xG (no venue split).
 * Used as fallback by other parts of the app.
 */
export async function fetchTeamXg(
  season: number = 2025
): Promise<TeamXg[]> {
  try {
    const splits = await fetchUnderstatVenueSplitXg("serieA", String(season));
    return splits.map((s) => s.overall);
  } catch (e) {
    console.warn("Understat fetch failed:", e);
    return [];
  }
}
