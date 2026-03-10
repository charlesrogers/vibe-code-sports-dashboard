/**
 * Fotmob match-level xG data fetcher
 *
 * Fetches per-match xG data from Fotmob's public API.
 * Supports EPL, Serie A, La Liga, Bundesliga, and Ligue 1.
 *
 * Data flow:
 *   1. Hit /api/leagues?id={leagueId} to get the fixture list (all matches)
 *   2. For each completed match, hit /api/matchDetails?matchId={id} to get xG
 *   3. Cache results locally — completed match xG never changes
 *   4. On subsequent calls, only fetch NEW (uncached) matches
 *
 * Rate limiting: 1 request per 2 seconds to avoid Fotmob blocks.
 */

import * as fs from "fs";
import * as path from "path";

// ─── Public interface ────────────────────────────────────────────────────────

export interface FotmobMatchXg {
  matchId: number;
  date: string; // ISO date
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

const FOTMOB_MATCH_LEAGUE_IDS: Record<string, number> = {
  premierLeague: 47,
  serieA: 55,
  laLiga: 87,
  bundesliga: 54,
  ligue1: 53,
};

const LEAGUE_ALIASES: Record<string, string> = {
  epl: "premierLeague",
  pl: "premierLeague",
  "premier-league": "premierLeague",
  "serie-a": "serieA",
  "la-liga": "laLiga",
  "ligue-1": "ligue1",
};

const LEAGUE_DISPLAY_NAMES: Record<string, string> = {
  premierLeague: "Premier League",
  serieA: "Serie A",
  laLiga: "La Liga",
  bundesliga: "Bundesliga",
  ligue1: "Ligue 1",
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
    } as RequestInit);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Cache helpers ───────────────────────────────────────────────────────────

const CACHE_DIR = path.join(
  process.cwd(),
  "data",
  "fotmob-match-xg"
);

function getCachePath(league: string, season: string): string {
  return path.join(CACHE_DIR, `${league}-${season}.json`);
}

function loadCache(league: string, season: string): FotmobMatchXg[] {
  const cachePath = getCachePath(league, season);
  try {
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, "utf-8");
      const data = JSON.parse(raw) as FotmobMatchXg[];
      console.log(
        `[xg-fotmob-matches] Loaded ${data.length} cached matches from ${cachePath}`
      );
      return data;
    }
  } catch (err) {
    console.warn(`[xg-fotmob-matches] Failed to load cache: ${err}`);
  }
  return [];
}

function saveCache(
  league: string,
  season: string,
  data: FotmobMatchXg[]
): void {
  const cachePath = getCachePath(league, season);
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2), "utf-8");
    console.log(
      `[xg-fotmob-matches] Saved ${data.length} matches to ${cachePath}`
    );
  } catch (err) {
    console.warn(`[xg-fotmob-matches] Failed to save cache: ${err}`);
  }
}

// ─── Fotmob API types (internal) ────────────────────────────────────────────

interface FotmobLeagueMatch {
  id: number;
  home: { name: string; id: number };
  away: { name: string; id: number };
  status: { finished: boolean; started: boolean; cancelled: boolean };
  timeTS?: number;
  roundId?: number;
  round?: number;
  // Score can appear in different places depending on API version
  homeScore?: number;
  awayScore?: number;
  home_score?: number;
  away_score?: number;
}

// ─── Discover matches from the leagues API ──────────────────────────────────

interface LeagueMatchList {
  matches: FotmobLeagueMatch[];
  seasonName: string;
}

