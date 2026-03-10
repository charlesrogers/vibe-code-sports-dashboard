/**
 * Fetch Championship per-match xG data from API-Football
 *
 * API-Football (api-sports.io) is the only freely accessible source with
 * Championship xG data. FBref has it but is blocked by Cloudflare.
 * Understat only covers the top 5 European leagues.
 *
 * Strategy:
 *   - Free tier: 100 requests/day
 *   - 1 request to get all fixtures → identifies which matches need xG
 *   - 1 request per match to get statistics (including expected_goals)
 *   - Caches aggressively — finished match xG never changes
 *   - Run daily until backfill completes (~6 runs for a full season)
 *
 * Output format matches FotmobMatchXg interface for compatibility with
 * the rest of the codebase.
 *
 * Usage:
 *   npx tsx scripts/fetch-championship-xg.ts
 *   npx tsx scripts/fetch-championship-xg.ts --season 2023-24
 *   npx tsx scripts/fetch-championship-xg.ts --max-requests 50
 */

import fs from "fs";
import path from "path";

// ─── Types ───────────────────────────────────────────────────────────────────

interface FotmobMatchXg {
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

// ─── Config ──────────────────────────────────────────────────────────────────

const API_BASE = "https://v3.football.api-sports.io";
// API_KEY loaded lazily after .env.local is parsed
function getApiKey(): string {
  // Try key 1 first, fall back to key 2
  const key = process.env.API_FOOTBALL_KEY || process.env.API_FOOTBALL_KEY_2;
  if (!key) throw new Error("API_FOOTBALL_KEY not set. Add it to .env.local or export it.");
  return key;
}
const CHAMPIONSHIP_LEAGUE_ID = 40;

const DATA_DIR = path.join(
  process.cwd(),
  "data",
  "fotmob-match-xg"
);

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(): { season: string; maxRequests: number; apiYear: number } {
  const args = process.argv.slice(2);
  let season = "2024-25";
  let maxRequests = 90;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--season" && args[i + 1]) {
      season = args[i + 1];
      i++;
    }
    if (args[i] === "--max-requests" && args[i + 1]) {
      maxRequests = parseInt(args[i + 1], 10);
      i++;
    }
  }

  // Convert "2024-25" → 2024 for API-Football
  const apiYear = parseInt(season.split("-")[0], 10);

  return { season, maxRequests, apiYear };
}

// ─── HTTP ────────────────────────────────────────────────────────────────────

