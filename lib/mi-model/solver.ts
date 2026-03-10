/**
 * MI Model Solver — Coordinate Descent Optimizer
 *
 * Solves team attack/defense ratings from devigged market odds
 * using KL-divergence minimization + AH constraint.
 */

import {
  MarketMatch,
  MIModelParams,
  MITeamRating,
  MISolverConfig,
  DEFAULT_SOLVER_CONFIG,
} from "./types";

import {
  generateScoreGrid,
  derive1X2,
  deriveAsianHandicap,
  expectedGoalsFromGrid,
} from "./bivariate-poisson";

// ---------- Loss functions ----------

const EPSILON = 1e-10;

/**
 * KL-divergence: KL(p || q) = sum p_i * ln(p_i / q_i)
 * p = market (target), q = model (approximation)
 */
function klDivergence(
  market: { home: number; draw: number; away: number },
  model: { home: number; draw: number; away: number }
): number {
  const mH = Math.max(model.home, EPSILON);
  const mD = Math.max(model.draw, EPSILON);
  const mA = Math.max(model.away, EPSILON);

  return (
    market.home * Math.log(market.home / mH) +
    market.draw * Math.log(market.draw / mD) +
    market.away * Math.log(market.away / mA)
  );
}

/**
 * Asian Handicap loss: squared error between model expected goal diff
 * and the AH line (adjusted by AH home probability).
 */
function ahLoss(
  modelGrid: number[][],
  ahLine: number,
  _ahHomeProb: number | null
): number {
  const eg = expectedGoalsFromGrid(modelGrid);
  const modelDiff = eg.home - eg.away;
  const marketDiff = -ahLine;
  return (modelDiff - marketDiff) * (modelDiff - marketDiff);
}

/**
 * Outcome loss: Poisson log-likelihood of actual goals given model lambdas.
 * This grounds the model in reality — actual results, not just market prices.
 */
function outcomeLoss(
  lambdaHome: number,
  lambdaAway: number,
  homeGoals: number,
  awayGoals: number
): number {
  // Negative log-likelihood of independent Poisson (ignoring correlation for speed)
  const logLikH = homeGoals * Math.log(Math.max(lambdaHome, EPSILON)) - lambdaHome;
  const logLikA = awayGoals * Math.log(Math.max(lambdaAway, EPSILON)) - lambdaAway;
  return -(logLikH + logLikA); // minimize negative log-lik
}

/**
 * xG loss: squared error between model expected goals and Understat xG.
 * This gives us an independent performance signal beyond market odds.
 */
function xgLoss(
  lambdaHome: number,
  lambdaAway: number,
  xgHome: number,
  xgAway: number
): number {
  return (lambdaHome - xgHome) * (lambdaHome - xgHome) +
         (lambdaAway - xgAway) * (lambdaAway - xgAway);
}

// ---------- Total loss ----------

