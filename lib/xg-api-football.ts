/**
 * API-Football (api-sports.io) per-match xG fetcher
 *
 * Free tier: 100 requests/day, no auth credit card required.
 * xG is in fixture statistics under "expected_goals".
 *
 * Strategy:
 *   1. One request gets ALL fixtures for a league/season (380 for EPL)
 *   2. One request per fixture gets statistics (including xG)
 *   3. Cache locally — once a match is finished, its xG never changes
 *   4. Rate limit: 2s between requests, stop at daily quota
 *
 * At 100 req/day: ~4 days to backfill a full EPL season.
 * Daily use: 1 (fixtures) + ~10 (yesterday's matches) = ~11 requests.
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiFootballMatchXg {
  fixtureId: number;
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

interface ApiFixture {
  fixture: {
    id: number;
    date: string;
    status: { short: string };
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
}

interface ApiStatEntry {
  type: string;
  value: string | number | null;
}

interface ApiStatTeam {
  team: { id: number; name: string };
  statistics: ApiStatEntry[];
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = "https://v3.football.api-sports.io";

// API-Football league IDs
const LEAGUE_IDS: Record<string, number> = {
  premierLeague: 39,
  serieA: 135,
  laLiga: 140,
  bundesliga: 78,
  ligue1: 61,
  championship: 40,
};

const LEAGUE_ALIASES: Record<string, string> = {
  epl: "premierLeague",
  pl: "premierLeague",
  "premier-league": "premierLeague",
  "serie-a": "serieA",
  "la-liga": "laLiga",
  "ligue-1": "ligue1",
};

// Map our season format to API-Football's year format
// "2024-25" → 2024, "2025-26" → 2025
function seasonToApiYear(season: string): number {
  return parseInt(season.split("-")[0]);
}

// Default season based on current date
function currentSeason(): string {
  const now = new Date();
  const year = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const nextShort = (year + 1).toString().slice(2);
  return `${year}-${nextShort}`;
}

function resolveLeague(league: string): string {
  return LEAGUE_ALIASES[league.toLowerCase()] ?? league;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY environment variable not set");
  return key;
}

async function apiFetch<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "x-apisports-key": getApiKey(),
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`API-Football returned ${res.status}: ${url.pathname}`);
    }

    const data = await res.json();

    // Check for API-level errors
    if (data.errors && Object.keys(data.errors).length > 0) {
      const errMsg = Object.values(data.errors).join("; ");
      throw new Error(`API-Football error: ${errMsg}`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_DIR = path.join(process.cwd(), "data", "api-football-xg");

function cacheFilePath(league: string, season: string): string {
  return path.join(CACHE_DIR, `${league}-${season}.json`);
}

function loadCache(league: string, season: string): ApiFootballMatchXg[] {
  try {
    const fp = cacheFilePath(league, season);
    if (!fs.existsSync(fp)) return [];
    return JSON.parse(fs.readFileSync(fp, "utf-8"));
  } catch {
    return [];
  }
}

function saveCache(league: string, season: string, data: ApiFootballMatchXg[]): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheFilePath(league, season), JSON.stringify(data, null, 2));
  } catch (e) {
    console.error(`[api-football] Failed to save cache:`, e);
  }
}

// ---------------------------------------------------------------------------
// Main fetch
// ---------------------------------------------------------------------------

export interface FetchOptions {
  /** Max fixture stats to fetch this run (respects daily quota). Default: 90 */
  maxRequests?: number;
  /** Only fetch matches on or after this date (ISO string) */
  since?: string;
}

/**
 * Fetch per-match xG from API-Football.
 *
 * Loads cache first, then fetches only missing fixture stats.
 * Rate limited: 2s between requests. Prints progress every 10 matches.
 *
 * @returns All cached + newly fetched matches for the league/season.
 */
