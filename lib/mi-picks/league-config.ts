/**
 * League configuration — maps between football-data-cache IDs,
 * The Odds API sport keys, and display labels.
 */

export interface LeagueConfig {
  id: string;          // football-data-cache ID: "epl", "la-liga", etc.
  oddsApiKey: string;  // The Odds API league param: "epl", "laLiga", etc.
  label: string;
  currentSeason: string;
  previousSeason: string;
}

export const MI_LEAGUES: LeagueConfig[] = [
  { id: "epl", oddsApiKey: "epl", label: "Premier League", currentSeason: "2025-26", previousSeason: "2024-25" },
  { id: "la-liga", oddsApiKey: "laLiga", label: "La Liga", currentSeason: "2025-26", previousSeason: "2024-25" },
  { id: "bundesliga", oddsApiKey: "bundesliga", label: "Bundesliga", currentSeason: "2025-26", previousSeason: "2024-25" },
  { id: "serie-a", oddsApiKey: "serieA", label: "Serie A", currentSeason: "2025-26", previousSeason: "2024-25" },
  { id: "serie-b", oddsApiKey: "serieB", label: "Serie B", currentSeason: "2025-26", previousSeason: "2024-25" },
  { id: "ligue-1", oddsApiKey: "ligue1", label: "Ligue 1", currentSeason: "2025-26", previousSeason: "2024-25" },
];

export function getLeague(id: string): LeagueConfig | undefined {
  return MI_LEAGUES.find(l => l.id === id);
}

export function getLeagueByOddsApiKey(key: string): LeagueConfig | undefined {
  return MI_LEAGUES.find(l => l.oddsApiKey === key);
}
