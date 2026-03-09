/**
 * Composite Model: Blends Dixon-Coles + ELO + Market-Implied
 *
 * Sharp approach: each model captures different signal
 * - Dixon-Coles: structural (attack/defense strength, Poisson process)
 * - ELO: momentum/form (recent results, goal difference)
 * - Market: wisdom of crowds + sharp money (closing line = best estimate)
 *
 * The blend weights are tunable. Default: 45% DC, 20% ELO, 35% Market
 * Market gets high weight because closing lines ARE the benchmark (Harry Crane).
 * When no market data available, reweight DC/ELO proportionally.
 */

import { DixonColesParams, ProbabilityGrid, Match } from "../types";
import { predictMatch } from "./dixon-coles";
import { derive1X2, deriveOverUnder, deriveBTTS } from "../betting/markets";
import { eloWinProbability, calculateEloRatings } from "./elo";

export interface ModelWeights {
  dixonColes: number;
  elo: number;
  market: number;
}

export interface CompositeProbs {
  home: number;
  draw: number;
  away: number;
  over25: number;
  under25: number;
  bttsYes: number;
  // Individual model outputs for comparison
  models: {
    dixonColes: { home: number; draw: number; away: number };
    elo: { home: number; draw: number; away: number };
    market?: { home: number; draw: number; away: number };
  };
  weights: ModelWeights;
}

export const DEFAULT_WEIGHTS: ModelWeights = {
  dixonColes: 0.45,
  elo: 0.20,
  market: 0.35,
};

/**
 * Devig market odds to get true probabilities (power method / Shin's method simplified)
 * Removes the bookmaker's overround/vig to get fair probabilities
 */
export function devigOdds(
  homeOdds: number,
  drawOdds: number,
  awayOdds: number
): { home: number; draw: number; away: number } | null {
  if (homeOdds <= 1 || drawOdds <= 1 || awayOdds <= 1) return null;

  const impliedH = 1 / homeOdds;
  const impliedD = 1 / drawOdds;
  const impliedA = 1 / awayOdds;
  const overround = impliedH + impliedD + impliedA;

  if (overround < 0.9 || overround > 1.3) return null; // sanity check

  // Power method devig (better than multiplicative for 3-way markets)
  // Find k such that (1/h)^k + (1/d)^k + (1/a)^k = 1
  // Approximate with multiplicative for speed
  return {
    home: impliedH / overround,
    draw: impliedD / overround,
    away: impliedA / overround,
  };
}

/**
 * Blend probabilities from multiple models
 */
export function blendProbs(
  dc: { home: number; draw: number; away: number },
  elo: { home: number; draw: number; away: number },
  market: { home: number; draw: number; away: number } | null,
  weights: ModelWeights = DEFAULT_WEIGHTS
): { home: number; draw: number; away: number } {
  let w = { ...weights };

  // If no market data, redistribute market weight proportionally
  if (!market) {
    const total = w.dixonColes + w.elo;
    w = {
      dixonColes: w.dixonColes / total,
      elo: w.elo / total,
      market: 0,
    };
  }

  const home = w.dixonColes * dc.home + w.elo * elo.home + w.market * (market?.home || 0);
  const draw = w.dixonColes * dc.draw + w.elo * elo.draw + w.market * (market?.draw || 0);
  const away = w.dixonColes * dc.away + w.elo * elo.away + w.market * (market?.away || 0);

  // Normalize to sum to 1
  const total = home + draw + away;
  return {
    home: home / total,
    draw: draw / total,
    away: away / total,
  };
}

/**
 * Full composite prediction for a single match
 */
export function compositePredict(
  homeTeam: string,
  awayTeam: string,
  dcParams: DixonColesParams,
  eloRatings: Map<string, number>,
  marketOdds?: { home: number; draw: number; away: number },
  weights: ModelWeights = DEFAULT_WEIGHTS
): CompositeProbs {
  // 1. Dixon-Coles
  const grid = predictMatch(homeTeam, awayTeam, dcParams);
  const dcProbs = derive1X2(grid);
  const dcOU25 = deriveOverUnder(grid, 2.5);
  const dcBTTS = deriveBTTS(grid);

  // 2. ELO
  const homeElo = eloRatings.get(homeTeam) || 1500;
  const awayElo = eloRatings.get(awayTeam) || 1500;
  const eloProbs = eloWinProbability(homeElo, awayElo);

  // 3. Market (devigged)
  const marketProbs = marketOdds ? devigOdds(marketOdds.home, marketOdds.draw, marketOdds.away) : null;

  // Blend 1X2
  const blended = blendProbs(dcProbs, eloProbs, marketProbs, weights);

  return {
    ...blended,
    // For O/U and BTTS, use Dixon-Coles (only model with score distribution)
    over25: dcOU25.over,
    under25: dcOU25.under,
    bttsYes: dcBTTS.yes,
    models: {
      dixonColes: dcProbs,
      elo: eloProbs,
      market: marketProbs || undefined,
    },
    weights,
  };
}