export async function fetchApiFootballXg(
  league: string = "premierLeague",
  season?: string,
  opts?: FetchOptions
): Promise<ApiFootballMatchXg[]> {
  const resolved = resolveLeague(league);
  const leagueId = LEAGUE_IDS[resolved];
  const seasonStr = season ?? currentSeason();
  const apiYear = seasonToApiYear(seasonStr);
  const maxReqs = opts?.maxRequests ?? 90;

  if (!leagueId) {
    console.warn(
      `[api-football] Unknown league "${league}". Available: ${Object.keys(LEAGUE_IDS).join(", ")}`
    );
    return [];
  }

  // Load existing cache
  const cached = loadCache(resolved, seasonStr);
  const cachedIds = new Set(cached.map((m) => m.fixtureId));
  console.log(`[api-football] Cache has ${cached.length} matches for ${resolved} ${seasonStr}`);

  try {
    // Step 1: Fetch all fixtures for the season (1 request)
    console.log(`[api-football] Fetching fixture list for ${resolved} ${seasonStr} (league ${leagueId}, year ${apiYear})...`);
    const fixturesData = await apiFetch<{ response: ApiFixture[]; results: number }>(
      "fixtures",
      { league: leagueId.toString(), season: apiYear.toString() }
    );

    const allFixtures = fixturesData.response ?? [];
    console.log(`[api-football] Got ${allFixtures.length} total fixtures`);

    // Filter to finished matches not already cached
    let uncached = allFixtures.filter(
      (f) => f.fixture.status.short === "FT" && !cachedIds.has(f.fixture.id)
    );

    // Optional date filter
    if (opts?.since) {
      uncached = uncached.filter((f) => f.fixture.date >= opts.since!);
    }

    // Sort by date (oldest first for backfilling)
    uncached.sort((a, b) => a.fixture.date.localeCompare(b.fixture.date));

    if (uncached.length === 0) {
      console.log(`[api-football] All finished matches already cached`);
      return cached;
    }

    console.log(
      `[api-football] ${uncached.length} finished matches need xG data. ` +
      `Fetching up to ${maxReqs} (rate limit: 2s/req)...`
    );

    // Step 2: Fetch stats for each uncached fixture
    const toFetch = uncached.slice(0, maxReqs);
    const newResults: ApiFootballMatchXg[] = [];
    let fetched = 0;

    for (const fix of toFetch) {
      try {
        if (fetched > 0) await sleep(7000); // Rate limit: free plan = 10 req/min

        const statsData = await apiFetch<{ response: ApiStatTeam[] }>(
          "fixtures/statistics",
          { fixture: fix.fixture.id.toString() }
        );

        const teams = statsData.response ?? [];
        let homeXg = 0;
        let awayXg = 0;

        for (const team of teams) {
          const xgStat = team.statistics.find((s) => s.type === "expected_goals");
          const xg = xgStat?.value != null ? parseFloat(String(xgStat.value)) : 0;

          if (team.team.name === fix.teams.home.name || team.team.id === fix.teams.home.id) {
            homeXg = xg;
          } else {
            awayXg = xg;
          }
        }

        newResults.push({
          fixtureId: fix.fixture.id,
          date: fix.fixture.date.slice(0, 10),
          homeTeam: fix.teams.home.name,
          awayTeam: fix.teams.away.name,
          homeXg: Math.round(homeXg * 100) / 100,
          awayXg: Math.round(awayXg * 100) / 100,
          homeGoals: fix.goals.home ?? 0,
          awayGoals: fix.goals.away ?? 0,
          league: resolved,
          season: seasonStr,
        });

        fetched++;
        if (fetched % 10 === 0 || fetched === toFetch.length) {
          console.log(
            `[api-football] Fetched ${fetched}/${toFetch.length} matches ` +
            `(${uncached.length - fetched} remaining after this batch)`
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[api-football] Failed fixture ${fix.fixture.id}: ${msg}`);
        // If it's a quota error, stop
        if (msg.includes("limit") || msg.includes("429") || msg.includes("Too many")) {
          console.warn(`[api-football] Hit rate limit, stopping. Run again tomorrow.`);
          break;
        }
      }
    }

    // Merge and save
    const merged = [...cached, ...newResults];
    // Deduplicate by fixtureId
    const deduped = Array.from(
      new Map(merged.map((m) => [m.fixtureId, m])).values()
    );
    saveCache(resolved, seasonStr, deduped);

    console.log(
      `[api-football] Done. ${newResults.length} new matches fetched. ` +
      `Total cached: ${deduped.length}/${allFixtures.filter((f) => f.fixture.status.short === "FT").length} finished.`
    );

    return deduped;
  } catch (e) {
    console.error(`[api-football] Error:`, e);
    // Return cache on failure
    return cached;
  }
}

// ---------------------------------------------------------------------------
// Convenience
// ---------------------------------------------------------------------------

export function getAvailableApiFootballLeagues(): string[] {
  return Object.keys(LEAGUE_IDS);
}

/**
 * Check remaining API quota for today.
 */
export async function checkApiFootballQuota(): Promise<{
  used: number;
  limit: number;
  remaining: number;
}> {
  const data = await apiFetch<{
    response: { requests: { current: number; limit_day: number } };
  }>("status", {});
  const r = data.response.requests;
  return {
    used: r.current,
    limit: r.limit_day,
    remaining: r.limit_day - r.current,
  };
}
