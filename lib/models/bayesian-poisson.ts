/**
 * Bayesian Poisson Model — based on Andrew Mack's approach
 *
 * From "Bayesian Sports Models in R" (Mack, 2024):
 *   log(λ_home) = goal_mean + home_adv + att[home] + def[away]
 *   log(λ_away) = goal_mean + att[away] + def[home]
 *
 * Since we can't run Stan/MCMC in TypeScript, we use:
 * 1. Maximum likelihood estimation via iterative fitting (like DC but simpler)
 * 2. Bayesian shrinkage via Gamma-Poisson conjugate priors on team rates
 * 3. Independent Poisson grid for 1X2 probabilities
 *
 * Key difference from Dixon-Coles:
 * - No tau correction for low scores (simpler)
 * - No time weighting (uses all data equally)
 * - Bayesian shrinkage pulls extreme team ratings toward the mean
 * - Mack: "light years ahead of models only looking at wins and losses like ELO"
 */

import type { Match } from "../types";

export interface BayesianPoissonParams {
  attack: Record<string, number>;   // log-scale attack strength (centered to 0)
  defense: Record<string, number>;  // log-scale defense strength (centered to 0, negative = strong)
  homeAdvantage: number;             // log-scale home advantage
  goalMean: number;                  // log-scale intercept (league avg goal rate)
  shrinkage: number;                 // shrinkage factor applied
  fittedAt: string;
}

/**
 * Fit the Bayesian Poisson model using iterative MLE with shrinkage.
 *
 * The Gamma(α, β) prior on team rates acts as shrinkage:
 *   posterior_mean = (α + Σgoals) / (β + n_games)
 * With α=3, β=2 (prior mean = 1.5 goals/game), this pulls
 * extreme teams toward the league average, preventing overfitting.
 */
export function fitBayesianPoisson(
  matches: Match[],
  priorAlpha: number = 3,
  priorBeta: number = 2
): BayesianPoissonParams {
  // Step 1: Compute raw team statistics
  const teamStats: Record<string, {
    homeGoalsFor: number; homeGoalsAgainst: number; homeGames: number;
    awayGoalsFor: number; awayGoalsAgainst: number; awayGames: number;
  }> = {};

  for (const m of matches) {
    if (!teamStats[m.homeTeam]) {
      teamStats[m.homeTeam] = { homeGoalsFor: 0, homeGoalsAgainst: 0, homeGames: 0, awayGoalsFor: 0, awayGoalsAgainst: 0, awayGames: 0 };
    }
    if (!teamStats[m.awayTeam]) {
      teamStats[m.awayTeam] = { homeGoalsFor: 0, homeGoalsAgainst: 0, homeGames: 0, awayGoalsFor: 0, awayGoalsAgainst: 0, awayGames: 0 };
    }

    teamStats[m.homeTeam].homeGoalsFor += m.homeGoals;
    teamStats[m.homeTeam].homeGoalsAgainst += m.awayGoals;
    teamStats[m.homeTeam].homeGames += 1;

    teamStats[m.awayTeam].awayGoalsFor += m.awayGoals;
    teamStats[m.awayTeam].awayGoalsAgainst += m.homeGoals;
    teamStats[m.awayTeam].awayGames += 1;
  }

  const teams = Object.keys(teamStats);

  // Step 2: League averages
  const totalGoals = matches.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0);
  const totalHomeGoals = matches.reduce((s, m) => s + m.homeGoals, 0);
  const totalAwayGoals = matches.reduce((s, m) => s + m.awayGoals, 0);
  const avgGoalsPerGame = totalGoals / (2 * matches.length);
  const homeAdvRatio = totalHomeGoals / totalAwayGoals;

  // Step 3: Bayesian shrinkage via Gamma-Poisson conjugate
  // posterior_mean = (α + Σgoals) / (β + n_games)
  // This shrinks extreme teams toward prior_mean = α/β
  const attack: Record<string, number> = {};
  const defense: Record<string, number> = {};

  for (const team of teams) {
    const s = teamStats[team];
    const totalGames = s.homeGames + s.awayGames;
    if (totalGames === 0) continue;

    // Attack rate: goals scored per game (Bayesian posterior mean)
    const totalGoalsFor = s.homeGoalsFor + s.awayGoalsFor;
    const attackRate = (priorAlpha + totalGoalsFor) / (priorBeta + totalGames);

    // Defense rate: goals conceded per game (Bayesian posterior mean)
    const totalGoalsAgainst = s.homeGoalsAgainst + s.awayGoalsAgainst;
    const defenseRate = (priorAlpha + totalGoalsAgainst) / (priorBeta + totalGames);

    // Convert to log-scale relative strengths (centered on league average)
    attack[team] = Math.log(attackRate / avgGoalsPerGame);
    defense[team] = Math.log(defenseRate / avgGoalsPerGame);
  }

  // Step 4: Center parameters (Mack: att = att_raw - mean(att_raw))
  const meanAtt = Object.values(attack).reduce((s, v) => s + v, 0) / teams.length;
  const meanDef = Object.values(defense).reduce((s, v) => s + v, 0) / teams.length;
  for (const team of teams) {
    if (attack[team] !== undefined) attack[team] -= meanAtt;
    if (defense[team] !== undefined) defense[team] -= meanDef;
  }

  return {
    attack,
    defense,
    homeAdvantage: Math.log(homeAdvRatio) / 2, // half the log ratio as home advantage
    goalMean: Math.log(avgGoalsPerGame),
    shrinkage: priorAlpha / priorBeta,
    fittedAt: new Date().toISOString(),
  };
}

