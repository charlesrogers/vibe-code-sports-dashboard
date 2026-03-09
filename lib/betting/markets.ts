import { ProbabilityGrid, BettingMarkets } from "../types";

export function derive1X2(grid: ProbabilityGrid): { home: number; draw: number; away: number } {
  let home = 0, draw = 0, away = 0;
  for (let h = 0; h < grid.length; h++) {
    for (let a = 0; a < grid[h].length; a++) {
      if (h > a) home += grid[h][a];
      else if (h === a) draw += grid[h][a];
      else away += grid[h][a];
    }
  }
  return { home, draw, away };
}

export function deriveOverUnder(
  grid: ProbabilityGrid,
  line: number
): { over: number; under: number } {
  let over = 0;
  for (let h = 0; h < grid.length; h++) {
    for (let a = 0; a < grid[h].length; a++) {
      if (h + a > line) over += grid[h][a];
    }
  }
  return { over, under: 1 - over };
}

export function deriveBTTS(grid: ProbabilityGrid): { yes: number; no: number } {
  let yes = 0;
  for (let h = 1; h < grid.length; h++) {
    for (let a = 1; a < grid[h].length; a++) {
      yes += grid[h][a];
    }
  }
  return { yes, no: 1 - yes };
}

export function deriveCorrectScore(
  grid: ProbabilityGrid,
  topN: number = 10
): { score: string; probability: number }[] {
  const scores: { score: string; probability: number }[] = [];
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      if (grid[h]?.[a] > 0.001) {
        scores.push({ score: `${h}-${a}`, probability: grid[h][a] });
      }
    }
  }
  return scores.sort((a, b) => b.probability - a.probability).slice(0, topN);
}

export function deriveAsianHandicap(
  grid: ProbabilityGrid
): { line: number; homeProb: number; awayProb: number }[] {
  const lines = [-2.5, -1.5, -0.5, 0, 0.5, 1.5, 2.5];
  return lines.map((line) => {
    let homeCovers = 0;
    for (let h = 0; h < grid.length; h++) {
      for (let a = 0; a < grid[h].length; a++) {
        const diff = h - a;
        if (diff + line > 0) homeCovers += grid[h][a];
        else if (diff + line === 0) homeCovers += grid[h][a] * 0.5; // push = half refund
      }
    }
    return { line, homeProb: homeCovers, awayProb: 1 - homeCovers };
  });
}

export function predictedScore(grid: ProbabilityGrid): { home: number; away: number } {
  let bestH = 0, bestA = 0, bestP = 0;
  for (let h = 0; h <= 5; h++) {
    for (let a = 0; a <= 5; a++) {
      if (grid[h]?.[a] > bestP) {
        bestP = grid[h][a];
        bestH = h;
        bestA = a;
      }
    }
  }
  return { home: bestH, away: bestA };
}

export function probabilityToDecimalOdds(p: number): number {
  if (p <= 0) return 999;
  return Math.round((1 / p) * 100) / 100;
}

export function deriveAllMarkets(grid: ProbabilityGrid): BettingMarkets {
  const ouLines = [0.5, 1.5, 2.5, 3.5, 4.5];
  const overUnder: Record<string, { over: number; under: number }> = {};
  for (const line of ouLines) {
    overUnder[line.toString()] = deriveOverUnder(grid, line);
  }

  return {
    match1X2: derive1X2(grid),
    overUnder,
    btts: deriveBTTS(grid),
    correctScore: deriveCorrectScore(grid),
    asianHandicap: deriveAsianHandicap(grid),
    predictedScore: predictedScore(grid),
  };
}
