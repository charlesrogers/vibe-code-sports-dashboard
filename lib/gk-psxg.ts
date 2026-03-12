/**
 * Goalkeeper PSxG+/- (Goals Prevented) & Player Minutes from Fotmob
 *
 * Ted's Playbook Section 12: Goalkeeper quality is the "hidden variable"
 * that determines whether defensive xGA divergence will actually regress.
 *
 * Data source: Fotmob's data.fotmob.com stat endpoints (no Cloudflare)
 * - Goals prevented (PSxG+/-): per-GK quality metric
 * - Minutes played: per-player, used to filter bench players from injury model
 *
 * Caching: 24h in-memory + JSON file cache in data/fbref-cache/
 */

import fs from "fs";
import path from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GKStats {
  player: string;
  playerId: number;
  team: string;
  teamId: number;
  goalsPrevented: number;  // PSxG+/- — positive = saving more than expected
  goalsAgainst: number;
  matchesPlayed: number;
  /** Normalized per 90 minutes */
  goalsPreventedPer90: number;
}

export interface PlayerMinutes {
  player: string;
  playerId: number;
  team: string;
  teamId: number;
  minutes: number;
  matchesPlayed: number;
  positions: number[];  // Fotmob position IDs (11 = GK)
  isGoalkeeper: boolean;
}

// ─── Fotmob league config ───────────────────────────────────────────────────

const FOTMOB_LEAGUE_IDS: Record<string, number> = {
  epl: 47,
  premierLeague: 47,
  "serie-a": 55,
  serieA: 55,
  "la-liga": 87,
  laLiga: 87,
  bundesliga: 54,
  championship: 48,
};

// ─── Cache ──────────────────────────────────────────────────────────────────

const CACHE_DIR = path.join(process.cwd(), "data", "fbref-cache");
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface CacheEntry<T> {
  data: T;
  fetchedAt: string;
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function readCache<T>(key: string): T | null {
  try {
    const fp = path.join(CACHE_DIR, `${key}.json`);
    if (!fs.existsSync(fp)) return null;
    const raw: CacheEntry<T> = JSON.parse(fs.readFileSync(fp, "utf-8"));
    if (Date.now() - new Date(raw.fetchedAt).getTime() > CACHE_TTL) return null;
    return raw.data;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T) {
  ensureCacheDir();
  const fp = path.join(CACHE_DIR, `${key}.json`);
  fs.writeFileSync(fp, JSON.stringify({ data, fetchedAt: new Date().toISOString() }, null, 2));
}

// ─── In-memory cache ────────────────────────────────────────────────────────

const memCache = new Map<string, { data: unknown; ts: number }>();

function getMemCache<T>(key: string): T | null {
  const entry = memCache.get(key);
  if (!entry || Date.now() - entry.ts > CACHE_TTL) return null;
  return entry.data as T;
}

function setMemCache(key: string, data: unknown) {
  memCache.set(key, { data, ts: Date.now() });
}

// ─── Fotmob stat fetcher ────────────────────────────────────────────────────

interface FotmobStatEntry {
  ParticipantName: string;
  ParticiantId: number;  // sic — Fotmob typo
  TeamId: number;
  TeamName: string;
  StatValue: number;
  SubStatValue: number;
  MinutesPlayed: number;
  MatchesPlayed: number;
  Positions?: number[];
}

/**
 * Discover the current season stat URLs from Fotmob leagues API.
 * Returns a map of stat name → URL.
 */
async function discoverStatUrls(leagueId: number): Promise<Map<string, string>> {
  const res = await fetch(
    `https://www.fotmob.com/api/leagues?id=${leagueId}&ccode3=USA`,
    { headers: { "User-Agent": "Mozilla/5.0" } }
  );
  if (!res.ok) throw new Error(`Fotmob leagues API returned ${res.status}`);

  const data = await res.json();
  const urlMap = new Map<string, string>();

  const players = data?.stats?.players || [];
  for (const stat of players) {
    if (stat.fetchAllUrl) {
      // Extract stat name from URL: .../goals_prevented.json → goals_prevented
      const match = stat.fetchAllUrl.match(/\/([^/]+)\.json$/);
      if (match) {
        urlMap.set(match[1], stat.fetchAllUrl);
      }
    }
  }

  return urlMap;
}

/**
 * Fetch a specific stat list from Fotmob data endpoint.
 */
async function fetchStatList(url: string): Promise<FotmobStatEntry[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Encoding": "gzip, deflate, br",
    },
  });
  if (!res.ok) throw new Error(`Fotmob stat endpoint returned ${res.status}`);

  const data = await res.json();
  const topLists = data?.TopLists || [];
  if (topLists.length === 0) return [];
  return topLists[0]?.StatList || [];
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch goalkeeper "goals prevented" (PSxG+/-) stats for a league.
 * Uses Fotmob's _goals_prevented stat endpoint.
 *
 * Positive = goalkeeper saving more than expected (elite)
 * Negative = goalkeeper conceding more than expected (poor)
 */