async function apiFetch<T>(
  endpoint: string,
  params: Record<string, string>
): Promise<T> {
  const url = new URL(`${API_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

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

// ─── Cache ───────────────────────────────────────────────────────────────────

function getCachePath(season: string): string {
  return path.join(DATA_DIR, `championship-${season}.json`);
}

function loadCache(season: string): FotmobMatchXg[] {
  try {
    const fp = getCachePath(season);
    if (!fs.existsSync(fp)) return [];
    const data = JSON.parse(fs.readFileSync(fp, "utf-8")) as FotmobMatchXg[];
    return data;
  } catch {
    return [];
  }
}

function saveCache(season: string, data: FotmobMatchXg[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const fp = getCachePath(season);
  const sorted = data.sort(
    (a, b) => a.date.localeCompare(b.date) || a.matchId - b.matchId
  );
  fs.writeFileSync(fp, JSON.stringify(sorted, null, 2));
  console.log(`[save] Wrote ${sorted.length} matches to ${fp}`);
}

// ─── Quota check ─────────────────────────────────────────────────────────────

async function checkQuota(): Promise<{ used: number; limit: number; remaining: number }> {
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

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const { season, maxRequests, apiYear } = parseArgs();

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  CHAMPIONSHIP xG FETCHER (API-Football)");
  console.log(`  Season: ${season} (API year: ${apiYear})`);
  console.log(`  Max requests this run: ${maxRequests}`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Check quota first
  console.log("[quota] Checking API-Football daily quota...");
  const quota = await checkQuota();
  console.log(
    `[quota] Used: ${quota.used}/${quota.limit} | Remaining: ${quota.remaining}`
  );

  if (quota.remaining <= 1) {
    console.log(
      "\n[quota] No quota remaining today. Run again after midnight UTC."
    );
    console.log("[quota] Quota resets daily at 00:00 UTC.\n");

    // Still show cache status
    const cached = loadCache(season);
    if (cached.length > 0) {
      console.log(`[cache] Already have ${cached.length} matches cached for ${season}`);
      printSummary(cached);
    }
    return;
  }

  // Effective max = min(remaining - 1 for fixtures call, maxRequests)
  const effectiveMax = Math.min(quota.remaining - 1, maxRequests);
  console.log(`[plan] Will fetch up to ${effectiveMax} match stats this run\n`);

  // Load cache
  const cached = loadCache(season);
  const cachedIds = new Set(cached.map((m) => m.matchId));
  console.log(`[cache] ${cached.length} matches already cached for ${season}`);

  // Step 1: Get all fixtures (1 request)
  console.log(
    `\n[fixtures] Fetching Championship fixture list for ${season}...`
  );
  const fixturesData = await apiFetch<{
    response: ApiFixture[];
    results: number;
  }>("fixtures", {
    league: CHAMPIONSHIP_LEAGUE_ID.toString(),
    season: apiYear.toString(),
  });

  const allFixtures = fixturesData.response ?? [];
  const finished = allFixtures.filter((f) => f.fixture.status.short === "FT");
  const uncached = finished.filter((f) => !cachedIds.has(f.fixture.id));

  console.log(`[fixtures] Total fixtures: ${allFixtures.length}`);
  console.log(`[fixtures] Finished: ${finished.length}`);
  console.log(`[fixtures] Already cached: ${finished.length - uncached.length}`);
  console.log(`[fixtures] Need xG data: ${uncached.length}`);

  if (uncached.length === 0) {
    console.log("\n[done] All finished matches already have xG data!");
    printSummary(cached);
    return;
  }

  // Sort by date (oldest first for consistent backfilling)
  uncached.sort((a, b) => a.fixture.date.localeCompare(b.fixture.date));

  const toFetch = uncached.slice(0, effectiveMax);
  console.log(
    `\n[fetch] Fetching xG for ${toFetch.length} matches ` +
      `(${uncached.length - toFetch.length} will remain for next run)`
  );
  console.log("[fetch] Rate limit: 7s between requests (free plan: 10/min)\n");

  // Step 2: Fetch stats for each match
  const newMatches: FotmobMatchXg[] = [];
  let fetchCount = 0;
  let errorCount = 0;
  let noXgCount = 0;

  for (const fix of toFetch) {
    try {
      if (fetchCount > 0) await sleep(7000);

      const statsData = await apiFetch<{ response: ApiStatTeam[] }>(
        "fixtures/statistics",
        { fixture: fix.fixture.id.toString() }
      );

      const teams = statsData.response ?? [];
      let homeXg = 0;
      let awayXg = 0;
      let hasXg = false;

      for (const team of teams) {
        const xgStat = team.statistics.find(
          (s) => s.type === "expected_goals"
        );
        if (xgStat?.value != null) {
          hasXg = true;
          const xg = parseFloat(String(xgStat.value));
          if (
            team.team.name === fix.teams.home.name ||
            team.team.id === fix.teams.home.id
          ) {
            homeXg = xg;
          } else {
            awayXg = xg;
          }
        }
      }

      if (!hasXg) {
        noXgCount++;
      }

      newMatches.push({
        matchId: fix.fixture.id,
        date: fix.fixture.date.slice(0, 10),
        homeTeam: fix.teams.home.name,
        awayTeam: fix.teams.away.name,
        homeXg: Math.round(homeXg * 100) / 100,
        awayXg: Math.round(awayXg * 100) / 100,
        homeGoals: fix.goals.home ?? 0,
        awayGoals: fix.goals.away ?? 0,
        league: "championship",
        season,
      });

      fetchCount++;

      // Progress every 10 matches
      if (fetchCount % 10 === 0 || fetchCount === toFetch.length) {
        const pct = ((fetchCount / toFetch.length) * 100).toFixed(0);
        const latest = newMatches[newMatches.length - 1];
        console.log(
          `[progress] ${fetchCount}/${toFetch.length} (${pct}%) | ` +
            `Latest: ${latest.homeTeam} ${latest.homeXg}-${latest.awayXg} ${latest.awayTeam} ` +
            `(${latest.date})`
        );
      }
    } catch (e) {
      errorCount++;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(
        `[error] Fixture ${fix.fixture.id} (${fix.teams.home.name} vs ${fix.teams.away.name}): ${msg}`
      );

      // If rate limited, stop
      if (
        msg.includes("limit") ||
        msg.includes("429") ||
        msg.includes("Too many")
      ) {
        console.warn("[error] Hit rate limit — stopping. Run again later.");
        break;
      }
    }
  }

  // Merge with cache
  const merged = [...cached, ...newMatches];
  // Deduplicate by matchId
  const deduped = Array.from(
    new Map(merged.map((m) => [m.matchId, m])).values()
  );

  // Save
  saveCache(season, deduped);

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  RESULTS");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  New matches fetched: ${fetchCount}`);
  console.log(`  Errors: ${errorCount}`);
  if (noXgCount > 0) {
    console.log(`  Matches with no xG available: ${noXgCount} (xG set to 0)`);
  }
  console.log(`  Total cached: ${deduped.length}/${finished.length} finished`);
  console.log(
    `  Remaining: ${uncached.length - fetchCount} matches still need xG`
  );
  if (uncached.length - fetchCount > 0) {
    console.log(`  Run again tomorrow to continue backfilling.`);
  }

  printSummary(deduped);
}

