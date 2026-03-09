import { Match, DixonColesParams } from "../types";
import { predictMatch } from "../models/dixon-coles";
import { derive1X2 } from "../betting/markets";

export interface BacktestResult {
  totalMatches: number;
  correctOutcomes: number;
  accuracy: number;
  brierScore: number;
  logLoss: number;
  calibration: { bucket: string; predicted: number; actual: number; count: number }[];
}

export function backtestModel(
  testMatches: Match[],
  params: DixonColesParams
): BacktestResult {
  let correct = 0;
  let brierSum = 0;
  let logLossSum = 0;
  const buckets: Record<string, { predicted: number; actual: number; count: number }> = {};

  // Initialize calibration buckets (0-10%, 10-20%, etc.)
  for (let i = 0; i < 10; i++) {
    const label = `${i * 10}-${(i + 1) * 10}%`;
    buckets[label] = { predicted: 0, actual: 0, count: 0 };
  }

  let evaluated = 0;

  for (const m of testMatches) {
    if (!(m.homeTeam in params.attack) || !(m.awayTeam in params.attack)) continue;

    const grid = predictMatch(m.homeTeam, m.awayTeam, params);
    const probs = derive1X2(grid);

    // Actual outcome
    const actual = m.homeGoals > m.awayGoals ? "home" : m.homeGoals < m.awayGoals ? "away" : "draw";
    const predicted = probs.home >= probs.draw && probs.home >= probs.away ? "home"
      : probs.away >= probs.draw ? "away" : "draw";

    if (actual === predicted) correct++;

    // Brier score: (predicted_prob - actual)^2 for each outcome
    const actH = actual === "home" ? 1 : 0;
    const actD = actual === "draw" ? 1 : 0;
    const actA = actual === "away" ? 1 : 0;
    brierSum += (probs.home - actH) ** 2 + (probs.draw - actD) ** 2 + (probs.away - actA) ** 2;

    // Log loss
    const actualProb = actual === "home" ? probs.home : actual === "draw" ? probs.draw : probs.away;
    logLossSum += -Math.log(Math.max(actualProb, 0.001));

    // Calibration: use the highest predicted probability
    const maxProb = Math.max(probs.home, probs.draw, probs.away);
    const bucketIdx = Math.min(9, Math.floor(maxProb * 10));
    const bucketKey = `${bucketIdx * 10}-${(bucketIdx + 1) * 10}%`;
    buckets[bucketKey].predicted += maxProb;
    buckets[bucketKey].actual += actual === predicted ? 1 : 0;
    buckets[bucketKey].count += 1;

    evaluated++;
  }

  const calibration = Object.entries(buckets)
    .filter(([, v]) => v.count > 0)
    .map(([bucket, v]) => ({
      bucket,
      predicted: Math.round((v.predicted / v.count) * 100) / 100,
      actual: Math.round((v.actual / v.count) * 100) / 100,
      count: v.count,
    }));

  return {
    totalMatches: evaluated,
    correctOutcomes: correct,
    accuracy: evaluated > 0 ? Math.round((correct / evaluated) * 1000) / 10 : 0,
    brierScore: evaluated > 0 ? Math.round((brierSum / evaluated) * 1000) / 1000 : 0,
    logLoss: evaluated > 0 ? Math.round((logLossSum / evaluated) * 1000) / 1000 : 0,
    calibration,
  };
}