export async function fetchGKStats(league: string): Promise<GKStats[]> {
  const leagueId = FOTMOB_LEAGUE_IDS[league];
  if (!leagueId) {
    console.warn(`[gk-psxg] Unknown league: ${league}`);
    return [];
  }

  const cacheKey = `gk-${league}`;

  // Memory cache
  const mem = getMemCache<GKStats[]>(cacheKey);
  if (mem) return mem;

  // Disk cache
  const disk = readCache<GKStats[]>(cacheKey);
  if (disk) {
    setMemCache(cacheKey, disk);
    return disk;
  }

  try {
    console.log(`[gk-psxg] Fetching GK stats for ${league} (Fotmob ID: ${leagueId})...`);

    const urls = await discoverStatUrls(leagueId);
    const gpUrl = urls.get("_goals_prevented");
    if (!gpUrl) {
      console.warn(`[gk-psxg] No goals_prevented stat URL found for ${league}`);
      return [];
    }

    const entries = await fetchStatList(gpUrl);
    const results: GKStats[] = entries.map(e => ({
      player: e.ParticipantName,
      playerId: e.ParticiantId,
      team: e.TeamName,
      teamId: e.TeamId,
      goalsPrevented: e.StatValue,
      goalsAgainst: e.SubStatValue,
      matchesPlayed: e.MatchesPlayed,
      goalsPreventedPer90: e.MatchesPlayed > 0
        ? Math.round((e.StatValue / e.MatchesPlayed) * 100) / 100
        : 0,
    }));

    console.log(`[gk-psxg] Got ${results.length} GK entries for ${league}`);

    writeCache(cacheKey, results);
    setMemCache(cacheKey, results);
    return results;
  } catch (err) {
    console.error(`[gk-psxg] Failed to fetch GK stats for ${league}:`, err);
    return [];
  }
}

/**
 * Fetch per-player minutes played for a league.
 * Used by the injury model to identify bench players.
 */
export async function fetchPlayerMinutes(league: string): Promise<PlayerMinutes[]> {
  const leagueId = FOTMOB_LEAGUE_IDS[league];
  if (!leagueId) return [];

  const cacheKey = `minutes-${league}`;

  const mem = getMemCache<PlayerMinutes[]>(cacheKey);
  if (mem) return mem;

  const disk = readCache<PlayerMinutes[]>(cacheKey);
  if (disk) {
    setMemCache(cacheKey, disk);
    return disk;
  }

  try {
    console.log(`[gk-psxg] Fetching player minutes for ${league}...`);

    const urls = await discoverStatUrls(leagueId);
    const minsUrl = urls.get("mins_played");
    if (!minsUrl) {
      console.warn(`[gk-psxg] No mins_played stat URL found for ${league}`);
      return [];
    }

    const entries = await fetchStatList(minsUrl);
    const results: PlayerMinutes[] = entries.map(e => ({
      player: e.ParticipantName,
      playerId: e.ParticiantId,
      team: e.TeamName,
      teamId: e.TeamId,
      minutes: e.StatValue,
      matchesPlayed: e.MatchesPlayed,
      positions: e.Positions || [],
      isGoalkeeper: (e.Positions || []).includes(11),
    }));

    console.log(`[gk-psxg] Got ${results.length} player entries for ${league}`);

    writeCache(cacheKey, results);
    setMemCache(cacheKey, results);
    return results;
  } catch (err) {
    console.error(`[gk-psxg] Failed to fetch player minutes for ${league}:`, err);
    return [];
  }
}

