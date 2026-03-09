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

const SEASONS = ["2024-25", "2023-24", "2022-23"];

export async function fetchOpenFootballMatches(seasons: string[] = SEASONS): Promise<Match[]> {
  const all: Match[] = [];

  for (const season of seasons) {
    try {
      const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${season}/it.1.json`;
      const res = await fetch(url, { next: { revalidate: 86400 } });
      if (!res.ok) continue;

      const data: OpenFootballSeason = await res.json();
      const roundRegex = /(\d+)/;

      for (const m of data.matches) {
        if (!m.score?.ft) continue; // skip unplayed matches

        const roundMatch = m.round.match(roundRegex);
        all.push({
          id: `of-${season}-${m.date}-${m.team1}-${m.team2}`,
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
      console.warn(`Failed to fetch openfootball data for ${season}`);
    }
  }

  return all.sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchCurrentSeasonMatches(): Promise<Match[]> {
  return fetchOpenFootballMatches(["2024-25"]);
}
