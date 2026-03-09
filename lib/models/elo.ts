import { Match, EloRating } from "../types";

const INITIAL_RATING = 1500;
const K = 32;
const HOME_ADVANTAGE = 65;

function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

export function calculateEloRatings(matches: Match[]): EloRating[] {
  const ratings: Record<string, number> = {};

  // Sort chronologically
  const sorted = [...matches].sort((a, b) => a.date.localeCompare(b.date));

  for (const m of sorted) {
    if (!(m.homeTeam in ratings)) ratings[m.homeTeam] = INITIAL_RATING;
    if (!(m.awayTeam in ratings)) ratings[m.awayTeam] = INITIAL_RATING;

    const rH = ratings[m.homeTeam] + HOME_ADVANTAGE;
    const rA = ratings[m.awayTeam];

    const eH = expectedScore(rH, rA);
    const eA = 1 - eH;

    // Actual score: 1 = win, 0.5 = draw, 0 = loss
    let sH: number, sA: number;
    if (m.homeGoals > m.awayGoals) { sH = 1; sA = 0; }
    else if (m.homeGoals < m.awayGoals) { sH = 0; sA = 1; }
    else { sH = 0.5; sA = 0.5; }

    // Goal difference multiplier (rewards bigger wins)
    const gd = Math.abs(m.homeGoals - m.awayGoals);
    const gdMult = gd <= 1 ? 1 : gd === 2 ? 1.5 : (11 + gd) / 8;

    ratings[m.homeTeam] += K * gdMult * (sH - eH);
    ratings[m.awayTeam] += K * gdMult * (sA - eA);
  }

  return Object.entries(ratings)
    .map(([team, rating]) => ({ team, rating: Math.round(rating) }))
    .sort((a, b) => b.rating - a.rating);
}

// Win probability from ELO ratings (with home advantage)
export function eloWinProbability(
  homeRating: number,
  awayRating: number
): { home: number; draw: number; away: number } {
  const eH = expectedScore(homeRating + HOME_ADVANTAGE, awayRating);
  // Approximate draw probability from ELO spread
  const diff = Math.abs(homeRating + HOME_ADVANTAGE - awayRating);
  const drawProb = Math.max(0.15, 0.36 - diff * 0.001);
  const homeWin = eH * (1 - drawProb);
  const awayWin = (1 - eH) * (1 - drawProb);
  return { home: homeWin, draw: drawProb, away: awayWin };
}
