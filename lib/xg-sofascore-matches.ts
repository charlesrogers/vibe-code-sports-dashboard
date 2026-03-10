/**
 * Per-match xG fetcher — originally targeting Sofascore, now using Understat
 *
 * Research findings (2026-03-10):
 *
 *   Sofascore API (api.sofascore.com/api/v1/...):
 *     - Returns 403 Forbidden for all endpoints, even with browser User-Agent,
 *       Referer, and Origin headers. Requires a valid browser session/cookies
 *       (likely Cloudflare bot protection). NOT freely accessible.
 *
 *   football-xg.com:
 *     - Domain is down (ECONNREFUSED). Not usable.
 *
 *   API-Football (api-sports.io):
 *     - Requires an API key. Free tier exists but xG availability is unclear
 *       without registering. Endpoints return 200 but require auth.
 *
 *   Understat (understat.com):
 *     - XHR endpoint `getLeagueData/{slug}/{season}` returns JSON freely.
 *     - The `dates` array contains per-match data with both teams, xG, goals.
 *     - Supports EPL, La Liga, Bundesliga, Ligue 1, Serie A.
 *     - Already used elsewhere in this project — proven reliable.
 *     => SELECTED as the data source.
 *
 * Data flow:
 *   1. Fetch league data from Understat XHR API
 *   2. Extract per-match records from the `dates` array
 *   3. Cache to disk for incremental fetching
 */

import * as fs from "fs";
import * as path from "path";
import { normalizeTeamName } from "./team-mapping";

// ─── Public interface ────────────────────────────────────────────────────────

export interface SofascoreMatchXg {
  matchId: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeXg: number;
  awayXg: number;
  homeGoals: number;
  awayGoals: number;
  league: string;
  season: string;
}

// ─── League configuration ────────────────────────────────────────────────────

/** Understat league slugs (used as the actual data source) */
const LEAGUE_CONFIG: Record<
  string,
  { slug: string; name: string; sofascoreTournamentId: number }
> = {
  epl: { slug: "EPL", name: "Premier League", sofascoreTournamentId: 17 },
  serieA: { slug: "Serie_A", name: "Serie A", sofascoreTournamentId: 23 },
  laLiga: { slug: "La_liga", name: "La Liga", sofascoreTournamentId: 8 },
  bundesliga: {
    slug: "Bundesliga",
    name: "Bundesliga",
    sofascoreTournamentId: 35,
  },
  ligue1: { slug: "Ligue_1", name: "Ligue 1", sofascoreTournamentId: 34 },
};

/** Aliases for convenience */
const LEAGUE_ALIASES: Record<string, string> = {
  "premier-league": "epl",
  premierleague: "epl",
  pl: "epl",
  "serie-a": "serieA",
  "la-liga": "laLiga",
  "ligue-1": "ligue1",
};

function resolveLeague(league: string): string {
  const lower = league.toLowerCase();
  return LEAGUE_ALIASES[lower] ?? (lower in LEAGUE_CONFIG ? lower : league);
}

// ─── HTTP helpers (matching xg-fotmob.ts style) ─────────────────────────────

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Encoding": "gzip, deflate",
  "X-Requested-With": "XMLHttpRequest",
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
    } as RequestInit);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Rate limiting ───────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Understat response types ────────────────────────────────────────────────

interface UnderstatDateEntry {
  id: string;
  isResult: boolean;
  h: { id: string; title: string; short_title: string };
  a: { id: string; title: string; short_title: string };
  goals: { h: string; a: string };
  xG: { h: string; a: string };
  datetime: string;
  forecast: { w: string; d: string; l: string };
}

interface UnderstatLeagueResponse {
  teams: Record<string, unknown>;
  players: Record<string, unknown>;
  dates: UnderstatDateEntry[];
}

// ─── Cache management ────────────────────────────────────────────────────────

const CACHE_DIR = path.join(
  process.cwd(),
  "data",
  "sofascore-match-xg"
);

function getCachePath(league: string, season: string): string {
  return path.join(CACHE_DIR, `${league}-${season}.json`);
}

function loadCache(league: string, season: string): SofascoreMatchXg[] {
  const cachePath = getCachePath(league, season);
  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, "utf-8");
      const data = JSON.parse(raw) as SofascoreMatchXg[];
      console.log(
        `[xg-matches] Loaded ${data.length} cached matches for ${league}/${season}`
      );
      return data;
    }
  } catch (err) {
    console.warn(`[xg-matches] Failed to load cache:`, err);
  }
  return [];
}

function saveCache(
  league: string,
  season: string,
  matches: SofascoreMatchXg[]
): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cachePath = getCachePath(league, season);
    fs.writeFileSync(cachePath, JSON.stringify(matches, null, 2));
    console.log(
      `[xg-matches] Saved ${matches.length} matches to ${cachePath}`
    );
  } catch (err) {
    console.warn(`[xg-matches] Failed to save cache:`, err);
  }
}

// ─── Main fetch function ─────────────────────────────────────────────────────

