/**
 * Fotmob xG data fetcher
 *
 * Uses Fotmob's public stats API to get team-level xG data.
 * This replaces Understat which now blocks server-side scraping.
 *
 * League IDs: Serie A = 55, Serie B = 53
 * Stats endpoints return all teams with xG, xGA, goals, goals against.
 */

import { TeamXg } from "./types";
import { normalizeTeamName } from "./team-mapping";

interface FotmobStatEntry {
  ParticipantName: string;
  TeamId: number;
  StatValue: number;
  SubStatValue: number;
  MatchesPlayed: number;
}

interface FotmobStatResponse {
  TopLists: {
    StatName: string;
    StatList: FotmobStatEntry[];
  }[];
}

const LEAGUE_IDS: Record<string, number> = {
  serieA: 55,
  serieB: 53,
};

async function fetchFotmobStat(url: string): Promise<FotmobStatEntry[]> {
  const res = await fetch(url, {
    headers: {
      "Accept-Encoding": "gzip, deflate",
      "User-Agent": "Mozilla/5.0",
    },
    next: { revalidate: 21600 }, // 6 hours
  });
  if (!res.ok) throw new Error(`Fotmob stat returned ${res.status}`);
  const data: FotmobStatResponse = await res.json();
  return data.TopLists?.[0]?.StatList || [];
}

/**
 * Discover the current season ID and stat URLs from the Fotmob leagues API.
 */
async function getStatUrls(league: string): Promise<{
  xgUrl: string;
  xgaUrl: string;
  goalsUrl: string;
  gaUrl: string;
} | null> {
  const leagueId = LEAGUE_IDS[league];
  if (!leagueId) return null;

  const res = await fetch(
    `https://www.fotmob.com/api/leagues?id=${leagueId}&ccode3=USA`,
    {
      headers: { "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 86400 }, // 24 hours — season ID doesn't change often
    }
  );
  if (!res.ok) throw new Error(`Fotmob leagues API returned ${res.status}`);
  const data = await res.json();

  const teamStats: { header: string; fetchAllUrl: string }[] =
    data?.stats?.teams || [];

  const find = (keyword: string) =>
    teamStats.find((s) => s.fetchAllUrl?.includes(keyword))?.fetchAllUrl;

  const xgUrl = find("expected_goals_team.");
  const xgaUrl = find("expected_goals_conceded_team.");
  const goalsUrl = find("goals_team_match.");
  const gaUrl = find("goals_conceded_team_match.");

  if (!xgUrl || !xgaUrl) return null;
  return { xgUrl, xgaUrl, goalsUrl: goalsUrl || "", gaUrl: gaUrl || "" };
}

export async function fetchTeamXgFromFotmob(
  league: string = "serieA"
): Promise<TeamXg[]> {
  const urls = await getStatUrls(league);
  if (!urls) throw new Error(`No Fotmob stat URLs for ${league}`);

  // Fetch xG and xGA in parallel (goals come as SubStatValue in xG response)
  const [xgEntries, xgaEntries] = await Promise.all([
    fetchFotmobStat(urls.xgUrl),
    fetchFotmobStat(urls.xgaUrl),
  ]);

  // Build lookup by team name
  const xgaMap = new Map<string, FotmobStatEntry>();
  for (const e of xgaEntries) {
    xgaMap.set(e.ParticipantName, e);
  }

  const results: TeamXg[] = [];

  for (const entry of xgEntries) {
    const name = normalizeTeamName(entry.ParticipantName, "fotmob");
    const xGFor = entry.StatValue;
    const goalsFor = entry.SubStatValue;
    const matches = entry.MatchesPlayed;

    const xgaEntry = xgaMap.get(entry.ParticipantName);
    const xGAgainst = xgaEntry?.StatValue ?? 0;
    const goalsAgainst = xgaEntry?.SubStatValue ?? 0;

    results.push({
      team: name,
      xGFor: Math.round(xGFor * 100) / 100,
      xGAgainst: Math.round(xGAgainst * 100) / 100,
      goalsFor,
      goalsAgainst,
      xGDiff: Math.round((xGFor - xGAgainst) * 100) / 100,
      overperformance: Math.round((goalsFor - xGFor) * 100) / 100,
      matches,
    });
  }

  return results.sort((a, b) => b.xGDiff - a.xGDiff);
}
