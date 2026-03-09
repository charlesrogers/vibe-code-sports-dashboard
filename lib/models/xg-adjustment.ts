import { Match, TeamXg } from "../types";

// Blend actual goals with xG to produce adjusted match data
// This reduces noise from lucky/unlucky results
export function adjustMatchesWithXg(
  matches: Match[],
  teamXg: TeamXg[],
  xgWeight: number = 0.35
): Match[] {
  if (teamXg.length === 0) return matches;

  // Build per-team xG adjustment ratios
  const xgMap = new Map<string, { attackAdj: number; defenseAdj: number }>();
  for (const t of teamXg) {
    if (t.matches === 0) continue;
    const goalsPG = t.goalsFor / t.matches;
    const xgPG = t.xGFor / t.matches;
    const gaPG = t.goalsAgainst / t.matches;
    const xgaPG = t.xGAgainst / t.matches;

    // Ratio of xG to actual (>1 means underperforming, <1 means overperforming)
    const attackAdj = goalsPG > 0 ? ((1 - xgWeight) * goalsPG + xgWeight * xgPG) / goalsPG : 1;
    const defenseAdj = gaPG > 0 ? ((1 - xgWeight) * gaPG + xgWeight * xgaPG) / gaPG : 1;
    xgMap.set(t.team, { attackAdj, defenseAdj });
  }

  return matches.map((m) => {
    const homeAdj = xgMap.get(m.homeTeam);
    const awayAdj = xgMap.get(m.awayTeam);
    if (!homeAdj || !awayAdj) return m;

    return {
      ...m,
      // Adjust home goals by home attack adjustment and away defense adjustment
      homeGoals: Math.max(0, Math.round(m.homeGoals * homeAdj.attackAdj * awayAdj.defenseAdj)),
      awayGoals: Math.max(0, Math.round(m.awayGoals * awayAdj.attackAdj * homeAdj.defenseAdj)),
    };
  });
}
