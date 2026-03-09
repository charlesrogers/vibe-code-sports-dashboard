import { Match, Standing } from "./types";
import { normalizeTeamName } from "./team-mapping";

const BASE_URL = "https://api.football-data.org/v4";
const API_KEY = process.env.FOOTBALL_DATA_API_KEY || "";

async function fdFetch(path: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "X-Auth-Token": API_KEY },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`football-data.org ${res.status}: ${path}`);
  return res.json();
}

export async function getMatches(season?: string): Promise<Match[]> {
  const params = season ? `?season=${season}` : "";
  const data = await fdFetch(`/competitions/SA/matches${params}`);

  return (data.matches || [])
    .filter((m: any) => m.status === "FINISHED")
    .map((m: any) => ({
      id: `fd-${m.id}`,
      date: m.utcDate.split("T")[0],
      homeTeam: normalizeTeamName(m.homeTeam.name, "footballData"),
      awayTeam: normalizeTeamName(m.awayTeam.name, "footballData"),
      homeGoals: m.score.fullTime.home,
      awayGoals: m.score.fullTime.away,
      round: m.matchday,
      season: season || "current",
    }));
}

export async function getStandings(): Promise<Standing[]> {
  const data = await fdFetch("/competitions/SA/standings");
  const table = data.standings?.[0]?.table || [];

  return table.map((row: any) => ({
    position: row.position,
    team: normalizeTeamName(row.team.name, "footballData"),
    played: row.playedGames,
    won: row.won,
    draw: row.draw,
    lost: row.lost,
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    goalDifference: row.goalDifference,
    points: row.points,
  }));
}

export async function getUpcomingFixtures(): Promise<{ date: string; homeTeam: string; awayTeam: string; round?: number }[]> {
  const data = await fdFetch("/competitions/SA/matches?status=SCHEDULED");

  return (data.matches || []).map((m: any) => ({
    date: m.utcDate.split("T")[0],
    homeTeam: normalizeTeamName(m.homeTeam.name, "footballData"),
    awayTeam: normalizeTeamName(m.awayTeam.name, "footballData"),
    round: m.matchday,
  }));
}
