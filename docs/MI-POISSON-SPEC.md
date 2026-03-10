# Market-Implied Bivariate Poisson Model — Implementation Spec

## 1. Overview

Reverse-engineers team attack/defense ratings from betting odds using a bivariate Poisson framework (Dixon-Coles 1997 + Karlis-Ntzoufras 2003 correlation). Produces fair match probabilities, season simulations, and value detection — the "other half" of Ted's system alongside xG variance.

## 2. File Structure

```
lib/mi-model/
├── types.ts                  # All interfaces
├── bivariate-poisson.ts      # Core math: PMF, score grid, 1X2 derivation
├── solver.ts                 # Coordinate descent optimizer
├── predictor.ts              # Match prediction from solved ratings
├── simulator.ts              # Monte Carlo season simulator
├── value-detector.ts         # Edge detection vs current market
├── integration.ts            # Combine MI + variance signals
├── ppg-converter.ts          # Lambda → PPG (Ted's display format)
└── data-prep.ts              # football-data.co.uk → MarketMatch[]

app/api/mi-model/
├── solve/route.ts            # POST: solve ratings for league/season
├── predict/route.ts          # GET: predict a specific match
├── simulate/route.ts         # GET: season simulation
├── value/route.ts            # GET: current value bets
└── ratings/route.ts          # GET: team ratings

app/api/mi-benchmark/
└── route.ts                  # Walk-forward backtest
```

## 3. Key Interfaces

```typescript
/** Per-team ratings solved from market odds */
interface MITeamRating {
  team: string;
  attack: number;      // alpha — attack lambda component
  defense: number;     // beta — defense lambda component
  ppg: number;         // Points Per Game (0-3 scale)
  matchesUsed: number;
}

/** Global model parameters */
interface MIModelParams {
  teams: Record<string, MITeamRating>;
  homeAdvantage: number;   // gamma — multiplicative home boost
  correlation: number;     // rho — bivariate Poisson lambda3
  avgGoalRate: number;     // league-average goals/team/match
  leagueId: string;
  season: string;
  convergenceInfo: { iterations: number; finalLoss: number; converged: boolean };
}

/** Match with devigged market probabilities (solver input) */
interface MarketMatch {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  marketProbs: { home: number; draw: number; away: number };
  result?: { homeGoals: number; awayGoals: number } | null;
  weight: number; // time-decay weight
}

/** Model output for a matchup */
interface MatchPrediction {
  homeTeam: string;
  awayTeam: string;
  lambdaHome: number;
  lambdaAway: number;
  scoreGrid: number[][];  // P(home=i, away=j)
  probs1X2: { home: number; draw: number; away: number };
  overUnder: Record<string, { over: number; under: number }>;
  btts: { yes: number; no: number };
}

/** Value bet found */
interface ValueBet {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  selection: string;       // "home" | "draw" | "away" | "over2.5"
  modelProb: number;
  marketProb: number;
  edge: number;
  varianceAgreement: boolean | null;
  combinedSignal: "strong" | "moderate" | "model_only" | "variance_only" | null;
}
```

## 4. Bivariate Poisson Math

### PMF (Karlis-Ntzoufras 2003)

```
P(X=x, Y=y) = exp(-(λ₁ + λ₂ + λ₃)) × (λ₁ˣ/x!) × (λ₂ʸ/y!) ×
               Σ(k=0 to min(x,y)) [ C(x,k) × C(y,k) × k! × (λ₃/(λ₁×λ₂))ᵏ ]
```

When λ₃=0: degenerates to independent Poisson (backward compatible).

λ₃ affects ALL scorelines (unlike Dixon-Coles tau which only adjusts 0-0, 1-0, 0-1, 1-1).

### Score Grid → Probabilities

```
P(home win) = Σ grid[i][j] where i > j
P(draw)     = Σ grid[i][i]
P(away win) = Σ grid[i][j] where i < j
P(over 2.5) = 1 - Σ grid[i][j] where i+j ≤ 2
```

## 5. The Solver

### What It Solves

Given: N matches with devigged Pinnacle 1X2 probabilities.
Find: attack[t], defense[t] for each team, plus homeAdvantage, lambda3, avgGoalRate.

### Expected Goals per Match

```
λ_home = attack_home × defense_away × homeAdvantage × avgGoalRate
λ_away = attack_away × defense_home × avgGoalRate
```

### Loss Function: KL-Divergence