function printSummary(matches: FotmobMatchXg[]) {
  if (matches.length === 0) return;

  console.log(`\n─── SAMPLE DATA (last 5 matches) ─────────────────────────────\n`);
  const latest = matches.slice(-5);
  for (const m of latest) {
    const score = `${m.homeGoals}-${m.awayGoals}`;
    const xg = `(xG: ${m.homeXg}-${m.awayXg})`;
    console.log(`  ${m.date}  ${m.homeTeam} ${score} ${m.awayTeam}  ${xg}`);
  }

  // Team xG aggregation
  const teamXg: Record<string, { xgFor: number; xgAgainst: number; gf: number; ga: number; mp: number }> = {};
  for (const m of matches) {
    if (!teamXg[m.homeTeam]) teamXg[m.homeTeam] = { xgFor: 0, xgAgainst: 0, gf: 0, ga: 0, mp: 0 };
    if (!teamXg[m.awayTeam]) teamXg[m.awayTeam] = { xgFor: 0, xgAgainst: 0, gf: 0, ga: 0, mp: 0 };

    teamXg[m.homeTeam].xgFor += m.homeXg;
    teamXg[m.homeTeam].xgAgainst += m.awayXg;
    teamXg[m.homeTeam].gf += m.homeGoals;
    teamXg[m.homeTeam].ga += m.awayGoals;
    teamXg[m.homeTeam].mp++;

    teamXg[m.awayTeam].xgFor += m.awayXg;
    teamXg[m.awayTeam].xgAgainst += m.homeXg;
    teamXg[m.awayTeam].gf += m.awayGoals;
    teamXg[m.awayTeam].ga += m.homeGoals;
    teamXg[m.awayTeam].mp++;
  }

  const sorted = Object.entries(teamXg)
    .map(([team, d]) => ({
      team,
      mp: d.mp,
      xgDiff: d.xgFor - d.xgAgainst,
      xgFor: d.xgFor,
      xgAgainst: d.xgAgainst,
    }))
    .sort((a, b) => b.xgDiff - a.xgDiff);

  console.log(`\n─── xG TABLE (${matches.length} matches) ──────────────────────\n`);
  console.log("  Rank  Team                   MP   xGF    xGA   xGDiff");
  console.log("  ────  ─────────────────────  ──  ─────  ─────  ──────");
  sorted.forEach((t, i) => {
    const rank = String(i + 1).padStart(4);
    const team = t.team.padEnd(21);
    const mp = String(t.mp).padStart(2);
    const xgf = t.xgFor.toFixed(1).padStart(5);
    const xga = t.xgAgainst.toFixed(1).padStart(5);
    const diff = (t.xgDiff >= 0 ? "+" : "") + t.xgDiff.toFixed(1);
    console.log(`  ${rank}  ${team}  ${mp}  ${xgf}  ${xga}  ${diff.padStart(6)}`);
  });
}

// ─── Run ─────────────────────────────────────────────────────────────────────

// Load .env.local if present
try {
  const envPath = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf-8");
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
} catch {
  // ignore
}

main().catch((err) => {
  console.error("\nFatal:", err);
  process.exit(1);
});
