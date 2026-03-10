/**
 * Fotmob xG data fetcher — standalone alternative xG source
 *
 * Fetches team-level xG data from Fotmob's public stats API.
 * Supports EPL, Serie A, Serie B, La Liga, Bundesliga, and Ligue 1.
 *
 * Data flow:
 *   1. Hit /api/leagues?id={leagueId} to discover current season stat URLs
 *   2. Fetch xG and xGA stat endpoints in parallel
 *   3. Merge into XgTeamData array
 *
 * This is separate from the existing lib/fotmob.ts to serve as a
 * standalone fallback xG source with broader league support.
 */

import type { TeamXg } from "./types";

// ─── Public interface ────────────────────────────────────────────────────────

export interface XgTeamData {
  team: string;
  xGFor: number;
  xGAgainst: number;
  goalsFor: number;
  goalsAgainst: number;
  matches: number;
  xGDiff: number;
}

// ─── Fotmob internals ────────────────────────────────────────────────────────

interface FotmobStatEntry {
  ParticipantName: string;
  TeamId: number;
  StatValue: number;
  SubStatValue: number;
  MatchesPlayed: number;
  Rank: number;
  ParticipantCountryCode: string;
}

interface FotmobStatResponse {
  TopLists: {
    StatName: string;
    StatList: FotmobStatEntry[];
  }[];
}

interface FotmobStatCategory {
  header: string;
  fetchAllUrl: string;
}

// League IDs on Fotmob
const FOTMOB_LEAGUE_IDS: Record<string, number> = {
  premierLeague: 47,
  serieA: 55,
  serieB: 53,
  laLiga: 87,
  bundesliga: 54,
  ligue1: 53,
};

// Aliases for convenience
const LEAGUE_ALIASES: Record<string, string> = {
  epl: "premierLeague",
  pl: "premierLeague",
  "premier-league": "premierLeague",
  "serie-a": "serieA",
  "serie-b": "serieB",
  "la-liga": "laLiga",
  "ligue-1": "ligue1",
};

function resolveLeague(league: string): string {
  return LEAGUE_ALIASES[league.toLowerCase()] ?? league;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Encoding": "gzip, deflate",
};

async function fetchWithTimeout(
  url: string,
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
      // Next.js extended fetch options (revalidation handled at route level)
    } as RequestInit);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchStatList(url: string): Promise<FotmobStatEntry[]> {
  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    throw new Error(`Fotmob stat endpoint returned ${res.status}: ${url}`);
  }
  const data: FotmobStatResponse = await res.json();
  return data.TopLists?.[0]?.StatList ?? [];
}

// ─── Discover stat URLs from the leagues API ─────────────────────────────────

interface StatUrls {
  xgUrl: string;
  xgaUrl: string;
  goalsUrl: string;
  gaUrl: string;
  seasonId: string;
}

async function discoverStatUrls(
  leagueId: number
): Promise<StatUrls | null> {
  const url = `https://www.fotmob.com/api/leagues?id=${leagueId}&ccode3=USA`;
  console.log(`[xg-fotmob] Discovering stat URLs for league ${leagueId}...`);

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    console.warn(`[xg-fotmob] Leagues API returned ${res.status}`);
    return null;
  }

  const data = await res.json();
  const teamStats: FotmobStatCategory[] = data?.stats?.teams ?? [];

  if (teamStats.length === 0) {
    console.warn("[xg-fotmob] No team stats found in leagues response");
    return null;
  }

  console.log(
    `[xg-fotmob] Found ${teamStats.length} stat categories: ${teamStats.map((s) => s.header).join(", ")}`
  );

  const find = (keyword: string): string | undefined =>
    teamStats.find((s) => s.fetchAllUrl?.includes(keyword))?.fetchAllUrl;

  const xgUrl = find("expected_goals_team.");
  const xgaUrl = find("expected_goals_conceded_team.");
  const goalsUrl = find("goals_team_match.");
  const gaUrl = find("goals_conceded_team_match.");

  if (!xgUrl || !xgaUrl) {
    console.warn("[xg-fotmob] Missing xG or xGA stat URLs");
    return null;
  }

  // Extract season ID from URL (e.g., .../season/27110/...)
  const seasonMatch = xgUrl.match(/season\/(\d+)\//);
  const seasonId = seasonMatch?.[1] ?? "unknown";

  console.log(`[xg-fotmob] Season ID: ${seasonId}`);

  return {
    xgUrl,
    xgaUrl,
    goalsUrl: goalsUrl ?? "",
    gaUrl: gaUrl ?? "",
    seasonId,
  };
}

