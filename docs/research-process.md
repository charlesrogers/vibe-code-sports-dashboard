# Research Process — Signal Development & Validation

How we develop, test, and deploy betting signals. Written for peer review.

---

## 1. Theoretical Foundation

We implement Ted Knutson's variance betting framework: a Bivariate Poisson model whose team ratings are solved from market odds (the "Market-Implied" or MI model), cross-referenced with expected goals (xG) data to identify where actual results diverge from underlying quality.

The core thesis: **teams whose results significantly diverge from their xG will regress toward their xG-implied level, creating predictable mispricings in betting markets.**

Three independent models vote on each match:
- **MI Bivariate Poisson** — attack/defense lambdas solved from devigged Pinnacle odds
- **Dixon-Coles** — low-scoring match correction model
- **Elo** — form/strength rating system

We bet when model consensus identifies value AND the variance filter confirms the mechanism (regression) is present.

### What we're NOT doing

We are not curve-fitting historical odds. The model's ratings come from the market itself — the edge comes from identifying *when* the market has priced in results that are likely to regress. The xG divergence is the signal; the MI model is the pricing engine.

---

## 2. Signal Lifecycle

Every signal follows the same path. No exceptions.

```
Hypothesis → Pre-register → Backtest → Walk-forward → Deploy → Monitor → Kill/Keep
```

### 2.1 Hypothesis Formation

Signals originate from:
- Ted Knutson's newsletters (857 statements across 112 issues, Sep 2024–Mar 2026)
- Academic literature on football prediction
- Observed patterns in our own backtest data
- Anomalies surfaced by drift detection on live paper trades

Each hypothesis must specify:
- **Mechanism**: Why does this signal work? What market inefficiency does it exploit?
- **Testable prediction**: What specific, falsifiable claim does the signal make?
- **Decision threshold**: At what level does the signal become actionable?

### 2.2 Pre-Registration (MANDATORY)

Before running any test, the hypothesis is logged in `data/signal-registry.json`:

```json
{
  "id": "signal-name",
  "registered": "2026-03-13",
  "hypothesis": "Teams with xGD divergence ≥3 goals over 10 matches regress, creating value on the regression side",
  "metric": "backtest ROI delta vs base",
  "threshold": "+1pp ROI with N≥100",
  "status": "pending"
}
```

**Rules (enforced by convention, not code):**
- Register BEFORE testing. No retroactive registration.
- Never delete failed entries. The registry tracks the denominator of all attempts.
- `status` values: `pending` → `testing` → `accepted` | `rejected` | `graveyard`
- Failed signals stay forever as evidence against overfitting.

**Why this matters:** Without tracking what we tried and rejected, we can't distinguish genuine edges from data-mined artifacts. If we test 20 signals and deploy the 2 that "work," the actual hit rate is 10%, not 100%.

### 2.3 Backtest

```bash
# Test a specific signal
npx tsx scripts/test-signal.ts --signal=signal-id

# Full strategy evaluation with all filters
npx tsx scripts/backtest-eval.ts --ted --by-league --bootstrap

# Alpha decomposition — contribution of each signal
npx tsx scripts/test-signal.ts --decompose
```

**Backtest data:**
- 5 seasons of match data (2020-21 through 2024-25)
- 6 leagues: EPL, La Liga, Bundesliga, Serie A, Serie B, Ligue 1
- Solver snapshots: pre-solved MI lambdas from historical Pinnacle odds
- Real xG from Understat (where available) for xG-based variant testing

**What we measure:**
| Metric | What it tells us | Threshold |
|--------|-----------------|-----------|
| Standalone ROI | Signal alone, no other filters | Must be positive |
| Marginal ROI | Added value on top of existing filters | ≥ +1pp |
| Standalone CLV | Does the signal beat closing lines? | Must be positive |
| Sample size (N) | Statistical reliability | ≥ 100 bets |
| Correlation with base | Overlap with existing signals | < 0.8 (avoid redundancy) |
| Bootstrap p-value | Could this be luck? | < 0.05 |

