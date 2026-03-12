# Live Model & Bet Selection Overview

## Model: Market-Implied Bivariate Poisson (MI-BP)

### Core Architecture

Dixon-Coles bivariate Poisson model with parameters solved from closing market odds rather than historical results alone.

**Per-team ratings:**
- `attack` (alpha) — offensive strength
- `defense` (beta) — defensive weakness (higher = worse defense)

**Global parameters:**
- `homeAdvantage` (gamma) — multiplicative home boost
- `correlation` (rho/lambda3) — bivariate Poisson correlation (captures low-scoring draw dependency)
- `avgGoalRate` — league-average goals per team per match

**Goal expectation:**
```
lambdaHome = homeTeam.attack * awayTeam.defense * homeAdvantage * avgGoalRate
lambdaAway = awayTeam.attack * homeTeam.defense * avgGoalRate
```

Home/away splits are inherent — the model solves separate attack/defense ratings and applies `homeAdvantage` only to the home side.

### Solver

Iterative optimization over an expanding training window. Loss function is a weighted blend of:

| Signal | Weight | Description |
|--------|--------|-------------|
| KL divergence | 0.6 | Match model 1X2 to Pinnacle closing market |
| Outcome loss | 0.3 | Penalize when model disagrees with actual results |
| AH loss | 0.2 | Match Asian Handicap implied probabilities |
| xG loss | 0.2 | Align with Understat xG when available |

Additional solver features:
- **Time decay**: `exp(-0.005 * daysAgo)` — half-life ~140 days
- **Recent form boost**: 1.5x weight for each team's last 10 matches
- **L2 regularization**: 0.001 (prevents extreme ratings)
- **Lambda3 range**: [-0.08, 0.02] (tightened to prevent over-inflating)
- **Warm-start**: Seeds from previous solve for 3x faster convergence

### Outputs

From the bivariate Poisson score grid (up to 10x10), the model derives:
- **1X2 probabilities** (home / draw / away)
- **Asian Handicap** probabilities for any line
- **Over/Under** totals (2.5, etc.) with totals deflation (0.965x)
- **BTTS** (both teams to score)
- **Most likely scoreline**
- **Expected goals** per team

---

## Bet Selection Filters

### Base Filters (always applied)

| Filter | Setting | Rationale |
|--------|---------|-----------|
| Markets | Sides only (1X2 + AH) | Totals not yet profitable in backtest |
| No draws | Exclude draw bets | High variance, low edge reliability |
| Max odds | 2.5 | Ted's avg winning odds ~1.9; longshots are noise |
| Min edge (CLV) | 7% | `modelProb - closingImpliedProb >= 0.07` |

### Ted Filters (variance betting layer)

Inspired by Ted Knutson's variance betting methodology. These filter *which matches* to bet on, not what the model predicts.

| Filter | Config | What it does |
|--------|--------|--------------|
| **Skip early season** | First 5 matchdays | Model needs data to calibrate; early-season ratings are noisy |
| **Variance filter** | 10-match lookback, 3.0 goal gap | Only bet on regression candidates — teams where actual goals diverge significantly from expected (xG). Core thesis: defensive underperformance (conceding >> xGA) is the most reliable regression signal |
| **Congestion filter** | 3rd match in 8 days | Skip teams on compressed fixture schedules — fatigue makes outcomes less predictable |
| **Defiance filter** | 8+ consecutive matches | Skip teams that have persistently defied model predictions in the same direction — the model may be missing something structural |

### How Variance Filter Works

For each team, track the last 10 matches:
1. Compute `gaGap = sum(actualGA - expectedGA)` over last 10
2. Compute `gfGap = sum(actualGF - expectedGF)` over last 10
3. If `|gaGap| >= 3.0` or `|gfGap| >= 3.0`, team is a **regression candidate**
4. Only bet on matches where at least one team is a regression candidate

The bet is that reality will regress toward the model's expectation — a team conceding 3+ more goals than expected over 10 matches is due for defensive normalization.

---

## Backtest Results (4 leagues, 3 seasons: 2022-25)

### Base Filters Only

| Metric | Value |
|--------|-------|
| Bets | 1,341 |
| ROI | +1.3% |
| CLV | +11.0% |
| P&L | +17.1u |
| Hit rate | 51.7% |
| AH subset ROI | +2.8% |

### With Ted Filters (`--ted`)

| Metric | Value | vs Base |
|--------|-------|---------|
| Bets | 1,013 | -24% |
| ROI | **+2.8%** | +1.5pp |
| CLV | +10.9% | ~same |
| P&L | **+28.8u** | +69% |
| Hit rate | 52.6% | +0.9pp |
| AH subset ROI | **+4.9%** | +2.1pp |

### Season Trend (Ted mode, sides no draws)

| Season | Bets | ROI | CLV |
|--------|------|-----|-----|
| 2022-23 | 335 | +0.7% | +10.9% |
| 2023-24 | 344 | +4.2% | +10.8% |
| 2024-25 | 334 | +3.6% | +11.0% |

### Filter Impact (matches skipped by Ted filters)

| Filter | Skipped | Effect |
|--------|---------|--------|
| Variance | 506 | Biggest impact — removed non-regression noise |
| Congestion | 369 | Avoided unpredictable fixture pile-ups |
| Early season | 183 | Skipped unreliable early ratings |
| Defiance | 56 | Avoided structurally misunderstood teams |

### By Odds Bucket (Ted mode)

| Odds | Bets | ROI | Hit% |
|------|------|-----|------|
| 1.00-1.50 | 8 | +24.0% | 87.5% |
| 1.50-2.00 | 587 | +1.6% | 54.2% |
| 2.00-2.50 | 417 | +4.4% | 49.9% |

---

## Running the Evaluator

```bash
# Baseline (no Ted filters)
npx tsx scripts/backtest-eval.ts --markets=sides --no-draws --max-odds=2.5 --min-edge=0.07

# Ted mode (all filters)
npx tsx scripts/backtest-eval.ts --markets=sides --no-draws --max-odds=2.5 --min-edge=0.07 --ted

# Individual Ted filters
npx tsx scripts/backtest-eval.ts --variance-filter --skip-early=5 --congestion-filter --defiance-filter

# AH-only view
npx tsx scripts/backtest-eval.ts --markets=ah --no-draws --max-odds=2.5 --min-edge=0.07 --ted
```

Solver cache must exist first (produced by `backtest-v2.ts`). Eval reads from `data/backtest/solver-cache/` and runs in < 0.5 seconds.

---

## Known Gaps / Future Work

- ~~**GK PSxG adjustment**~~: DONE. Lambda adjustment based on Fotmob goals_prevented per 90.
- ~~**Injury-aware ratings**~~: DONE. Fotmob injuries + minutes-based bench filtering + crisis/major lambda reduction.
- **Pass rate filter**: Ted requires 70%+ pass rate for a bet to qualify — not yet implemented (needs historical bet tracking)
- **Fixture context**: Derby matches, end-of-season dead rubbers, title/relegation deciders not weighted differently
- **League-specific totals**: Overs/unders need per-league calibration before going live
- **Longshot-favourite bias**: Market overprices longshots — model could exploit this more explicitly
- **Match-level xG for manager changes**: Currently reduces regression confidence; with match-level xG could filter to post-change data only
