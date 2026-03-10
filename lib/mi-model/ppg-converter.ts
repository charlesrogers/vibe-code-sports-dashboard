/**
 * PPG Converter — Convert MI model ratings to Points Per Game
 *
 * Simulates each team vs all opponents (home and away),
 * averages points to produce Ted's preferred PPG metric.
 */

import { MIModelParams } from "./types";
import { generateScoreGrid, derive1X2 } from "./bivariate-poisson";

/**
 * Compute PPG for a team by simulating against all opponents.
 * Plays one match at home and one away vs each opponent.
 */
export function ratingsToPPG(
  team: string,
  params: MIModelParams,
  maxGoals: number = 8
): number {
  const teamRating = params.teams[team];
  if (!teamRating) throw new Error(`Team not found: ${team}`);

  const opponents = Object.keys(params.teams).filter(t => t !== team);
  if (opponents.length === 0) return 0;

  let totalPoints = 0;
  let matchCount = 0;

  for (const opp of opponents) {
    const oppRating = params.teams[opp];

    // Home match
    {
      const lamHome = teamRating.attack * oppRating.defense * params.homeAdvantage * params.avgGoalRate;
      const lamAway = oppRating.attack * teamRating.defense * params.avgGoalRate;
      const grid = generateScoreGrid(lamHome, lamAway, params.correlation, maxGoals);
      const probs = derive1X2(grid);
      totalPoints += probs.home * 3 + probs.draw * 1;
      matchCount++;
    }

    // Away match
    {
      const lamHome = oppRating.attack * teamRating.defense * params.homeAdvantage * params.avgGoalRate;
      const lamAway = teamRating.attack * oppRating.defense * params.avgGoalRate;
      const grid = generateScoreGrid(lamHome, lamAway, params.correlation, maxGoals);
      const probs = derive1X2(grid);
      // We are the away team, so our points = away_win*3 + draw*1
      totalPoints += probs.away * 3 + probs.draw * 1;
      matchCount++;
    }
  }

  return matchCount > 0 ? totalPoints / matchCount : 0;
}

/**
 * Compute PPG for all teams and update the params object in-place.
 */
export function computeAllPPG(params: MIModelParams): void {
  console.log(`[ppg] Computing PPG for ${Object.keys(params.teams).length} teams...`);
  const start = Date.now();

  for (const teamName of Object.keys(params.teams)) {
    params.teams[teamName].ppg = ratingsToPPG(teamName, params);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[ppg] PPG computation complete in ${elapsed}s`);
}
