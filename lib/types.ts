// Core match data (normalized across all sources)
export interface Match {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  round?: number;
  season: string;
}

// Dixon-Coles model output
export interface DixonColesParams {
  attack: Record<string, number>;
  defense: Record<string, number>;
  homeAdvantage: number;
  rho: number;
  avgGoals: number;
  fittedAt: string;
}

// Probability grid: [homeGoals][awayGoals] = probability
export type ProbabilityGrid = number[][];

// All betting market outputs
export interface BettingMarkets {
  match1X2: { home: number; draw: number; away: number };
  overUnder: Record<string, { over: number; under: number }>;
  btts: { yes: number; no: number };
  correctScore: { score: string; probability: number }[];
  asianHandicap: { line: number; homeProb: number; awayProb: number }[];
  predictedScore: { home: number; away: number };
}

export interface EloRating {
  team: string;
  rating: number;
}

export interface TeamXg {
  team: string;
  xGFor: number;
  xGAgainst: number;
  goalsFor: number;
  goalsAgainst: number;
  xGDiff: number;
  overperformance: number;
  matches: number;
}

export interface Standing {
  position: number;
  team: string;
  played: number;
  won: number;
  draw: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface TeamRating {
  team: string;
  attack: number;
  defense: number;
  overall: number;
  elo: number;
}

// Model health / data source availability
export interface DataSourceStatus {
  name: string;
  available: boolean;
  lastChecked: string;
  detail?: string;
}

export interface ModelHealth {
  confidence: "high" | "medium" | "low";
  sources: DataSourceStatus[];
  missingCount: number;
  message: string;
}