// ─── Main fetch function ─────────────────────────────────────────────────────

/**
 * Fetch team-level xG data from Fotmob for a given league.
 *
 * @param league - League key: "premierLeague", "serieA", "laLiga", etc.
 *                 Also accepts aliases: "epl", "pl", "serie-a", etc.
 * @returns Array of XgTeamData sorted by xGDiff descending.
 *          Returns empty array on failure (never throws).
 */
export async function fetchXgFromFotmob(
  league: string = "premierLeague"
): Promise<XgTeamData[]> {
  const resolved = resolveLeague(league);
  const leagueId = FOTMOB_LEAGUE_IDS[resolved];

  if (!leagueId) {
    console.warn(
      `[xg-fotmob] Unknown league "${league}" (resolved: "${resolved}"). Available: ${Object.keys(FOTMOB_LEAGUE_IDS).join(", ")}`
    );
    return [];
  }

  try {
    console.log(
      `[xg-fotmob] Fetching xG data for ${resolved} (Fotmob ID: ${leagueId})...`
    );

    // Step 1: Discover stat URLs
    const urls = await discoverStatUrls(leagueId);
    if (!urls) {
      console.warn(`[xg-fotmob] Could not discover stat URLs for ${resolved}`);
      return [];
    }

    // Step 2: Fetch xG and xGA in parallel
    console.log("[xg-fotmob] Fetching xG and xGA stats in parallel...");
    const [xgEntries, xgaEntries] = await Promise.all([
      fetchStatList(urls.xgUrl),
      fetchStatList(urls.xgaUrl),
    ]);

    console.log(
      `[xg-fotmob] Got ${xgEntries.length} xG entries, ${xgaEntries.length} xGA entries`
    );

    if (xgEntries.length === 0) {
      console.warn("[xg-fotmob] No xG entries returned");
      return [];
    }

    // Step 3: Build xGA lookup
    const xgaMap = new Map<string, FotmobStatEntry>();
    for (const entry of xgaEntries) {
      xgaMap.set(entry.ParticipantName, entry);
    }

    // Step 4: Merge into results
    const results: XgTeamData[] = [];

    for (const entry of xgEntries) {
      const xGFor = entry.StatValue;
      const goalsFor = entry.SubStatValue;
      const matches = entry.MatchesPlayed;

      const xgaEntry = xgaMap.get(entry.ParticipantName);
      const xGAgainst = xgaEntry?.StatValue ?? 0;
      const goalsAgainst = xgaEntry?.SubStatValue ?? 0;

      results.push({
        team: entry.ParticipantName,
        xGFor: Math.round(xGFor * 100) / 100,
        xGAgainst: Math.round(xGAgainst * 100) / 100,
        goalsFor,
        goalsAgainst,
        matches,
        xGDiff: Math.round((xGFor - xGAgainst) * 100) / 100,
      });
    }

    console.log(
      `[xg-fotmob] Successfully fetched ${results.length} teams for ${resolved}`
    );

    return results.sort((a, b) => b.xGDiff - a.xGDiff);
  } catch (err) {
    console.error(`[xg-fotmob] Failed to fetch xG for ${resolved}:`, err);
    return [];
  }
}

// ─── Convenience: convert to TeamXg for compatibility ────────────────────────

/**
 * Fetch Fotmob xG data and return it in the app's standard TeamXg format.
 * Useful as a drop-in replacement for Understat when it's down.
 */
export async function fetchTeamXgFromFotmobAlt(
  league: string = "premierLeague"
): Promise<TeamXg[]> {
  const data = await fetchXgFromFotmob(league);
  return data.map((d) => ({
    team: d.team,
    xGFor: d.xGFor,
    xGAgainst: d.xGAgainst,
    goalsFor: d.goalsFor,
    goalsAgainst: d.goalsAgainst,
    xGDiff: d.xGDiff,
    overperformance: Math.round((d.goalsFor - d.xGFor) * 100) / 100,
    matches: d.matches,
  }));
}

// ─── List available leagues ──────────────────────────────────────────────────

export function getAvailableFotmobLeagues(): string[] {
  return Object.keys(FOTMOB_LEAGUE_IDS);
}
