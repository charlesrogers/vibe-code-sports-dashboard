import { Match, DixonColesParams, ProbabilityGrid } from "../types";
import { poissonPmf, logPoissonPmf } from "./poisson";

const MAX_GOALS = 10;

// Dixon-Coles tau correction for low-scoring outcomes
function tau(x: number, y: number, lambdaH: number, lambdaA: number, rho: number): number {
  if (x === 0 && y === 0) return 1 - lambdaH * lambdaA * rho;
  if (x === 1 && y === 0) return 1 + lambdaA * rho;
  if (x === 0 && y === 1) return 1 + lambdaH * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1;
}

// Time weight: exponential decay, xi controls half-life
function timeWeight(daysAgo: number, xi: number = 0.0019): number {
  return Math.exp(-xi * daysAgo);
}

// Calculate expected goals for a matchup
function expectedGoals(
  homeTeam: string,
  awayTeam: string,
  params: DixonColesParams
): { lambdaHome: number; lambdaAway: number } {
  const attH = params.attack[homeTeam] ?? 1;
  const defH = params.defense[homeTeam] ?? 1;
  const attA = params.attack[awayTeam] ?? 1;
  const defA = params.defense[awayTeam] ?? 1;

  return {
    lambdaHome: attH * defA * params.homeAdvantage * params.avgGoals,
    lambdaAway: attA * defH * params.avgGoals,
  };
}

// Log-likelihood for one match
function matchLogLik(
  homeGoals: number,
  awayGoals: number,
  lambdaH: number,
  lambdaA: number,
  rho: number
): number {
  const t = tau(homeGoals, awayGoals, lambdaH, lambdaA, rho);
  if (t <= 0) return -1000;
  return logPoissonPmf(homeGoals, lambdaH) + logPoissonPmf(awayGoals, lambdaA) + Math.log(t);
}

// Fit the Dixon-Coles model via coordinate descent
export function fitDixonColes(
  matches: Match[],
  xi: number = 0.0019
): DixonColesParams {
  // Get unique teams
  const teams = [...new Set(matches.flatMap((m) => [m.homeTeam, m.awayTeam]))].sort();
  const nTeams = teams.length;

  // Initialize parameters
  const attack: Record<string, number> = {};
  const defense: Record<string, number> = {};
  for (const t of teams) {
    attack[t] = 1.0;
    defense[t] = 1.0;
  }
  let homeAdv = 1.25;
  let rho = -0.05;

  // Calculate reference date (most recent match)
  const refDate = new Date(
    Math.max(...matches.map((m) => new Date(m.date).getTime()))
  );

  // Precompute time weights
  const weights = matches.map((m) => {
    const daysAgo = (refDate.getTime() - new Date(m.date).getTime()) / 86400000;
    return timeWeight(daysAgo, xi);
  });

  // Average goals per game (weighted)
  let totalWeightedGoals = 0;
  let totalWeight = 0;
  for (let i = 0; i < matches.length; i++) {
    totalWeightedGoals += weights[i] * (matches[i].homeGoals + matches[i].awayGoals);
    totalWeight += weights[i] * 2;
  }
  const avgGoals = totalWeightedGoals / totalWeight;

  // Coordinate descent: iterate until convergence
  const lr = 0.001;
  const ITERATIONS = 500;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // Update each team's attack parameter
    for (const team of teams) {
      let numerator = 0;
      let denominator = 0;

      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const w = weights[i];

        if (m.homeTeam === team) {
          numerator += w * m.homeGoals;
          denominator += w * defense[m.awayTeam] * homeAdv * avgGoals;
        } else if (m.awayTeam === team) {
          numerator += w * m.awayGoals;
          denominator += w * defense[m.homeTeam] * avgGoals;
        }
      }

      if (denominator > 0) {
        attack[team] = Math.max(0.01, numerator / denominator);
      }
    }

    // Update each team's defense parameter
    for (const team of teams) {
      let numerator = 0;
      let denominator = 0;

      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const w = weights[i];

        if (m.homeTeam === team) {
          // This team is defending at home, opponent scored awayGoals
          numerator += w * m.awayGoals;
          denominator += w * attack[m.awayTeam] * avgGoals;
        } else if (m.awayTeam === team) {
          // This team is defending away, opponent scored homeGoals
          numerator += w * m.homeGoals;
          denominator += w * attack[m.homeTeam] * homeAdv * avgGoals;
        }
      }

      if (denominator > 0) {
        defense[team] = Math.max(0.01, numerator / denominator);
      }
    }

    // Normalize: mean attack = 1.0 (identifiability constraint)
    const meanAtt = teams.reduce((s, t) => s + attack[t], 0) / nTeams;
    const meanDef = teams.reduce((s, t) => s + defense[t], 0) / nTeams;
    for (const t of teams) {
      attack[t] /= meanAtt;
      defense[t] /= meanDef;
    }

    // Update home advantage
    {
      let numH = 0, denH = 0;
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const w = weights[i];
        numH += w * m.homeGoals;
        denH += w * attack[m.homeTeam] * defense[m.awayTeam] * avgGoals;
      }
      if (denH > 0) homeAdv = Math.max(0.5, Math.min(2.0, numH / denH));
    }

    // Update rho via grid search (small range)
    {
      let bestRho = rho;
      let bestLL = -Infinity;
      for (let r = -0.15; r <= 0.05; r += 0.005) {
        let ll = 0;
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          const lambdaH = attack[m.homeTeam] * defense[m.awayTeam] * homeAdv * avgGoals;
          const lambdaA = attack[m.awayTeam] * defense[m.homeTeam] * avgGoals;
          ll += weights[i] * matchLogLik(m.homeGoals, m.awayGoals, lambdaH, lambdaA, r);
        }
        if (ll > bestLL) {
          bestLL = ll;
          bestRho = r;
        }
      }
      rho = bestRho;
    }
  }

  return {
    attack,
    defense,
    homeAdvantage: homeAdv,
    rho,
    avgGoals,
    fittedAt: new Date().toISOString(),
  };
}

// Generate probability grid for a matchup
export function predictMatch(
  homeTeam: string,
  awayTeam: string,
  params: DixonColesParams
): ProbabilityGrid {
  const { lambdaHome, lambdaAway } = expectedGoals(homeTeam, awayTeam, params);
  const grid: ProbabilityGrid = [];

  let total = 0;
  for (let h = 0; h <= MAX_GOALS; h++) {
    grid[h] = [];
    for (let a = 0; a <= MAX_GOALS; a++) {
      const p = poissonPmf(h, lambdaHome) * poissonPmf(a, lambdaAway) *
        tau(h, a, lambdaHome, lambdaAway, params.rho);
      grid[h][a] = Math.max(0, p);
      total += grid[h][a];
    }
  }

  // Normalize
  if (total > 0) {
    for (let h = 0; h <= MAX_GOALS; h++) {
      for (let a = 0; a <= MAX_GOALS; a++) {
        grid[h][a] /= total;
      }
    }
  }

  return grid;
}

// Get expected goals for display
export function getExpectedGoals(
  homeTeam: string,
  awayTeam: string,
  params: DixonColesParams
): { home: number; away: number } {
  const { lambdaHome, lambdaAway } = expectedGoals(homeTeam, awayTeam, params);
  return {
    home: Math.round(lambdaHome * 100) / 100,
    away: Math.round(lambdaAway * 100) / 100,
  };
}