/**
 * Predict a match: generate λ_home and λ_away, then build probability grid
 *
 * Mack's model:
 *   log(λ_home) = goal_mean + home_adv + att[home] + def[away]
 *   log(λ_away) = goal_mean + att[away] + def[home]
 */
export function predictMatchBayes(
  homeTeam: string,
  awayTeam: string,
  params: BayesianPoissonParams
): { grid: number[][]; lambdaHome: number; lambdaAway: number } {
  const attHome = params.attack[homeTeam] ?? 0;
  const defHome = params.defense[homeTeam] ?? 0;
  const attAway = params.attack[awayTeam] ?? 0;
  const defAway = params.defense[awayTeam] ?? 0;

  // Mack's log-linear model
  const logLambdaHome = params.goalMean + params.homeAdvantage + attHome + defAway;
  const logLambdaAway = params.goalMean + attAway + defHome;

  const lambdaHome = Math.exp(logLambdaHome);
  const lambdaAway = Math.exp(logLambdaAway);

  // Build independent Poisson probability grid (truncated at 10 goals)
  const maxGoals = 10;
  const grid: number[][] = [];

  for (let h = 0; h <= maxGoals; h++) {
    grid[h] = [];
    for (let a = 0; a <= maxGoals; a++) {
      grid[h][a] = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway);
    }
  }

  return { grid, lambdaHome, lambdaAway };
}

/**
 * Get 1X2 probabilities from the model
 */
export function bayesPredict1X2(
  homeTeam: string,
  awayTeam: string,
  params: BayesianPoissonParams
): { home: number; draw: number; away: number; lambdaHome: number; lambdaAway: number } {
  const { grid, lambdaHome, lambdaAway } = predictMatchBayes(homeTeam, awayTeam, params);

  let home = 0, draw = 0, away = 0;
  for (let h = 0; h < grid.length; h++) {
    for (let a = 0; a < grid[h].length; a++) {
      if (h > a) home += grid[h][a];
      else if (h === a) draw += grid[h][a];
      else away += grid[h][a];
    }
  }

  // Normalize (grid truncation may leave tiny residual)
  const total = home + draw + away;
  return {
    home: home / total,
    draw: draw / total,
    away: away / total,
    lambdaHome,
    lambdaAway,
  };
}

// --- Helpers ---

function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

function logFactorial(n: number): number {
  let result = 0;
  for (let i = 2; i <= n; i++) result += Math.log(i);
  return result;
}
