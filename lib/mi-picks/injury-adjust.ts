/**
 * Injury Adjustment — Conservative lambda multipliers for severe injuries
 *
 * Only adjusts for major (0.95x) and crisis (0.90x) severity.
 * Moderate and below are display-only (no prediction change).
 */

import type { TeamInjuryReport } from "../injuries";

export interface InjuryContext {
  home: TeamInjuryReport | null;
  away: TeamInjuryReport | null;
  homeAdj: number;
  awayAdj: number;
}

const SEVERITY_MULTIPLIER: Record<string, number> = {
  crisis: 0.90,
  major: 0.95,
  moderate: 1.0,
  minor: 1.0,
  none: 1.0,
};

export function adjustLambdas(
  lambdaHome: number,
  lambdaAway: number,
  homeInjuries: TeamInjuryReport | null,
  awayInjuries: TeamInjuryReport | null,
): { lambdaHome: number; lambdaAway: number; homeAdj: number; awayAdj: number } {
  const homeAdj = SEVERITY_MULTIPLIER[homeInjuries?.severity ?? "none"] ?? 1.0;
  const awayAdj = SEVERITY_MULTIPLIER[awayInjuries?.severity ?? "none"] ?? 1.0;
  return {
    lambdaHome: lambdaHome * homeAdj,
    lambdaAway: lambdaAway * awayAdj,
    homeAdj,
    awayAdj,
  };
}