async function discoverMatches(
  leagueId: number
): Promise<LeagueMatchList | null> {
  const url = `https://www.fotmob.com/api/leagues?id=${leagueId}&ccode3=USA`;
  console.log(
    `[xg-fotmob-matches] Fetching league fixture list (leagueId=${leagueId})...`
  );

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    console.warn(
      `[xg-fotmob-matches] Leagues API returned ${res.status}`
    );
    return null;
  }

  const data = await res.json();

  // Extract season name from the response
  const seasonName: string =
    data?.details?.selectedSeason ??
    data?.details?.name ??
    data?.seasons?.[0]?.name ??
    "unknown";

  // Fotmob structures matches in different ways — try common paths
  let allMatches: FotmobLeagueMatch[] = [];

  // Path 1: matches.allMatches (array of rounds with matches)
  if (data?.matches?.allMatches) {
    const rounds = data.matches.allMatches;
    if (Array.isArray(rounds)) {
      for (const round of rounds) {
        if (Array.isArray(round)) {
          allMatches.push(...round);
        } else if (round?.matches && Array.isArray(round.matches)) {
          allMatches.push(...round.matches);
        } else if (round?.id !== undefined) {
          // Individual match object
          allMatches.push(round);
        }
      }
    }
  }

  // Path 2: matches.data.allMatches (nested data)
  if (allMatches.length === 0 && data?.matches?.data?.allMatches) {
    const nested = data.matches.data.allMatches;
    if (Array.isArray(nested)) {
      for (const item of nested) {
        if (Array.isArray(item)) {
          allMatches.push(...item);
        } else if (item?.id !== undefined) {
          allMatches.push(item);
        }
      }
    }
  }

  // Path 3: Flat array at matches level
  if (allMatches.length === 0 && Array.isArray(data?.matches)) {
    allMatches = data.matches;
  }

  console.log(
    `[xg-fotmob-matches] Found ${allMatches.length} total matches for season "${seasonName}"`
  );

  return { matches: allMatches, seasonName };
}

// ─── Fetch xG for a single match ────────────────────────────────────────────

