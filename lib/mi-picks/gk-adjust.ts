/**
 * GK PSxG+/- Lambda Adjustment
 *
 * Ted's Playbook: "Goalkeeper quality is the hidden variable that determines
 * whether defensive xGA divergence will actually regress."
 *
 * Elite GK (positive PSxG+/-) → opponent's expected goals reduced
 * Poor GK (negative PSxG+/-) → opponent's expected goals increased
 *
 * Applied AFTER injury adjustment, follows same multiplicative pattern.
 */

import type { GKStats } from "../gk-psxg";

export interface GKAdjustment {
  /** Multiplier applied to opponent's lambda (< 1 = elite GK reducing goals) */
  homeGKAdj: number;
  awayGKAdj: number;
  homeGK: { player: string; goalsPrevented: number; goalsPreventedPer90: number } | null;
  awayGK: { player: string; goalsPrevented: number; goalsPreventedPer90: number } | null;
}

/**
 * How much each goal prevented per 90 translates to lambda adjustment.
 * Conservative: 0.12 means a GK saving +0.5 goals/90 reduces opponent lambda by 6%.
 * Bounded to ±15% max adjustment to avoid outlier GKs dominating.
 */
const GK_IMPACT_PER90 = 0.12;
const MAX_ADJUSTMENT = 0.15; // ±15% cap
const MIN_MATCHES = 8; // need 8+ matches for reliable PSxG+/-

/**
 * Adjust lambdas based on goalkeeper quality.
 *
 * Home GK quality → adjusts away team's lambda (opponent scoring)
 * Away GK quality → adjusts home team's lambda (opponent scoring)
 *
 * Wait — actually the reverse: if the HOME GK is elite, the AWAY team scores
 * fewer goals → reduce lambdaAway. If the AWAY GK is elite → reduce lambdaHome.
 */
export function adjustLambdasForGK(
  lambdaHome: number,
  lambdaAway: number,
  homeGK: GKStats | null,
  awayGK: GKStats | null,
): { lambdaHome: number; lambdaAway: number; adjustment: GKAdjustment } {
  // Away GK quality affects home team's scoring (lambdaHome)
  let homeGKAdj = 1.0;
  // Home GK quality affects away team's scoring (lambdaAway)
  let awayGKAdj = 1.0;

  if (awayGK && awayGK.matchesPlayed >= MIN_MATCHES) {
    // Positive goalsPreventedPer90 = elite GK = reduce home scoring
    const rawAdj = awayGK.goalsPreventedPer90 * GK_IMPACT_PER90;
    homeGKAdj = 1.0 - Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, rawAdj));
  }

  if (homeGK && homeGK.matchesPlayed >= MIN_MATCHES) {
    // Positive goalsPreventedPer90 = elite GK = reduce away scoring
    const rawAdj = homeGK.goalsPreventedPer90 * GK_IMPACT_PER90;
    awayGKAdj = 1.0 - Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, rawAdj));
  }

  return {
    lambdaHome: lambdaHome * homeGKAdj,
    lambdaAway: lambdaAway * awayGKAdj,
    adjustment: {
      homeGKAdj,
      awayGKAdj,
      homeGK: homeGK && homeGK.matchesPlayed >= MIN_MATCHES
        ? { player: homeGK.player, goalsPrevented: homeGK.goalsPrevented, goalsPreventedPer90: homeGK.goalsPreventedPer90 }
        : null,
      awayGK: awayGK && awayGK.matchesPlayed >= MIN_MATCHES
        ? { player: awayGK.player, goalsPrevented: awayGK.goalsPrevented, goalsPreventedPer90: awayGK.goalsPreventedPer90 }
        : null,
    },
  };
}
