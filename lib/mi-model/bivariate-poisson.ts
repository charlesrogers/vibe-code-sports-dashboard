/**
 * Bivariate Poisson Math — Core PMF + probability derivations
 *
 * Implements Karlis-Ntzoufras (2003) bivariate Poisson distribution.
 * When lambda3=0, degenerates to independent Poisson (product of marginals).
 */

// ---------- Cached factorial / combinations ----------

const factorialCache: number[] = [1, 1];

export function factorial(n: number): number {
  if (n < 0) return 0;
  if (n < factorialCache.length) return factorialCache[n];
  for (let i = factorialCache.length; i <= n; i++) {
    factorialCache[i] = factorialCache[i - 1] * i;
  }
  return factorialCache[n];
}

const combCache = new Map<string, number>();

export function comb(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  const key = `${n},${k}`;
  const cached = combCache.get(key);
  if (cached !== undefined) return cached;
  const val = factorial(n) / (factorial(k) * factorial(n - k));
  combCache.set(key, val);
  return val;
}

// ---------- Poisson PMF ----------

/**
 * Standard Poisson probability mass function: P(X=k | lambda)
 */
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  // Use log to avoid overflow for large k
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k));
}

function logFactorial(n: number): number {
  if (n <= 1) return 0;
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
}

// ---------- Bivariate Poisson PMF ----------

/**
 * Bivariate Poisson PMF (Karlis-Ntzoufras 2003)
 *
 * P(X=x, Y=y) = exp(-(lam1+lam2+lam3)) * (lam1^x/x!) * (lam2^y/y!) *
 *               sum_{k=0}^{min(x,y)} C(x,k)*C(y,k)*k! * (lam3/(lam1*lam2))^k
 *
 * When lam3=0: P(X=x,Y=y) = P_Poisson(x|lam1) * P_Poisson(y|lam2)
 */
export function bivariatePoisson(
  x: number,
  y: number,
  lam1: number,
  lam2: number,
  lam3: number
): number {
  // Handle lam3=0 case: independent Poisson
  if (Math.abs(lam3) < 1e-12) {
    return poissonPmf(x, lam1) * poissonPmf(y, lam2);
  }

  // Guard against zero lambdas with correlation
  if (lam1 <= 0 || lam2 <= 0) {
    return poissonPmf(x, Math.max(lam1, 0)) * poissonPmf(y, Math.max(lam2, 0));
  }

  const expTerm = Math.exp(-(lam1 + lam2 + lam3));
  const xTerm = Math.pow(lam1, x) / factorial(x);
  const yTerm = Math.pow(lam2, y) / factorial(y);

  let sum = 0;
  const maxK = Math.min(x, y);
  const ratio = lam3 / (lam1 * lam2);

  for (let k = 0; k <= maxK; k++) {
    sum += comb(x, k) * comb(y, k) * factorial(k) * Math.pow(ratio, k);
  }

  return expTerm * xTerm * yTerm * sum;
}

// ---------- Score Grid ----------

/**
 * Generate NxN score probability grid.
 * grid[i][j] = P(home=i, away=j)
 */
export function generateScoreGrid(
  lambdaHome: number,
  lambdaAway: number,
  lambda3: number,
  maxGoals: number = 8
): number[][] {
  const n = maxGoals + 1;
  const grid: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  let totalProb = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      grid[i][j] = bivariatePoisson(i, j, lambdaHome, lambdaAway, lambda3);
      totalProb += grid[i][j];
    }
  }

  // Normalize to ensure probabilities sum to 1 (truncation correction)
  if (totalProb > 0 && Math.abs(totalProb - 1) > 1e-6) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        grid[i][j] /= totalProb;
      }
    }
  }

  return grid;
}

// ---------- Market Probabilities from Grid ----------

/**
 * Derive 1X2 probabilities from score grid.
 */
export function derive1X2(grid: number[][]): { home: number; draw: number; away: number } {
  const n = grid.length;
  let home = 0, draw = 0, away = 0;

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i > j) home += grid[i][j];
      else if (i === j) draw += grid[i][j];
      else away += grid[i][j];
    }
  }

  return { home, draw, away };
}

/**
 * Derive Over/Under probabilities for given lines.
 */
export function deriveOverUnder(
  grid: number[][],
  lines: number[] = [0.5, 1.5, 2.5, 3.5, 4.5]
): Record<string, { over: number; under: number }> {
  const n = grid.length;
  const result: Record<string, { over: number; under: number }> = {};

  for (const line of lines) {
    let under = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i + j < line) under += grid[i][j];
      }
    }
    result[line.toString()] = { over: 1 - under, under };
  }

  return result;
}

/**
 * Derive Both Teams to Score probability from grid.
 */
export function deriveBTTS(grid: number[][]): { yes: number; no: number } {
  const n = grid.length;
  let no = 0;

  // BTTS = No when either team scores 0
  for (let j = 0; j < n; j++) no += grid[0][j]; // home scores 0
  for (let i = 1; i < n; i++) no += grid[i][0]; // away scores 0 (skip 0,0 already counted)

  return { yes: 1 - no, no };
}

/**
 * Derive Asian Handicap probabilities.
 * AH line is from home perspective (e.g., -1.0 means home must win by >1).
 * Returns P(home covers), P(away covers) for each line.
 */
export function deriveAsianHandicap(
  grid: number[][],
  lines: number[] = [-2.5, -1.5, -1, -0.5, 0, 0.5, 1, 1.5, 2.5]
): Record<string, { home: number; away: number }> {
  const n = grid.length;
  const result: Record<string, { home: number; away: number }> = {};

  for (const line of lines) {
    let homeCover = 0;
    let awayCover = 0;

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const adjustedDiff = (i - j) + line; // home goals - away goals + handicap
        if (adjustedDiff > 0) homeCover += grid[i][j];
        else if (adjustedDiff < 0) awayCover += grid[i][j];
        // adjustedDiff === 0 is a push (void) — split evenly or omit
      }
    }

    result[line.toString()] = { home: homeCover, away: awayCover };
  }

  return result;
}

/**
 * Compute expected goals from score grid.
 */
export function expectedGoalsFromGrid(grid: number[][]): { home: number; away: number } {
  const n = grid.length;
  let homeEG = 0, awayEG = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      homeEG += i * grid[i][j];
      awayEG += j * grid[i][j];
    }
  }
  return { home: homeEG, away: awayEG };
}

/**
 * Find the most likely scoreline from the grid.
 */
export function mostLikelyScore(grid: number[][]): { home: number; away: number; prob: number } {
  const n = grid.length;
  let maxProb = 0, bestI = 0, bestJ = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (grid[i][j] > maxProb) {
        maxProb = grid[i][j];
        bestI = i;
        bestJ = j;
      }
    }
  }
  return { home: bestI, away: bestJ, prob: maxProb };
}