async function fetchMatchXg(
  matchId: number,
  league: string,
  season: string,
  homeTeamFallback: string,
  awayTeamFallback: string
): Promise<FotmobMatchXg | null> {
  const url = `https://www.fotmob.com/api/matchDetails?matchId=${matchId}`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    console.warn(
      `[xg-fotmob-matches] matchDetails returned ${res.status} for matchId=${matchId}`
    );
    return null;
  }

  const data = await res.json();

  // Extract team names
  const homeTeam: string =
    data?.general?.homeTeam?.name ??
    data?.header?.teams?.[0]?.name ??
    homeTeamFallback;
  const awayTeam: string =
    data?.general?.awayTeam?.name ??
    data?.header?.teams?.[1]?.name ??
    awayTeamFallback;

  // Extract match date
  const matchDate: string =
    data?.general?.matchTimeUTCDate ??
    data?.general?.matchDate ??
    "";

  // Extract score
  const homeGoals: number =
    data?.header?.teams?.[0]?.score ??
    data?.general?.homeTeam?.score ??
    0;
  const awayGoals: number =
    data?.header?.teams?.[1]?.score ??
    data?.general?.awayTeam?.score ??
    0;

  // Extract xG — search through multiple possible locations
  let homeXg = 0;
  let awayXg = 0;
  let foundXg = false;

  // Location 1: content.stats.Ede... (stats periods)
  const statsContent = data?.content?.stats;
  if (statsContent?.Ede) {
    // Fotmob uses "Periods" with stats inside
    for (const period of Object.values(statsContent.Ere ?? statsContent.Ede ?? {})) {
      // Check each period
    }
  }

  // Location 2: content.stats as array of stat groups
  if (!foundXg && statsContent) {
    const statSections = Array.isArray(statsContent)
      ? statsContent
      : statsContent?.Ede ?? [];

    if (Array.isArray(statSections)) {
      for (const section of statSections) {
        const stats = section?.stats ?? section?.entries ?? [];
        if (Array.isArray(stats)) {
          for (const stat of stats) {
            const title =
              (stat?.title ?? stat?.key ?? "").toLowerCase();
            if (
              title.includes("expected_goals") ||
              title.includes("expected goals") ||
              title === "xg"
            ) {
              // stat values can be [homeVal, awayVal] or {home, away}
              if (Array.isArray(stat.stats)) {
                homeXg = parseFloat(stat.stats[0]) || 0;
                awayXg = parseFloat(stat.stats[1]) || 0;
                foundXg = true;
              } else if (stat.home !== undefined) {
                homeXg = parseFloat(stat.home) || 0;
                awayXg = parseFloat(stat.away) || 0;
                foundXg = true;
              }
              break;
            }
          }
        }
        if (foundXg) break;
      }
    }
  }

  // Location 3: content.matchFacts.xg or expectedGoals
  if (!foundXg) {
    const matchFacts = data?.content?.matchFacts;
    if (matchFacts) {
      // Direct xG object
      const xgObj =
        matchFacts?.xg ?? matchFacts?.expectedGoals;
      if (xgObj) {
        if (Array.isArray(xgObj)) {
          homeXg = parseFloat(xgObj[0]) || 0;
          awayXg = parseFloat(xgObj[1]) || 0;
          foundXg = true;
        } else if (typeof xgObj === "object") {
          homeXg = parseFloat(xgObj.home ?? xgObj[0]) || 0;
          awayXg = parseFloat(xgObj.away ?? xgObj[1]) || 0;
          foundXg = true;
        }
      }

      // xG might be in matchFacts.infoBox or events
      if (!foundXg && matchFacts?.infoBox) {
        const infoBox = matchFacts.infoBox;
        if (infoBox?.["Expected goals"]) {
          const xgInfo = infoBox["Expected goals"];
          if (xgInfo?.homeValue !== undefined) {
            homeXg = parseFloat(xgInfo.homeValue) || 0;
            awayXg = parseFloat(xgInfo.awayValue) || 0;
            foundXg = true;
          }
        }
      }
    }
  }

  // Location 4: Deep search — walk through all stat groups
  if (!foundXg) {
    const allStats =
      data?.content?.stats?.Ede ??
      data?.content?.stats?.stats ??
      data?.content?.stats;

    if (allStats && typeof allStats === "object") {
      const searchObj = (obj: unknown): boolean => {
        if (!obj || typeof obj !== "object") return false;
        const record = obj as Record<string, unknown>;

        // Check if this object has xG-related keys
        for (const [key, val] of Object.entries(record)) {
          const lk = key.toLowerCase();
          if (
            lk.includes("expected_goals") ||
            lk.includes("expectedgoals") ||
            lk === "xg"
          ) {
            if (Array.isArray(val) && val.length >= 2) {
              homeXg = parseFloat(String(val[0])) || 0;
              awayXg = parseFloat(String(val[1])) || 0;
              return true;
            }
            if (typeof val === "object" && val !== null) {
              const v = val as Record<string, unknown>;
              if (v.home !== undefined || v[0] !== undefined) {
                homeXg =
                  parseFloat(String(v.home ?? v[0])) || 0;
                awayXg =
                  parseFloat(String(v.away ?? v[1])) || 0;
                return true;
              }
            }
          }
        }

        // Recurse into arrays and objects (max 3 levels deep)
        for (const val of Object.values(record)) {
          if (Array.isArray(val)) {
            for (const item of val) {
              if (searchObj(item)) return true;
            }
          } else if (typeof val === "object" && val !== null) {
            if (searchObj(val)) return true;
          }
        }

        return false;
      };

      foundXg = searchObj(allStats);
    }
  }

  if (!foundXg) {
    // xG not available for this match (may be too old or data not provided)
    return null;
  }

  return {
    matchId,
    date: matchDate,
    homeTeam,
    awayTeam,
    homeXg: Math.round(homeXg * 100) / 100,
    awayXg: Math.round(awayXg * 100) / 100,
    homeGoals,
    awayGoals,
    league,
    season,
  };
}

// ─── Main fetch function ─────────────────────────────────────────────────────

/**
 * Fetch match-level xG data from Fotmob for a given league.
 *
 * Caches results locally — completed match xG never changes.
 * On subsequent calls, only fetches NEW matches not already in cache.
 *
 * Rate limited: 1 request per 2 seconds.
 *
 * @param league - League key: "premierLeague", "serieA", "laLiga", etc.
 *                 Also accepts aliases: "epl", "pl", "serie-a", etc.
 * @param season - Optional season override (auto-detected from Fotmob if omitted)
 * @returns Array of FotmobMatchXg for all completed matches with xG data.
 */