function computeTotalLoss(
  matches: MarketMatch[],
  teams: Record<string, { attack: number; defense: number }>,
  homeAdvantage: number,
  lambda3: number,
  avgGoalRate: number,
  config: MISolverConfig,
  maxGoals: number = 8
): number {
  let klTotal = 0;
  let ahTotal = 0;
  let outcomeTotal = 0;
  let xgTotal = 0;
  let weightSum = 0;
  let ahWeightSum = 0;
  let outcomeWeightSum = 0;
  let xgWeightSum = 0;

  for (const m of matches) {
    const homeTeam = teams[m.homeTeam];
    const awayTeam = teams[m.awayTeam];
    if (!homeTeam || !awayTeam) continue;

    const lamHome = homeTeam.attack * awayTeam.defense * homeAdvantage * avgGoalRate;
    const lamAway = awayTeam.attack * homeTeam.defense * avgGoalRate;

    // Apply recent form boost
    const w = m.recentForm ? m.weight * (config.recentFormBoost ?? 1.0) : m.weight;

    const grid = generateScoreGrid(lamHome, lamAway, lambda3, maxGoals);
    const modelProbs = derive1X2(grid);

    // KL loss (market odds)
    klTotal += w * klDivergence(m.marketProbs, modelProbs);
    weightSum += w;

    // AH loss (market spreads)
    if (m.ahLine != null) {
      ahTotal += w * ahLoss(grid, m.ahLine, m.ahHomeProb ?? null);
      ahWeightSum += w;
    }

    // Outcome loss (actual results) — Fix #1
    if (m.result && (config.outcomeWeight ?? 0) > 0) {
      outcomeTotal += w * outcomeLoss(lamHome, lamAway, m.result.homeGoals, m.result.awayGoals);
      outcomeWeightSum += w;
    }

    // xG loss (Understat data) — Fix #2
    if (m.xG && (config.xgWeight ?? 0) > 0) {
      xgTotal += w * xgLoss(lamHome, lamAway, m.xG.home, m.xG.away);
      xgWeightSum += w;
    }
  }

  // Regularization
  let reg = 0;
  for (const t of Object.values(teams)) {
    reg += (t.attack - 1) * (t.attack - 1) + (t.defense - 1) * (t.defense - 1);
  }

  const klLoss = weightSum > 0 ? klTotal / weightSum : 0;
  const ahLossVal = ahWeightSum > 0 ? ahTotal / ahWeightSum : 0;
  const outcomeLossVal = outcomeWeightSum > 0 ? outcomeTotal / outcomeWeightSum : 0;
  const xgLossVal = xgWeightSum > 0 ? xgTotal / xgWeightSum : 0;

  return config.klWeight * klLoss +
         config.ahWeight * ahLossVal +
         (config.outcomeWeight ?? 0) * outcomeLossVal +
         (config.xgWeight ?? 0) * xgLossVal +
         config.regularization * reg;
}

// ---------- Grid search helper ----------

function linspace(min: number, max: number, steps: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < steps; i++) {
    arr.push(min + (max - min) * i / (steps - 1));
  }
  return arr;
}

// ---------- Main Solver ----------

/**
 * Solve team ratings from market data using coordinate descent.
 */
