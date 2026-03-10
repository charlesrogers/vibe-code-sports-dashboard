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
import { saveUnderstatCache, loadUnderstatCache, type UnderstatCacheEntry } from "./understat-cache";

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
 * Aggregate a team's xG over the LAST 10 matches (by date) before a cutoff,
 * filtered by venue. Returns null if fewer than 5 venue-filtered matches
 * are available — not enough signal for a rolling window.
 *
 * This captures recent form / trend, complementing the full-season aggregate.
 */
export function aggregateXgLast10BeforeDate(
  teamHistory: UnderstatTeamHistory,
  beforeDate: string,
  venue?: "h" | "a"
): TeamXg | null {
  let filtered = teamHistory.matches.filter((m) => m.date < beforeDate);
  if (venue) filtered = filtered.filter((m) => m.h_a === venue);

  // Sort descending by date so we can take the most recent 10
  filtered.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));

  if (filtered.length < 5) return null; // need minimum 5 matches

  const last10 = filtered.slice(0, 10);
  return aggregateMatches(teamHistory.team, last10 as UnderstatMatch[]);
}

// ---------------------------------------------------------------------------
// Cache-through fetchers — try API first, save to cache, fall back to cache
// ---------------------------------------------------------------------------

/**
 * Fetch Understat data with automatic caching. On success, persists to
 * local disk AND Vercel Blob. On API failure, loads from cache.
 *
 * Returns both raw history and venue splits from a single API call.
 */
export async function fetchUnderstatCached(
  league: string = "serieA",
  season: string = "2025"
): Promise<{ rawHistory: UnderstatTeamHistory[]; venueSplits: VenueSplitXg[]; source: string }> {
  // Try live API first
  try {
    const slug = LEAGUE_SLUGS[league];
    if (!slug) throw new Error(`Unsupported league: ${league}`);

    const res = await fetch(
      `https://understat.com/getLeagueData/${slug}/${season}`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(15000),
        next: { revalidate: 3600 },
      }
    );

    if (!res.ok) throw new Error(`Understat API returned ${res.status}`);
    const data: UnderstatLeagueData = await res.json();
    if (!data.teams || Object.keys(data.teams).length === 0) {
      throw new Error("Understat returned no team data");
    }

    // Parse both formats from the single response
    const rawHistory: UnderstatTeamHistory[] = [];
    const venueSplits: VenueSplitXg[] = [];

    for (const [, team] of Object.entries(data.teams)) {
      const name = normalizeTeamName(team.title, "understat");
      const homeMatches = team.history.filter((m) => m.h_a === "h");
      const awayMatches = team.history.filter((m) => m.h_a === "a");

      rawHistory.push({
        team: name,
        matches: team.history.map((m) => ({
          date: m.date, h_a: m.h_a, xG: m.xG, xGA: m.xGA,
          scored: m.scored, missed: m.missed,
        })),
      });

      venueSplits.push({
        team: name,
        home: aggregateMatches(name, homeMatches),
        away: aggregateMatches(name, awayMatches),
        overall: aggregateMatches(name, team.history),
      });
    }

    // Persist to cache (local + Blob) in background
    const entry: UnderstatCacheEntry = {
      league, season,
      fetchedAt: new Date().toISOString(),
      rawHistory, venueSplits,
    };
    saveUnderstatCache(entry).catch((e) =>
      console.warn("[understat] Cache save failed:", e)
    );

    return { rawHistory, venueSplits, source: "understat-live" };
  } catch (apiErr) {
    console.warn(`[understat] API failed for ${league}/${season}:`, apiErr);
  }

  // API failed — try cache
  const cached = await loadUnderstatCache(league, season);
  if (cached && cached.rawHistory.length > 0) {
    const ageHours = (Date.now() - new Date(cached.fetchedAt).getTime()) / 3600000;
    return {
      rawHistory: cached.rawHistory,
      venueSplits: cached.venueSplits,
      source: `cache (${ageHours.toFixed(0)}h old)`,
    };
  }

  throw new Error(`Understat data unavailable for ${league}/${season} (API down, no cache)`);
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