/**
 * Get the starting GK stats for a team.
 * Returns the GK with the most minutes played for that team.
 */
export function getStartingGK(
  team: string,
  gkStats: GKStats[],
  playerMinutes: PlayerMinutes[],
): GKStats | null {
  // Find GKs for this team in the goals prevented data
  const teamGKs = gkStats.filter(g =>
    g.team === team || normalizeTeam(g.team) === normalizeTeam(team)
  );

  if (teamGKs.length === 0) return null;
  if (teamGKs.length === 1) return teamGKs[0];

  // Multiple GKs — find the one with most minutes
  const gkMinutes = playerMinutes.filter(p =>
    p.isGoalkeeper && (p.team === team || normalizeTeam(p.team) === normalizeTeam(team))
  );

  if (gkMinutes.length > 0) {
    // Sort by minutes descending
    gkMinutes.sort((a, b) => b.minutes - a.minutes);
    const starter = gkMinutes[0];
    // Match back to GK stats
    const matched = teamGKs.find(g =>
      g.player === starter.player || g.playerId === starter.playerId
    );
    if (matched) return matched;
  }

  // Fallback: GK with most matches
  teamGKs.sort((a, b) => b.matchesPlayed - a.matchesPlayed);
  return teamGKs[0];
}

/**
 * Get GK context for a match — both teams' starting GK PSxG+/-.
 */
export async function getMatchGKContext(
  homeTeam: string,
  awayTeam: string,
  league: string,
): Promise<{
  home: { player: string; goalsPrevented: number; goalsPreventedPer90: number; matchesPlayed: number } | null;
  away: { player: string; goalsPrevented: number; goalsPreventedPer90: number; matchesPlayed: number } | null;
}> {
  const [gkStats, playerMins] = await Promise.all([
    fetchGKStats(league),
    fetchPlayerMinutes(league),
  ]);

  const homeGK = getStartingGK(homeTeam, gkStats, playerMins);
  const awayGK = getStartingGK(awayTeam, gkStats, playerMins);

  return {
    home: homeGK ? {
      player: homeGK.player,
      goalsPrevented: homeGK.goalsPrevented,
      goalsPreventedPer90: homeGK.goalsPreventedPer90,
      matchesPlayed: homeGK.matchesPlayed,
    } : null,
    away: awayGK ? {
      player: awayGK.player,
      goalsPrevented: awayGK.goalsPrevented,
      goalsPreventedPer90: awayGK.goalsPreventedPer90,
      matchesPlayed: awayGK.matchesPlayed,
    } : null,
  };
}

// ─── Team name normalization ────────────────────────────────────────────────

function normalizeTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+(fc|afc|cf|sc|ssc)$/i, "")
    .replace(/^(fc|afc|cf|sc|ssc)\s+/i, "")
    .replace(/\band\b/g, "&")
    .trim();
}

/**
 * Build a minutes lookup: team → player name → minutes.
 * Used by injury model to check if an injured player is a bench player.
 */
export function buildMinutesLookup(
  playerMinutes: PlayerMinutes[],
): Map<string, Map<string, { minutes: number; matchesPlayed: number }>> {
  const lookup = new Map<string, Map<string, { minutes: number; matchesPlayed: number }>>();

  for (const p of playerMinutes) {
    const teamKey = normalizeTeam(p.team);
    if (!lookup.has(teamKey)) lookup.set(teamKey, new Map());
    lookup.get(teamKey)!.set(p.player.toLowerCase(), {
      minutes: p.minutes,
      matchesPlayed: p.matchesPlayed,
    });
  }

  return lookup;
}
