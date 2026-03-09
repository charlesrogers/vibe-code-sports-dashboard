// Precomputed log factorials for efficiency (up to 20 goals)
const LOG_FACTORIALS: number[] = [0];
for (let i = 1; i <= 20; i++) {
  LOG_FACTORIALS[i] = LOG_FACTORIALS[i - 1] + Math.log(i);
}

export function logFactorial(n: number): number {
  if (n <= 20) return LOG_FACTORIALS[n];
  let result = LOG_FACTORIALS[20];
  for (let i = 21; i <= n; i++) result += Math.log(i);
  return result;
}

// P(X = k) for Poisson distribution
export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k));
}

// Log P(X = k)
export function logPoissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 0 : -Infinity;
  return k * Math.log(lambda) - lambda - logFactorial(k);
}
