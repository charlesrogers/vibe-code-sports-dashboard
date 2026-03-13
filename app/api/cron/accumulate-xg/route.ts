/**
 * Daily xG accumulator cron job.
 *
 * Runs once a day (08:00 UTC via vercel.json). Checks for yesterday's
 * completed matches across configured leagues, fetches per-match xG
 * from Fotmob's match details API, and saves to the unified xG match store.
 *
 * Secured with CRON_SECRET bearer token.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  saveMatchXg,
  makeMatchId,
  type MatchXgRecord,
} from "@/lib/xg-match-store";
import { fetchApiFootballXg } from "@/lib/xg-api-football";

// ---------------------------------------------------------------------------
// Fotmob config
// ---------------------------------------------------------------------------

const FOTMOB_LEAGUE_IDS: Record<string, number> = {
  premierLeague: 47,
  serieA: 55,
  serieB: 86,
  laLiga: 87,
  bundesliga: 54,
  ligue1: 53,
};

// Which leagues to accumulate by default — all active model leagues
const DEFAULT_LEAGUES = ["premierLeague", "serieA", "serieB", "laLiga", "bundesliga", "ligue1"];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Encoding": "gzip, deflate",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(
  url: string,
  timeoutMs = 15000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
    } as RequestInit);
  } finally {
    clearTimeout(timer);
  }
}

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function currentSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 8) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

// ---------------------------------------------------------------------------
// Fotmob: get matches for a league on a given date
// ---------------------------------------------------------------------------

interface FotmobMatchSummary {
  id: number;
  home: { name: string; id: number };
  away: { name: string; id: number };
  status: { finished: boolean; started: boolean };
}

async function getMatchesForDate(
  leagueId: number,
  date: string
): Promise<FotmobMatchSummary[]> {
  // Fotmob's matches endpoint returns all matches for a given date
  const url = `https://www.fotmob.com/api/matches?date=${date}`;
  console.log(`[accumulate-xg] Fetching matches for date ${date}...`);

  const res = await fetchWithTimeout(url);
  if (!res.ok) {
    console.warn(`[accumulate-xg] Matches API returned ${res.status} for ${date}`);
    return [];
  }

  const data = await res.json();
  const matches: FotmobMatchSummary[] = [];

  // Fotmob returns leagues → matches structure
  const leagues = data?.leagues ?? [];
  for (const league of leagues) {
    if (league.primaryId !== leagueId && league.id !== leagueId) continue;
    for (const match of league.matches ?? []) {
      if (match.status?.finished) {
        matches.push({
          id: match.id,
          home: { name: match.home?.name ?? "Unknown", id: match.home?.id ?? 0 },
          away: { name: match.away?.name ?? "Unknown", id: match.away?.id ?? 0 },
          status: { finished: true, started: true },
        });
      }
    }
  }

  console.log(
    `[accumulate-xg] Found ${matches.length} finished matches for league ${leagueId} on ${date}`
  );
  return matches;
}

// ---------------------------------------------------------------------------
// Fotmob: get per-match xG from match details
// ---------------------------------------------------------------------------

interface MatchXgResult {
  homeXg: number;
  awayXg: number;
  homeGoals: number;
  awayGoals: number;
}

async function getMatchXg(matchId: number): Promise<MatchXgResult | null> {
  const url = `https://www.fotmob.com/api/matchDetails?matchId=${matchId}`;
  console.log(`[accumulate-xg] Fetching xG for match ${matchId}...`);

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) {
      console.warn(`[accumulate-xg] Match details returned ${res.status} for match ${matchId}`);
      return null;
    }

    const data = await res.json();

    // Extract xG from match details
    // Fotmob stores xG in content.stats.Ede or header.teams
    let homeXg = 0;
    let awayXg = 0;
    let homeGoals = 0;
    let awayGoals = 0;

    // Try header for goals
    homeGoals = data?.header?.teams?.[0]?.score ?? 0;
    awayGoals = data?.header?.teams?.[1]?.score ?? 0;

    // Try to find xG in stats
    const stats = data?.content?.stats?.Ede ?? data?.content?.stats ?? [];
    if (Array.isArray(stats)) {
      for (const group of stats) {
        const statItems = group?.stats ?? [];
        for (const stat of statItems) {
          if (
            stat?.title === "Expected goals (xG)" ||
            stat?.key === "expected_goals"
          ) {
            // Stats come as [home, away] in stat.stats
            homeXg = parseFloat(stat.stats?.[0] ?? "0") || 0;
            awayXg = parseFloat(stat.stats?.[1] ?? "0") || 0;
          }
        }
      }
    }

    // Alternative: xG might be in content.matchFacts
    if (homeXg === 0 && awayXg === 0) {
      const matchFacts = data?.content?.matchFacts;
      if (matchFacts?.xg) {
        homeXg = matchFacts.xg.home ?? 0;
        awayXg = matchFacts.xg.away ?? 0;
      }
    }

    console.log(
      `[accumulate-xg] Match ${matchId}: xG ${homeXg.toFixed(2)} - ${awayXg.toFixed(2)}, Score ${homeGoals}-${awayGoals}`
    );

    return { homeXg, awayXg, homeGoals, awayGoals };
  } catch (err) {
    console.error(`[accumulate-xg] Error fetching match ${matchId}:`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  // Validate CRON_SECRET
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const date = request.nextUrl.searchParams.get("date") ?? yesterday();
  const leaguesParam = request.nextUrl.searchParams.get("leagues");
  const leagueKeys = leaguesParam
    ? leaguesParam.split(",").map((l) => l.trim())
    : DEFAULT_LEAGUES;

  const season = currentSeason();
  const now = new Date().toISOString();

  console.log(`[accumulate-xg] Starting xG accumulation for ${date}`);
  console.log(`[accumulate-xg] Leagues: ${leagueKeys.join(", ")}`);
  console.log(`[accumulate-xg] Season: ${season}`);

  const summary: {
    date: string;
    season: string;
    leagues: Record<
      string,
      { matchesFound: number; matchesProcessed: number; errors: number }
    >;
    totalRecords: number;
  } = {
    date,
    season,
    leagues: {},
    totalRecords: 0,
  };

  const allRecords: MatchXgRecord[] = [];

  for (const leagueKey of leagueKeys) {
    const leagueId = FOTMOB_LEAGUE_IDS[leagueKey];
    if (!leagueId) {
      console.warn(
        `[accumulate-xg] Unknown league "${leagueKey}", skipping. Available: ${Object.keys(FOTMOB_LEAGUE_IDS).join(", ")}`
      );
      summary.leagues[leagueKey] = {
        matchesFound: 0,
        matchesProcessed: 0,
        errors: 1,
      };
      continue;
    }

    console.log(`[accumulate-xg] Processing league: ${leagueKey} (ID: ${leagueId})`);

    const leagueSummary = { matchesFound: 0, matchesProcessed: 0, errors: 0 };

    try {
      const matches = await getMatchesForDate(leagueId, date);
      leagueSummary.matchesFound = matches.length;

      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        console.log(
          `[accumulate-xg] Processing match ${i + 1}/${matches.length}: ${match.home.name} vs ${match.away.name}`
        );

        // Small delay between requests to be polite
        if (i > 0) await new Promise((r) => setTimeout(r, 500));

        const xgResult = await getMatchXg(match.id);
        if (!xgResult) {
          console.warn(
            `[accumulate-xg] Could not get xG for match ${match.id}, skipping`
          );
          leagueSummary.errors++;
          continue;
        }

        const record: MatchXgRecord = {
          id: makeMatchId(date, match.home.name, match.away.name),
          date,
          homeTeam: match.home.name,
          awayTeam: match.away.name,
          homeXg: Math.round(xgResult.homeXg * 100) / 100,
          awayXg: Math.round(xgResult.awayXg * 100) / 100,
          homeGoals: xgResult.homeGoals,
          awayGoals: xgResult.awayGoals,
          league: leagueKey,
          season,
          source: "fotmob",
          fetchedAt: now,
        };

        allRecords.push(record);
        leagueSummary.matchesProcessed++;

        console.log(
          `[accumulate-xg] Saved: ${record.id} | xG: ${record.homeXg}-${record.awayXg} | Score: ${record.homeGoals}-${record.awayGoals}`
        );
      }
    } catch (err) {
      console.error(`[accumulate-xg] Error processing league ${leagueKey}:`, err);
      leagueSummary.errors++;
    }

    summary.leagues[leagueKey] = leagueSummary;
  }

  // Also fetch from API-Football if key is available (incremental backfill)
  if (process.env.API_FOOTBALL_KEY) {
    console.log(`[accumulate-xg] Running API-Football incremental backfill...`);
    try {
      for (const leagueKey of leagueKeys) {
        // Fetch up to 10 new matches per league per cron run
        const apiResults = await fetchApiFootballXg(leagueKey, season, {
          maxRequests: 10,
          since: date,
        });
        const newFromApi = apiResults.filter((m) => m.date === date);
        for (const m of newFromApi) {
          allRecords.push({
            id: makeMatchId(m.date, m.homeTeam, m.awayTeam),
            date: m.date,
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            homeXg: m.homeXg,
            awayXg: m.awayXg,
            homeGoals: m.homeGoals,
            awayGoals: m.awayGoals,
            league: leagueKey,
            season,
            source: "api-football",
            fetchedAt: new Date().toISOString(),
          });
        }
        console.log(`[accumulate-xg] API-Football: ${newFromApi.length} matches for ${leagueKey} on ${date}`);
      }
    } catch (e) {
      console.warn(`[accumulate-xg] API-Football backfill failed:`, e);
    }
  }

  // Save all records at once
  if (allRecords.length > 0) {
    console.log(
      `[accumulate-xg] Saving ${allRecords.length} total records to store...`
    );
    await saveMatchXg(allRecords);
  }

  summary.totalRecords = allRecords.length;

  console.log(
    `[accumulate-xg] Done. Processed ${allRecords.length} matches across ${leagueKeys.length} league(s).`
  );

  return NextResponse.json({
    ok: true,
    summary,
  });
}