**What the backtest does NOT tell us:**
- Whether the edge persists in future data (that's what walk-forward is for)
- Whether execution is possible at the modeled odds (slippage, availability)
- Whether the mechanism is causal or coincidental

### 2.4 Walk-Forward Validation (Out-of-Sample)

```bash
npx tsx scripts/test-signal.ts --signal=signal-id --walk-forward
```

The walk-forward test splits data temporally:
- **Train**: Seasons 1–3 (fit parameters, identify thresholds)
- **Validate**: Season 4 (tune, avoid overfitting)
- **Test**: Season 5 (final out-of-sample check — one look only)

A signal that works in-sample but fails out-of-sample is rejected. No re-tuning on the test set.

**Critical constraint:** The test set gets ONE look. If we fail, we don't adjust parameters and re-test. That would defeat the purpose. We either accept the result or register a new, modified hypothesis and wait for fresh data.

### 2.5 Deployment

Accepted signals are implemented in the picks engine (`lib/mi-picks/picks-engine.ts`) and tagged on every bet via `activeSignals[]`.

Currently deployed signals (5):
| Signal | Mechanism | Backtest ROI impact |
|--------|-----------|-------------------|
| `variance-regression` | xGD divergence ≥3 goals / 10 matches | Core signal — all bets require this |
| `congestion-filter` | Skip 3+ matches in 8 days | Removes -2.1% ROI drag |
| `odds-cap-2.0` | Max odds 2.0 (Ted's rule) | +2.0% ROI (+33.2 units) |
| `pass-rate-filter` | Skip league/market combos with <50% hit rate | Removes losing segments |
| `injury-lambda` | 0.90x/0.95x lambda adjustment for key absences | Directional improvement |

Pending signals (7) — registered, not yet fully validated:
- `gk-psxg-regression-adj`, `venue-specific-xgd`, `attack-defense-regression-asymmetry`
- `form-window-rolling-vs-expanding`, `edge-sizing-curve`, `line-movement-filter`
- `double-variance-intersection`

### 2.6 Live Monitoring

Once deployed, signals are monitored via paper trading — not real money.

**Paper trade config:**
- $1,000 bankroll, $20 flat stakes (2% of bank)
- 1% slippage applied to all execution odds
- Bets only on matches within 6 days

**Daily automated pipeline (Vercel crons, UTC):**
| Time | Job | Purpose |
|------|-----|---------|
| 07:00 | Settle bets | Check yesterday's results, compute CLV |
| 08:00 | Accumulate xG | Fetch per-match xG from Fotmob for all 6 leagues |
| 09:00 | Collect odds | Smart-scheduled polling from The Odds API |
| 12:00 | Log picks | Generate MI predictions → apply filters → log paper bets |

**Monitoring layers:**

1. **Per-signal CLV tracking** (`/api/signal-health`)
   - Every bet tagged with which signals were active
   - Per-signal: N, mean CLV, ROI, hit rate, last-10 trend
   - Primary question: "Is each signal still contributing positive CLV?"

2. **CUSUM drift detection** (`lib/paper-trade/drift-detector.ts`)
   - Cumulative sum control chart on CLV residuals
   - Target CLV: 5% (from backtest baseline)
   - Alarm threshold: 3 standard errors
   - Detects regime changes (e.g., bookmakers adapting, model degradation)

3. **Rolling window stats** (`lib/paper-trade/stats.ts`)
   - 30-bet and 50-bet rolling windows
   - Alerts: CLV < 0% (warning), CLV < -3% (critical), hit rate < 45%

4. **Dashboard** (`/` homepage)
   - Signal health card with per-signal CLV, trend arrows
   - Today checklist: data freshness, model status, pending bets

---

## 3. When to Kill a Signal

A deployed signal gets killed (moved to `graveyard`) if:

1. **Live CLV goes negative over 50+ bets** — the signal is no longer beating the closing line
2. **CUSUM alarm fires** — statistically significant regime change detected
3. **The mechanism breaks** — e.g., bookmakers start pricing in xG divergence, eliminating the edge
4. **Marginal contribution turns negative** — adding the signal to the base set makes results worse

Killing a signal means:
- Set `status: "graveyard"` in signal registry (never delete)
- Remove from picks engine filters
- Log the reason and date
- The graveyard entry prevents us from re-discovering and re-deploying the same failed idea

---

## 4. What We Track as Primary Metrics

### CLV (Closing Line Value) — Primary

CLV measures whether we bet at better odds than the market closes at. It's the best available proxy for skill in sports betting because:
- It's not affected by short-term variance (a good bet can lose)
- It measures edge at the moment of execution
- Positive CLV over large samples is the strongest evidence of a genuine edge

```
CLV = (execution_odds - closing_odds) / closing_odds
```

We use Pinnacle's closing line as the benchmark (sharpest book, most efficient market).

### ROI — Secondary

ROI measures actual profit. Over small samples it's dominated by luck. Over large samples it should converge toward CLV. If ROI significantly exceeds CLV, we got lucky. If ROI significantly trails CLV, we got unlucky — but the process is working.

### Hit Rate — Diagnostic

Hit rate alone is meaningless (you can achieve 90% hit rate by betting extreme favorites at terrible odds). We track it to detect calibration issues — if our predicted probabilities say 55% but we're hitting 45%, something is wrong with the model.

---

## 5. Known Limitations & Open Questions

### Limitations

1. **Backtest uses closing odds, not opening odds.** Real execution happens at opening/mid-market odds. CLV calculation assumes we can beat the close, but we measure it against the close — somewhat circular.

2. **No transaction costs.** We model 1% slippage but real-world factors (limited liquidity, account restrictions, market impact) aren't captured.

3. **Small sample sizes.** Even 5 seasons × 6 leagues gives ~500 qualifying bets per signal. Bootstrap confidence intervals are wide.

4. **Overs model doesn't work.** The Bivariate Poisson over-inflates tail probabilities, making Overs bets unprofitable. We only bet Unders via the model; Overs require qualitative xG-driven filters (not yet implemented).

5. **Team name matching is fragile.** Odds API, Fotmob, and football-data-cache use different team names. Manual mapping tables in `picks-engine.ts` break when new teams get promoted.

### Open Questions (registered as pending signals)

- Does venue-specific xGD (home/away splits) outperform blended? (H16)
- Do attack and defense regress at different rates? (H05)
- Is last-10 rolling better than full-season expanding window? (H17)
- Does edge size predict CLV in a non-linear way? (meta-signal)
- Should we skip bets where the line has moved toward us? (H08)
- Does "double variance" (both attack and defense diverging) compound the signal? (H06)

---

## 6. Repo Map

```
data/
  signal-registry.json          # Pre-registration log (source of truth)
  backtest/solver-cache/        # Pre-solved MI lambdas by season/league
  mi-params/latest/             # Current season solved params
  ted-bets/                     # Ted Knutson's actual picks (for comparison)

lib/
  mi-model/solver.ts            # Bivariate Poisson parameter solver
  mi-model/predictor.ts         # Match prediction from solved params
  mi-picks/picks-engine.ts      # Full pick generation pipeline
  mi-picks/ted-filters.ts       # Variance, congestion, defiance filters
  mi-picks/injury-adjust.ts     # Lambda adjustment for injuries
  mi-picks/gk-adjust.ts         # GK PSxG+/- adjustment
  backtest/data-loader.ts       # Unified data loading for backtests
  backtest/bet-evaluator.ts     # Shared bet evaluation loop
  signals/runner.ts             # Signal execution framework
  signals/alpha-decomposition.ts # Per-signal ROI contribution analysis
  paper-trade/logger.ts         # Bet logging (picks → paper bets)
  paper-trade/settler.ts        # Settlement (results → CLV)
  paper-trade/stats.ts          # Stats computation + signal breakdown
  paper-trade/drift-detector.ts # CUSUM change detection

scripts/
  backtest-eval.ts              # Fast strategy backtest (< 1 second)
  test-signal.ts                # Individual signal testing + auto-registration
  multi-league-backtest.ts      # Cross-league walk-forward validation

app/api/
  cron-odds/route.ts            # Odds collection (daily cron)
  cron/accumulate-xg/route.ts   # xG accumulation (daily cron)
  paper-trade/log/route.ts      # Bet logging (daily cron)
  paper-trade/settle/route.ts   # Settlement (daily cron)
  signal-health/route.ts        # Per-signal scorecard API

docs/
  model_cannon.md               # Ted Knutson methodology reference
  research-process.md           # This document
```

---

## 7. Peer Review Checklist

For anyone reviewing this process, the key questions:

1. **Is the pre-registration discipline real?** Check `signal-registry.json` — are there rejected entries? (There should be. If everything passes, we're not testing aggressively enough or we're cheating.)

2. **Is the walk-forward split honest?** The test set should get exactly one look. If parameters were tuned on it, the whole process is compromised.

3. **Are we measuring the right thing?** CLV is our primary metric. ROI is secondary. If someone argues "but the ROI is positive!" while CLV is negative, they're wrong — they got lucky.

4. **Is the sample size adequate?** N < 100 is noise. N < 50 is useless. Bootstrap confidence intervals should be reported for any claimed edge.

5. **Are killed signals actually killed?** Check the graveyard. If nothing's there, either we haven't been rigorous enough or we're not tracking failures.

6. **Is the mechanism plausible?** "This pattern exists in historical data" is not a mechanism. "Teams whose finishing rate exceeds xG-implied rate by 3+ goals will regress because finishing rate has r² = 0.10-0.15" — that's a mechanism.

7. **Could a bookmaker adapt?** If the edge comes from information the market already has (e.g., public xG data), why hasn't it been priced in? Our answer: the market IS mostly efficient — we're looking for temporary mispricings during regression windows, not permanent inefficiencies.
