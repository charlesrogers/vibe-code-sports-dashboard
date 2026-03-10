/**
 * MI Model Predictor — Generate match predictions from solved ratings
 */

import { MIModelParams, MatchPrediction } from "./types";
import {
  generateScoreGrid,
  derive1X2,
  deriveOverUnder,
  deriveBTTS,
  deriveAsianHandicap,
  expectedGoalsFromGrid,
  mostLikelyScore,
} from "./bivariate-poisson";

/**
 * Predict a match between two teams using solved model parameters.
 */
export function predictMatch(
  params: MIModelParams,
  homeTeam: string,
  awayTeam: string,
  maxGoals: number = 8
): MatchPrediction {
  const home = params.teams[homeTeam];
  const away = params.teams[awayTeam];

  if (!home) throw new Error(`Team not found in model: ${homeTeam}`);
  if (!away) throw new Error(`Team not found in model: ${awayTeam}`);

  // Compute expected goals
  const lambdaHome = home.attack * away.defense * params.homeAdvantage * params.avgGoalRate;
  const lambdaAway = away.attack * home.defense * params.avgGoalRate;
  const lambda3 = params.correlation;

  // Generate score probability grid
  const grid = generateScoreGrid(lambdaHome, lambdaAway, lambda3, maxGoals);

  // Derive all market probabilities
  const probs1X2 = derive1X2(grid);
  const overUnder = deriveOverUnder(grid, [0.5, 1.5, 2.5, 3.5, 4.5]);
  const btts = deriveBTTS(grid);
  const asianHandicap = deriveAsianHandicap(grid, [-2.5, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2.5]);
  const eg = expectedGoalsFromGrid(grid);
  const mls = mostLikelyScore(grid);

  return {
    homeTeam,
    awayTeam,
    lambdaHome,
    lambdaAway,
    lambda3,
    scoreGrid: grid,
    probs1X2,
    overUnder,
    btts,
    asianHandicap,
    expectedGoals: { home: eg.home, away: eg.away, total: eg.home + eg.away },
    mostLikelyScore: mls,
  };
}

/**
 * Format a MatchPrediction for display.
 */
export function formatPrediction(pred: MatchPrediction): string {
  const lines: string[] = [];
  lines.push(`\n========== ${pred.homeTeam} vs ${pred.awayTeam} ==========`);
  lines.push(`Expected Goals: ${pred.lambdaHome.toFixed(2)} - ${pred.lambdaAway.toFixed(2)} (total: ${pred.expectedGoals.total.toFixed(2)})`);
  lines.push(`Lambda3 (correlation): ${pred.lambda3.toFixed(4)}`);
  lines.push(`Most likely score: ${pred.mostLikelyScore.home}-${pred.mostLikelyScore.away} (${(pred.mostLikelyScore.prob * 100).toFixed(1)}%)`);
  lines.push(``);
  lines.push(`1X2: Home ${(pred.probs1X2.home * 100).toFixed(1)}% | Draw ${(pred.probs1X2.draw * 100).toFixed(1)}% | Away ${(pred.probs1X2.away * 100).toFixed(1)}%`);
  lines.push(`Fair odds: H ${(1/pred.probs1X2.home).toFixed(2)} | D ${(1/pred.probs1X2.draw).toFixed(2)} | A ${(1/pred.probs1X2.away).toFixed(2)}`);
  lines.push(``);
  lines.push(`Over/Under:`);
  for (const [line, ou] of Object.entries(pred.overUnder)) {
    lines.push(`  ${line}: Over ${(ou.over * 100).toFixed(1)}% | Under ${(ou.under * 100).toFixed(1)}%`);
  }
  lines.push(``);
  lines.push(`BTTS: Yes ${(pred.btts.yes * 100).toFixed(1)}% | No ${(pred.btts.no * 100).toFixed(1)}%`);
  lines.push(``);
  lines.push(`Asian Handicap:`);
  for (const [line, ah] of Object.entries(pred.asianHandicap)) {
    lines.push(`  ${line}: Home ${(ah.home * 100).toFixed(1)}% | Away ${(ah.away * 100).toFixed(1)}%`);
  }

  // Top 5 most likely scorelines
  lines.push(``);
  lines.push(`Top 5 Scorelines:`);
  const flat: { h: number; a: number; p: number }[] = [];
  for (let i = 0; i < pred.scoreGrid.length; i++) {
    for (let j = 0; j < pred.scoreGrid[i].length; j++) {
      flat.push({ h: i, a: j, p: pred.scoreGrid[i][j] });
    }
  }
  flat.sort((a, b) => b.p - a.p);
  for (let k = 0; k < 5; k++) {
    lines.push(`  ${flat[k].h}-${flat[k].a}: ${(flat[k].p * 100).toFixed(1)}%`);
  }

  return lines.join("\n");
}