export function solveRatings(
  matches: MarketMatch[],
  leagueId: string = "unknown",
  season: string = "unknown",
  config: MISolverConfig = DEFAULT_SOLVER_CONFIG
): MIModelParams {
  const startTime = Date.now();
  console.log(`\n[solver] Starting MI model solver for ${leagueId} ${season}`);
  console.log(`[solver] ${matches.length} matches, max ${config.maxIterations} iterations`);

  // Collect teams
  const teamNames = new Set<string>();
  matches.forEach(m => { teamNames.add(m.homeTeam); teamNames.add(m.awayTeam); });
  console.log(`[solver] ${teamNames.size} teams found`);

  // Initialize ratings
  const teams: Record<string, { attack: number; defense: number }> = {};
  for (const t of teamNames) {
    teams[t] = { attack: 1.0, defense: 1.0 };
  }
  let homeAdvantage = 1.25;
  let lambda3 = 0.05;
  let avgGoalRate = 1.35;

  const maxGoals = 8;
  let prevLoss = Infinity;
  let converged = false;
  let iteration = 0;

  // Precompute grid search values
  const attackGrid = linspace(config.attackRange[0], config.attackRange[1], config.gridSteps);
  const defenseGrid = linspace(config.defenseRange[0], config.defenseRange[1], config.gridSteps);
  const haGrid = linspace(config.homeAdvantageRange[0], config.homeAdvantageRange[1], 20);
  const l3Grid = linspace(config.lambda3Range[0], config.lambda3Range[1], 20);
  const grGrid = linspace(config.avgGoalRateRange[0], config.avgGoalRateRange[1], 20);

  console.log(`[solver] Grid search: ${config.gridSteps} steps for attack/defense, 20 for globals`);

  for (iteration = 1; iteration <= config.maxIterations; iteration++) {
    // (a) Update each team's attack
    for (const teamName of teamNames) {
      const teamMatches = matches.filter(m => m.homeTeam === teamName || m.awayTeam === teamName);
      if (teamMatches.length === 0) continue;

      let bestAttack = teams[teamName].attack;
      let bestLoss = Infinity;

      for (const aVal of attackGrid) {
        const saved = teams[teamName].attack;
        teams[teamName].attack = aVal;
        const loss = computePartialLoss(teamMatches, teams, homeAdvantage, lambda3, avgGoalRate, config, maxGoals);
        if (loss < bestLoss) {
          bestLoss = loss;
          bestAttack = aVal;
        }
        teams[teamName].attack = saved;
      }
      teams[teamName].attack = bestAttack;
    }

    // (b) Update each team's defense
    for (const teamName of teamNames) {
      const teamMatches = matches.filter(m => m.homeTeam === teamName || m.awayTeam === teamName);
      if (teamMatches.length === 0) continue;

      let bestDefense = teams[teamName].defense;
      let bestLoss = Infinity;

      for (const dVal of defenseGrid) {
        const saved = teams[teamName].defense;
        teams[teamName].defense = dVal;
        const loss = computePartialLoss(teamMatches, teams, homeAdvantage, lambda3, avgGoalRate, config, maxGoals);
        if (loss < bestLoss) {
          bestLoss = loss;
          bestDefense = dVal;
        }
        teams[teamName].defense = saved;
      }
      teams[teamName].defense = bestDefense;
    }

    // (c) Normalize: mean attack = 1, mean defense = 1
    const teamList = Array.from(teamNames);
    const meanAttack = teamList.reduce((s, t) => s + teams[t].attack, 0) / teamList.length;
    const meanDefense = teamList.reduce((s, t) => s + teams[t].defense, 0) / teamList.length;
    for (const t of teamList) {
      teams[t].attack /= meanAttack;
      teams[t].defense /= meanDefense;
    }

    // (d) Update homeAdvantage
    {
      let bestHA = homeAdvantage;
      let bestLoss = Infinity;
      for (const ha of haGrid) {
        const loss = computeTotalLoss(matches, teams, ha, lambda3, avgGoalRate, config, maxGoals);
        if (loss < bestLoss) { bestLoss = loss; bestHA = ha; }
      }
      homeAdvantage = bestHA;
    }

    // (e) Update lambda3
    {
      let bestL3 = lambda3;
      let bestLoss = Infinity;
      for (const l3 of l3Grid) {
        const loss = computeTotalLoss(matches, teams, homeAdvantage, l3, avgGoalRate, config, maxGoals);
        if (loss < bestLoss) { bestLoss = loss; bestL3 = l3; }
      }
      lambda3 = bestL3;
    }

    // (f) Update avgGoalRate
    {
      let bestGR = avgGoalRate;
      let bestLoss = Infinity;
      for (const gr of grGrid) {
        const loss = computeTotalLoss(matches, teams, homeAdvantage, lambda3, gr, config, maxGoals);
        if (loss < bestLoss) { bestLoss = loss; bestGR = gr; }
      }
      avgGoalRate = bestGR;
    }

    // (g) Check convergence
    const currentLoss = computeTotalLoss(matches, teams, homeAdvantage, lambda3, avgGoalRate, config, maxGoals);

    if (iteration % config.printEvery === 0 || iteration === 1) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        `[solver] Iter ${iteration}: loss=${currentLoss.toFixed(6)}, ` +
        `HA=${homeAdvantage.toFixed(3)}, λ3=${lambda3.toFixed(4)}, ` +
        `GR=${avgGoalRate.toFixed(3)}, elapsed=${elapsed}s`
      );
    }

    if (Math.abs(currentLoss - prevLoss) < config.convergenceThreshold) {
      converged = true;
      console.log(`[solver] Converged at iteration ${iteration} (loss delta < ${config.convergenceThreshold})`);
      break;
    }
    prevLoss = currentLoss;
  }

  const finalLoss = computeTotalLoss(matches, teams, homeAdvantage, lambda3, avgGoalRate, config, maxGoals);
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[solver] Finished: ${iteration} iterations, final loss=${finalLoss.toFixed(6)}, time=${totalTime}s`);
  console.log(`[solver] Home advantage: ${homeAdvantage.toFixed(3)}, λ3: ${lambda3.toFixed(4)}, Goal rate: ${avgGoalRate.toFixed(3)}`);

  // Build team ratings (PPG computed later)
  const teamRatings: Record<string, MITeamRating> = {};
  for (const t of teamNames) {
    const matchCount = matches.filter(m => m.homeTeam === t || m.awayTeam === t).length;
    teamRatings[t] = {
      team: t,
      attack: teams[t].attack,
      defense: teams[t].defense,
      ppg: 0, // will be filled by ppg-converter
      matchesUsed: matchCount,
    };
  }

  return {
    teams: teamRatings,
    homeAdvantage,
    correlation: lambda3,
    avgGoalRate,
    leagueId,
    season,
    convergenceInfo: {
      iterations: iteration,
      finalLoss,
      converged,
    },
    driftFactor: config.driftFactor,
  };
}

// ---------- Partial loss (for single team updates, faster) ----------

function computePartialLoss(
  teamMatches: MarketMatch[],
  teams: Record<string, { attack: number; defense: number }>,
  homeAdvantage: number,
  lambda3: number,
  avgGoalRate: number,
  config: MISolverConfig,
  maxGoals: number
): number {
  let klTotal = 0;
  let ahTotal = 0;
  let outcomeTotal = 0;
  let xgTotal = 0;
  let weightSum = 0;
  let ahWeightSum = 0;
  let outcomeWeightSum = 0;
  let xgWeightSum = 0;

  for (const m of teamMatches) {
    const homeTeam = teams[m.homeTeam];
    const awayTeam = teams[m.awayTeam];
    if (!homeTeam || !awayTeam) continue;

    const lamHome = homeTeam.attack * awayTeam.defense * homeAdvantage * avgGoalRate;
    const lamAway = awayTeam.attack * homeTeam.defense * avgGoalRate;

    const w = m.recentForm ? m.weight * (config.recentFormBoost ?? 1.0) : m.weight;

    const grid = generateScoreGrid(lamHome, lamAway, lambda3, maxGoals);
    const modelProbs = derive1X2(grid);

    klTotal += w * klDivergence(m.marketProbs, modelProbs);
    weightSum += w;

    if (m.ahLine != null) {
      ahTotal += w * ahLoss(grid, m.ahLine, m.ahHomeProb ?? null);
      ahWeightSum += w;
    }

    if (m.result && (config.outcomeWeight ?? 0) > 0) {
      outcomeTotal += w * outcomeLoss(lamHome, lamAway, m.result.homeGoals, m.result.awayGoals);
      outcomeWeightSum += w;
    }

    if (m.xG && (config.xgWeight ?? 0) > 0) {
      xgTotal += w * xgLoss(lamHome, lamAway, m.xG.home, m.xG.away);
      xgWeightSum += w;
    }
  }

  const involvedTeams = new Set<string>();
  teamMatches.forEach(m => { involvedTeams.add(m.homeTeam); involvedTeams.add(m.awayTeam); });
  let reg = 0;
  for (const tName of involvedTeams) {
    const t = teams[tName];
    if (t) reg += (t.attack - 1) * (t.attack - 1) + (t.defense - 1) * (t.defense - 1);
  }

  const klLoss = weightSum > 0 ? klTotal / weightSum : 0;
  const ahLossVal = ahWeightSum > 0 ? ahTotal / ahWeightSum : 0;
  const outcomeLossVal = outcomeWeightSum > 0 ? outcomeTotal / outcomeWeightSum : 0;
  const xgLossVal = xgWeightSum > 0 ? xgTotal / xgWeightSum : 0;

  return config.klWeight * klLoss +
         config.ahWeight * ahLossVal +
         (config.outcomeWeight ?? 0) * outcomeLossVal +
         (config.xgWeight ?? 0) * xgLossVal +
         config.regularization * reg;
}
