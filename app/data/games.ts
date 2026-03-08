export type Game = {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

export const games: Game[] = [
  { date: "2020-01-01", homeTeam: "Team C", awayTeam: "Team D", homeScore: 1, awayScore: 2 },
  { date: "2020-01-02", homeTeam: "Team C", awayTeam: "Team D", homeScore: 2, awayScore: 2 },
  { date: "2020-01-04", homeTeam: "Team B", awayTeam: "Team D", homeScore: 2, awayScore: 1 },
  { date: "2020-01-05", homeTeam: "Team C", awayTeam: "Team E", homeScore: 0, awayScore: 1 },
  { date: "2020-01-06", homeTeam: "Team E", awayTeam: "Team D", homeScore: 1, awayScore: 2 },
  { date: "2020-01-07", homeTeam: "Team D", awayTeam: "Team A", homeScore: 2, awayScore: 1 },
  { date: "2020-01-08", homeTeam: "Team A", awayTeam: "Team E", homeScore: 2, awayScore: 4 },
  { date: "2020-01-09", homeTeam: "Team B", awayTeam: "Team C", homeScore: 3, awayScore: 2 },
  { date: "2020-01-11", homeTeam: "Team E", awayTeam: "Team A", homeScore: 3, awayScore: 1 },
  { date: "2020-01-12", homeTeam: "Team C", awayTeam: "Team A", homeScore: 2, awayScore: 0 },
  { date: "2020-01-14", homeTeam: "Team A", awayTeam: "Team D", homeScore: 2, awayScore: 1 },
  { date: "2020-01-16", homeTeam: "Team A", awayTeam: "Team C", homeScore: 2, awayScore: 3 },
  { date: "2020-01-17", homeTeam: "Team A", awayTeam: "Team E", homeScore: 8, awayScore: 1 },
  { date: "2020-01-18", homeTeam: "Team E", awayTeam: "Team A", homeScore: 4, awayScore: 0 },
  { date: "2020-01-19", homeTeam: "Team C", awayTeam: "Team E", homeScore: 3, awayScore: 3 },
  { date: "2020-01-20", homeTeam: "Team B", awayTeam: "Team A", homeScore: 3, awayScore: 1 },
  { date: "2020-01-21", homeTeam: "Team B", awayTeam: "Team A", homeScore: 4, awayScore: 3 },
  { date: "2020-01-22", homeTeam: "Team A", awayTeam: "Team D", homeScore: 2, awayScore: 0 },
  { date: "2020-01-25", homeTeam: "Team A", awayTeam: "Team C", homeScore: 2, awayScore: 4 },
  { date: "2020-01-26", homeTeam: "Team C", awayTeam: "Team A", homeScore: 0, awayScore: 1 },
  { date: "2020-01-27", homeTeam: "Team E", awayTeam: "Team B", homeScore: 2, awayScore: 1 },
  { date: "2020-01-28", homeTeam: "Team D", awayTeam: "Team C", homeScore: 1, awayScore: 4 },
  { date: "2020-01-29", homeTeam: "Team B", awayTeam: "Team C", homeScore: 5, awayScore: 1 },
  { date: "2020-01-30", homeTeam: "Team E", awayTeam: "Team A", homeScore: 0, awayScore: 4 },
  { date: "2020-02-02", homeTeam: "Team B", awayTeam: "Team A", homeScore: 3, awayScore: 3 },
  { date: "2020-02-03", homeTeam: "Team C", awayTeam: "Team B", homeScore: 2, awayScore: 1 },
  { date: "2020-02-04", homeTeam: "Team D", awayTeam: "Team B", homeScore: 0, awayScore: 1 },
  { date: "2020-02-05", homeTeam: "Team E", awayTeam: "Team A", homeScore: 1, awayScore: 2 },
  { date: "2020-02-06", homeTeam: "Team E", awayTeam: "Team B", homeScore: 1, awayScore: 1 },
  { date: "2020-02-07", homeTeam: "Team C", awayTeam: "Team D", homeScore: 2, awayScore: 3 },
];

// Using a representative sample. Full dataset has 800+ games from 2020-2022.
// Teams: A, B, C, D, E
