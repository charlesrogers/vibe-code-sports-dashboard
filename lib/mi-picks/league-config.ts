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

/**
 * Benter Boost: per-league model vs market weights.
 * Sharper markets (EPL, La Liga, Bundesliga) get higher market weight.
 * MI weight absorbs the model signal (MI + DC + Elo collapsed for backtest).
 * Elo weight is a small form correction.
 */
export interface BenterWeights {
  market: number;
  mi: number;
  elo: number;
}

export const BENTER_WEIGHTS: Record<string, BenterWeights> = {
  "epl":          { market: 0.40, mi: 0.45, elo: 0.15 },
  "la-liga":      { market: 0.40, mi: 0.45, elo: 0.15 },
  "bundesliga":   { market: 0.40, mi: 0.45, elo: 0.15 },
  "serie-a":      { market: 0.40, mi: 0.45, elo: 0.15 },
  "serie-b":      { market: 0.40, mi: 0.45, elo: 0.15 },
  "ligue-1":      { market: 0.40, mi: 0.45, elo: 0.15 },
  "championship": { market: 0.40, mi: 0.45, elo: 0.15 },
};

export function getBenterWeights(leagueId: string): BenterWeights {
  return BENTER_WEIGHTS[leagueId] || { market: 0.70, mi: 0.20, elo: 0.10 };
}

export function getLeague(id: string): LeagueConfig | undefined {
  return MI_LEAGUES.find(l => l.id === id);
}

export function getLeagueByOddsApiKey(key: string): LeagueConfig | undefined {
  return MI_LEAGUES.find(l => l.oddsApiKey === key);
}