export async function fetchFotmobMatchXg(
  league: string,
  season?: string
): Promise<FotmobMatchXg[]> {
  const resolved = resolveLeague(league);
  const leagueId = FOTMOB_MATCH_LEAGUE_IDS[resolved];
  const displayName = LEAGUE_DISPLAY_NAMES[resolved] ?? resolved;

  if (!leagueId) {
    console.warn(
      `[xg-fotmob-matches] Unknown league "${league}" (resolved: "${resolved}"). Available: ${Object.keys(FOTMOB_MATCH_LEAGUE_IDS).join(", ")}`
    );
    return [];
  }

  try {
    console.log(
      `[xg-fotmob-matches] Fetching match xG data for ${displayName} (Fotmob ID: ${leagueId})...`
    );

    // Step 1: Get the match list from the leagues API
    const leagueData = await discoverMatches(leagueId);
    if (!leagueData || leagueData.matches.length === 0) {
      console.warn(
        `[xg-fotmob-matches] No matches found for ${displayName}`
      );
      return [];
    }

    const seasonName = season ?? leagueData.seasonName;

    // Step 2: Load cached results
    const cached = loadCache(resolved, seasonName);
    const cachedIds = new Set(cached.map((m) => m.matchId));

    // Step 3: Filter to completed matches not yet cached
    const completedMatches = leagueData.matches.filter(
      (m) =>
        m.status?.finished === true &&
        !m.status?.cancelled &&
        !cachedIds.has(m.id)
    );

    console.log(
      `[xg-fotmob-matches] ${cached.length} matches already cached, ${completedMatches.length} new completed matches to fetch`
    );

    if (completedMatches.length === 0) {
      console.log(
        `[xg-fotmob-matches] All completed matches are already cached. Returning ${cached.length} matches.`
      );
      return cached;
    }

    // Step 4: Fetch xG for each uncached match with rate limiting
    const newMatches: FotmobMatchXg[] = [];
    let fetchedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < completedMatches.length; i++) {
      const match = completedMatches[i];

      // Rate limit: wait 2 seconds between requests
      if (i > 0) {
        await sleep(2000);
      }

      const result = await fetchMatchXg(
        match.id,
        displayName,
        seasonName,
        match.home?.name ?? "Unknown",
        match.away?.name ?? "Unknown"
      );

      if (result) {
        newMatches.push(result);
        fetchedCount++;
      } else {
        skippedCount++;
      }

      // Progress logging every 10 matches
      const processed = i + 1;
      if (processed % 10 === 0 || processed === completedMatches.length) {
        console.log(
          `[xg-fotmob-matches] Fetched ${processed}/${completedMatches.length} matches (${fetchedCount} with xG, ${skippedCount} skipped)...`
        );
      }
    }

    console.log(
      `[xg-fotmob-matches] Done! ${fetchedCount} new matches with xG, ${skippedCount} without xG data.`
    );

    // Step 5: Merge with cache and save
    const allMatches = [...cached, ...newMatches];

    // Sort by date descending (most recent first)
    allMatches.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    );

    saveCache(resolved, seasonName, allMatches);

    return allMatches;
  } catch (err) {
    console.error(
      `[xg-fotmob-matches] Failed to fetch match xG for ${displayName}:`,
      err
    );
    // Return cached data if available
    const seasonName = season ?? "unknown";
    const cached = loadCache(resolved, seasonName);
    if (cached.length > 0) {
      console.log(
        `[xg-fotmob-matches] Returning ${cached.length} cached matches despite error.`
      );
      return cached;
    }
    return [];
  }
}

// ─── List available leagues ──────────────────────────────────────────────────

export function getAvailableFotmobMatchLeagues(): string[] {
  return Object.keys(FOTMOB_MATCH_LEAGUE_IDS);
}
