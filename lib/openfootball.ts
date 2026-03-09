import { Match } from "./types";
import { normalizeTeamName } from "./team-mapping";

interface OpenFootballMatch {
  round: string;
  date: string;
  team1: string;
  team2: string;
  score: { ft: [number, number] };
}

interface OpenFootballSeason {
  name: string;
  matches: OpenFootballMatch[];
}

export type League = "serieA" | "serieB";

const LEAGUE_FILES: Record<League, string> = {
  serieA: "it.1",
  serieB: "it.2",
};

// Serie B only available from 2024-25 on openfootball
const SEASONS_A = ["2025-26", "2024-25", "2023-24", "2022-23"];
const SEASONS_B = ["2025-26", "2024-25"];

export function getDefaultSeasons(league: League): string[] {
  return league === "serieB" ? SEASONS_B : SEASONS_A;
}

export async function fetchOpenFootballMatches(
  seasons?: string[],
  league: League = "serieA"
): Promise<Match[]> {
  const effectiveSeasons = seasons || getDefaultSeasons(league);
  const leagueFile = LEAGUE_FILES[league];
  const all: Match[] = [];

  for (const season of effectiveSeasons) {
    try {
      const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${season}/${leagueFile}.json`;
      const res = await fetch(url, { next: { revalidate: 86400 } });
      if (!res.ok) continue;

      const data: OpenFootballSeason = await res.json();
      const roundRegex = /(\d+)/;

      for (const m of data.matches) {
        if (!m.score?.ft) continue; // skip unplayed matches

        const roundMatch = m.round.match(roundRegex);
        all.push({
          id: `of-${league}-${season}-${m.date}-${m.team1}-${m.team2}`,
          date: m.date,
          homeTeam: normalizeTeamName(m.team1, "openfootball"),
          awayTeam: normalizeTeamName(m.team2, "openfootball"),
          homeGoals: m.score.ft[0],
          awayGoals: m.score.ft[1],
          round: roundMatch ? parseInt(roundMatch[1]) : undefined,
          season,
        });
      }
    } catch {
      console.warn(`Failed to fetch openfootball ${league} data for ${season}`);
    }
  }

  return all.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchCurrentSeasonMatches(league: League = "serieA"): Promise<Match[]> {
  return fetchOpenFootballMatches(["2025-26"], league);
}

export interface UpcomingFixture {
  date: string;
  homeTeam: string;
  awayTeam: string;
  round?: number;
}

export async function fetchUpcomingFixtures(
  season: string = "2025-26",
  league: League = "serieA"
): Promise<UpcomingFixture[]> {
  const leagueFile = LEAGUE_FILES[league];
  try {
    const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${season}/${leagueFile}.json`;
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];

    const data: OpenFootballSeason = await res.json();
    const roundRegex = /(\d+)/;
    const fixtures: UpcomingFixture[] = [];

    for (const m of data.matches) {
      if (m.score?.ft) continue; // skip played matches
      const roundMatch = m.round.match(roundRegex);
      fixtures.push({
        date: m.date,
        homeTeam: normalizeTeamName(m.team1, "openfootball"),
        awayTeam: normalizeTeamName(m.team2, "openfootball"),
        round: roundMatch ? parseInt(roundMatch[1]) : undefined,
      });
    }

    return fixtures.sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}