```
L = Σ_matches [ weight_m × KL(market || model) ]
  + regularization × Σ_teams [ (attack_t - 1)² + (defense_t - 1)² ]

where KL(p||q) = p_home × ln(p_home/q_home) + p_draw × ln(p_draw/q_draw) + p_away × ln(p_away/q_away)
```

### Algorithm: Coordinate Descent

```
1. INITIALIZE:
   attack[t] = 1.0, defense[t] = 1.0 for all teams
   homeAdvantage = 1.25, lambda3 = 0.05, avgGoalRate = 1.35

2. COMPUTE TIME WEIGHTS:
   weight = exp(-ξ × daysAgo), ξ = 0.005 (half-life ~140 days)

3. ITERATE (up to 200 iterations):
   a. For each team: update attack[t] via grid search [0.3, 3.0]
   b. For each team: update defense[t] via grid search [0.3, 3.0]
   c. NORMALIZE: mean(attack) = 1.0, mean(defense) = 1.0
   d. Update homeAdvantage: grid search [0.8, 1.8]
   e. Update lambda3: grid search [-0.15, 0.05]
   f. Update avgGoalRate: grid search [1.0, 1.8]
   g. CHECK: |loss_new - loss_old| < 1e-6 → converged

4. CONVERT to PPG: simulate each team vs all opponents
```

### Performance

- 20 teams × 2 params × 40 grid points × 19 matches × 81 grid cells = ~2.5M ops/iteration
- 200 iterations = ~500M ops = 3-8 seconds in Node.js
- Fits within Vercel 60s serverless limit

## 6. Monte Carlo Season Simulator

```
Input: solved ratings, remaining fixtures, current standings
Output: 10,000 simulated season outcomes

For each simulation:
  1. Copy current standings + ratings
  2. For each remaining fixture:
     - Compute λ_home, λ_away
     - Sample score from bivariate Poisson
     - Update points table
     - Optional: drift ratings based on outperformance
  3. Record final positions

Aggregate: P(title), P(top4), P(relegation) per team
```

Rating drift formula: `rating_new = rating_old × (1 + outperformance × drift_factor)`
Drift factor: 0 for top leagues, 0.05-0.15 for Championship.

## 7. Integration with Variance Model

```
MI says bet + Variance says bet → HIGH CONFIDENCE ("Model bet")
MI says bet + Variance neutral  → MODEL BET (follow)
MI neutral  + Variance says bet → ME BET (flagged, Ted's concept)
Both say no                     → PASS
Edge ≥ 10 cents of play?        → Final filter
```

## 8. Data Pipeline

```
football-data.co.uk CSVs → data-prep.ts → MarketMatch[]
  ↓
solver.ts → MIModelParams (cached in data/mi-model/)
  ↓
predictor.ts → MatchPrediction for upcoming matches
  ↓
value-detector.ts → ValueBet[] (edges ≥ 5%)
  ↓
integration.ts → CombinedAssessment (MI + variance)
```

We already have: 90 odds files (18 leagues × 5 seasons) with Pinnacle closing odds.

## 9. Testing Strategy

1. **Synthetic test**: Create known ratings → generate market probs → verify solver recovers them
2. **Calibration**: Reliability diagram — 40% predicted events should happen ~40% of time
3. **Brier score**: MI model should be within 2% of market Brier (derived from market odds)
4. **ROI on value bets**: The metric that actually matters
5. **CLV**: Does our line move in the right direction by closing?

## 10. Build Sequence

| Phase | What | Estimated |
|-------|------|-----------|
| 1 | bivariate-poisson.ts + types.ts + unit tests | Day 1 |
| 2 | solver.ts + data-prep.ts + convergence tests | Days 2-3 |
| 3 | predictor.ts + value-detector.ts + API routes | Day 4 |
| 4 | simulator.ts | Day 5 |
| 5 | integration.ts + mi-benchmark.ts + calibration | Days 6-7 |

## 11. Resolved Decisions

1. **Asian Handicap**: AVAILABLE. All 90 odds files now include AH line, Pinnacle AH odds (opening + closing), B365 AH, max/avg AH. The solver should use BOTH 1X2 and AH data for richer signal. AH provides the handicap line (e.g., -1.0) which directly constrains the goal difference expectation.
2. **Walk-forward**: YES. Re-solve ratings using only matches before each test date for backtesting. Live predictions use all available data.
3. **Rating drift**: BUILD FROM DAY 1. Use drift_factor=0 for top leagues initially but wire the parameter through from the start. Championship/Serie B use 0.05-0.15.
4. **Devig method**: Start with multiplicative (already implemented). Consider Shin's method as a future improvement.
