/**
 * Market-Implied Bivariate Poisson Model — Type Definitions
 *
 * All interfaces for the MI model system.
 */

/** Market mode: which markets the system evaluates */
export type MarketMode = "sides_only" | "totals_only" | "both";

/** Per-team ratings solved from market odds */
export interface MITeamRating {
  team: string;
  attack: number;       // alpha — attack lambda component
  defense: number;      // beta — defense lambda component (higher = worse defense)
  ppg: number;          // Points Per Game (0-3 scale)
  matchesUsed: number;
}

/** Global model parameters */
export interface MIModelParams {
  teams: Record<string, MITeamRating>;
  homeAdvantage: number;    // gamma — multiplicative home boost
  correlation: number;      // rho — bivariate Poisson lambda3
  avgGoalRate: number;      // league-average goals/team/match
  leagueId: string;
  season: string;
  convergenceInfo: {
    iterations: number;
    finalLoss: number;
    converged: boolean;
  };
  /** Rating drift factor (0 for top leagues, 0.05-0.15 for lower divisions) */
  driftFactor: number;
  /** League strength index (1.0 = EPL baseline, <1.0 = weaker league) */
  leagueStrength?: number;
}

/** Match with devigged market probabilities (solver input) */
export interface MarketMatch {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  marketProbs: { home: number; draw: number; away: number };
  /** Asian Handicap line (e.g., -1.0 means home favored by 1 goal) */
  ahLine?: number | null;
  /** Devigged AH implied probability for home covering */
  ahHomeProb?: number | null;
  result?: { homeGoals: number; awayGoals: number } | null;
  /** Understat xG data (when available) */
  xG?: { home: number; away: number } | null;
  /** Is this a recent match (last 10 for either team)? */
  recentForm?: boolean;
  weight: number; // time-decay weight
}

/** Model output for a matchup */
export interface MatchPrediction {
  homeTeam: string;
  awayTeam: string;
  lambdaHome: number;
  lambdaAway: number;
  lambda3: number;
  scoreGrid: number[][];  // P(home=i, away=j)
  probs1X2: { home: number; draw: number; away: number };
  overUnder: Record<string, { over: number; under: number }>;
  btts: { yes: number; no: number };
  asianHandicap: Record<string, { home: number; away: number }>;
  expectedGoals: { home: number; away: number; total: number };
  mostLikelyScore: { home: number; away: number; prob: number };
}

/** Value bet found */
export interface ValueBet {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  selection: string;       // "home" | "draw" | "away" | "over2.5" etc.
  modelProb: number;
  marketProb: number;
  edge: number;
  varianceAgreement: boolean | null;
  combinedSignal: "strong" | "moderate" | "model_only" | "variance_only" | null;
}

/** Season simulation output */
export interface SeasonSimulation {
  leagueId: string;
  season: string;
  simulations: number;
  teams: SeasonTeamProjection[];
}

/** Per-team season projection */
export interface SeasonTeamProjection {
  team: string;
  avgPoints: number;
  avgPosition: number;
  pTitle: number;         // P(finish 1st)
  pTop4: number;          // P(finish top 4)
  pRelegation: number;    // P(finish bottom 3)
  positionDistribution: number[];  // P(finish in position i)
  pointsDistribution: { min: number; max: number; p25: number; p50: number; p75: number };
}

/** Solver configuration */
export interface MISolverConfig {
  maxIterations: number;
  convergenceThreshold: number;
  attackRange: [number, number];
  defenseRange: [number, number];
  homeAdvantageRange: [number, number];
  lambda3Range: [number, number];
  avgGoalRateRange: [number, number];
  gridSteps: number;          // number of grid search steps per parameter
  decayRate: number;          // xi for time decay: exp(-xi * daysAgo)
  regularization: number;     // L2 regularization strength
  klWeight: number;           // weight for KL-divergence loss
  ahWeight: number;           // weight for AH loss
  /** Weight for outcome-based loss (actual results) */
  outcomeWeight: number;
  /** Weight for xG-based loss (Understat data) */
  xgWeight: number;
  /** Boost multiplier for recent matches (last 10 per team) */
  recentFormBoost: number;
  printEvery: number;         // print progress every N iterations
  /** Rating drift factor for Monte Carlo (0 = no drift) */
  driftFactor: number;
  /** Totals deflation: scale lambdas down for O/U computation (default 0.965 = -3.5%) */
  totalsDeflation?: number;
}

export const DEFAULT_SOLVER_CONFIG: MISolverConfig = {
  maxIterations: 200,
  convergenceThreshold: 1e-6,
  attackRange: [0.3, 3.0],
  defenseRange: [0.3, 3.0],
  homeAdvantageRange: [0.8, 1.8],
  lambda3Range: [-0.08, 0.02],       // tightened: solver was always hitting +0.05 boundary, inflating Overs
  avgGoalRateRange: [1.0, 1.8],
  gridSteps: 40,
  decayRate: 0.005,           // half-life ~140 days
  regularization: 0.001,
  klWeight: 0.6,              // reduced from 1.0 — don't just reproduce Pinnacle
  ahWeight: 0.2,
  outcomeWeight: 0.3,         // NEW: actual result signal
  xgWeight: 0.2,              // NEW: xG-based signal (when available)
  recentFormBoost: 1.5,       // NEW: 50% weight boost for last-10 matches
  printEvery: 10,
  driftFactor: 0.0,
};