/**
 * Fetch per-match xG data for a given league and season.
 *
 * Uses Understat's XHR API (Sofascore is blocked — see header comment).
 * Implements incremental caching: only fetches from API if there are new
 * completed matches since the last cache.
 *
 * @param league - League key: "epl", "serieA", "laLiga", "bundesliga", "ligue1"
 *                 Also accepts aliases: "premier-league", "serie-a", etc.
 * @param season - Understat season year (e.g., "2025" for 2025/26 season).
 *                 Defaults to "2025" (current season).
 * @returns Array of SofascoreMatchXg sorted by date ascending.
 */
export async function fetchSofascoreMatchXg(
  league: string,
  season?: string
): Promise<SofascoreMatchXg[]> {
  const resolved = resolveLeague(league);
  const config = LEAGUE_CONFIG[resolved];

  if (!config) {
    console.warn(
      `[xg-matches] Unknown league "${league}" (resolved: "${resolved}"). ` +
        `Available: ${Object.keys(LEAGUE_CONFIG).join(", ")}`
    );
    return [];
  }

  const seasonStr = season ?? "2025";

  console.log(
    `[xg-matches] Fetching match xG for ${config.name} (${resolved}) season ${seasonStr}...`
  );

  // Load cached data
  const cached = loadCache(resolved, seasonStr);
  const cachedIds = new Set(cached.map((m) => m.matchId));

  // Rate limit: wait before API call
  await sleep(2000);

  try {
    const url = `https://understat.com/getLeagueData/${config.slug}/${seasonStr}`;
    console.log(`[xg-matches] Fetching from ${url}`);

    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      console.warn(`[xg-matches] Understat API returned ${res.status}`);
      if (cached.length > 0) {
        console.log(`[xg-matches] Returning ${cached.length} cached matches`);
        return cached;
      }
      return [];
    }

    const data: UnderstatLeagueResponse = await res.json();
    const dates = data.dates ?? [];

    if (dates.length === 0) {
      console.warn("[xg-matches] No match data returned from Understat");
      return cached;
    }

    // Filter to completed matches only
    const completed = dates.filter((d) => d.isResult);
    console.log(
      `[xg-matches] Found ${completed.length} completed matches (${dates.length} total scheduled)`
    );

    // Find new matches not in cache
    const newMatches: SofascoreMatchXg[] = [];
    let processedCount = 0;

    for (const match of completed) {
      const matchId = parseInt(match.id, 10);
      processedCount++;

      // Print progress every 10 matches
      if (processedCount % 10 === 0) {
        console.log(
          `[xg-matches] Processing match ${processedCount}/${completed.length}...`
        );
      }

      if (cachedIds.has(matchId)) {
        continue; // Already cached
      }

      const homeXg = parseFloat(match.xG.h);
      const awayXg = parseFloat(match.xG.a);

      if (isNaN(homeXg) || isNaN(awayXg)) {
        console.warn(
          `[xg-matches] Invalid xG for match ${matchId}: h=${match.xG.h}, a=${match.xG.a}`
        );
        continue;
      }

      newMatches.push({
        matchId,
        date: match.datetime.split(" ")[0], // "2024-08-16"
        homeTeam: normalizeTeamName(match.h.title, "understat"),
        awayTeam: normalizeTeamName(match.a.title, "understat"),
        homeXg: Math.round(homeXg * 1000) / 1000,
        awayXg: Math.round(awayXg * 1000) / 1000,
        homeGoals: parseInt(match.goals.h, 10),
        awayGoals: parseInt(match.goals.a, 10),
        league: resolved,
        season: seasonStr,
      });
    }

    if (newMatches.length > 0) {
      console.log(
        `[xg-matches] Found ${newMatches.length} new matches to add to cache`
      );
    } else {
      console.log("[xg-matches] Cache is up to date, no new matches");
    }

    // Merge and sort by date
    const allMatches = [...cached, ...newMatches].sort(
      (a, b) => a.date.localeCompare(b.date) || a.matchId - b.matchId
    );

    // Save updated cache
    if (newMatches.length > 0) {
      saveCache(resolved, seasonStr, allMatches);
    }

    console.log(
      `[xg-matches] Returning ${allMatches.length} total matches for ${config.name} ${seasonStr}`
    );

    return allMatches;
  } catch (err) {
    console.error(`[xg-matches] Failed to fetch match xG:`, err);
    if (cached.length > 0) {
      console.log(
        `[xg-matches] Returning ${cached.length} cached matches (API failed)`
      );
      return cached;
    }
    return [];
  }
}

// ─── List available leagues ──────────────────────────────────────────────────

/**
 * Returns the list of available league keys that can be passed to
 * fetchSofascoreMatchXg().
 */
export function getAvailableSofascoreLeagues(): string[] {
  return Object.keys(LEAGUE_CONFIG);
}

// ─── Convenience: fetch multiple leagues ─────────────────────────────────────

/**
 * Fetch match xG for all supported leagues in a single call.
 * Rate-limits between each league request.
 */
export async function fetchAllLeaguesMatchXg(
  season?: string
): Promise<SofascoreMatchXg[]> {
  const leagues = getAvailableSofascoreLeagues();
  const allMatches: SofascoreMatchXg[] = [];

  for (const league of leagues) {
    const matches = await fetchSofascoreMatchXg(league, season);
    allMatches.push(...matches);
    // Extra delay between leagues to be respectful
    await sleep(3000);
  }

  return allMatches.sort(
    (a, b) => a.date.localeCompare(b.date) || a.matchId - b.matchId
  );
}
