# Model Canon — Ted Knutson's Methodology & Our Implementation

This document captures everything we know about Ted Knutson's Variance Betting system,
how our MI Poisson model maps to it, where we diverge, what's working, what's not, and
what to do about it. It's the single source of truth for methodology decisions.

---

## Table of Contents

1. [Ted's System Architecture](#1-teds-system-architecture)
2. [Ted's Approach to Totals](#2-teds-approach-to-totals)
3. [Our Model vs Ted's — Where We Align and Diverge](#3-our-model-vs-teds)
4. [Backtest Results](#4-backtest-results)
5. [The Overs Problem — Diagnosis and Root Causes](#5-the-overs-problem)
6. [Decision: Totals Strategy Going Forward](#6-decision-totals-strategy)
7. [Ted's Key Principles (Reference)](#7-teds-key-principles)
8. [Open Questions](#8-open-questions)

---

## 1. Ted's System Architecture

### Two models + human expertise

Ted uses two quantitative models as baselines, then layers in qualitative knowledge:

> "We're going to talk about two models through most of our betting. The first is
> Market-Implied, which is what the bookies think these teams should be rated based
> on past lines. And the second model is expected goals."
> — "Let's Teach, 2025 Edition"

> "I combine a couple of different models to create ratings for each team, then I
> cross-reference that with injury information, sprinkle in Home Field Advantage,
> et voila! we have my version of what the handicap should be."
> — "The Insider Update on Variance Betting"

### Model 1: Market-Implied (MI)

The MI model reverse-engineers team ratings from betting odds:

> "The 'implied' in MI refers to the fact that they are an output from a process
> which takes market prices as an input. What the model asks is: 'What is the set
> of abilities for teams which, when passed to a model, generates output prices
> which best match what we see in the market?'"
> — "Sent to Coventry" (co-authored with Justin Worrall)

> "Under the hood, the MI model uses a modified bivariate Poisson distribution...
> The 'native' rating used by that model is a Poisson 'lambda', but for output
> purposes we prefer to convert to PPG [Points Per Game]."
> — "Sent to Coventry"

This is the same framework our `lib/mi-model/solver.ts` implements — bivariate
Poisson (Dixon-Coles 1997 + Karlis-Ntzoufras 2003), solving team attack/defense
lambdas from market-devigged probabilities.

### Model 2: Expected Goals (xG)

Ted uses xG from FBref (StatsBomb-powered) as his second lens. He does NOT blend
the two models into a single formula — he treats them as independent opinions:

> "We use the models as baselines, then layer in specific extra knowledge we have
> about injuries, coaches, mismatches, whether one team has stopped paying their
> players, etc and use that to figure out if we want to bet or not."

### Edge detection

> "I then compare [my line] to the Market Price, and when those differ by
> approximately a quarter goal or more (.25), I place a wager."
> — "The Insider Update"

### Home field advantage

> "The adjustments in England have usually been between .3 and .4 goals for most
> of the time I have been doing this."
> — "It's finally here!"

Our model solves HFA as a multiplicative parameter (typically 1.12-1.33, which
translates to roughly 0.3-0.5 goals of advantage). This aligns well.

---

## 2. Ted's Approach to Totals

### Key finding: Ted does NOT use a Poisson model for totals

This is the critical insight. Ted's totals bets are **qualitative and team-specific**,
not model-driven:

> "I don't bet a lot of Totals."
> — "It's finally here!"

His tracked season P&L shows totals were near-breakeven:
- EPL Totals: -0.5 units
- Eng Champ Totals: +1 unit
- UEFA CL Totals: 0 units

Totals represent ~9% of his total bet volume, vs ~91% on sides (Asian Handicap).

### 2:1 Under preference

Across the canon, Ted placed ~45 explicit Under bets vs ~22 Over bets. He
acknowledged this:

> "Definitely should have bet more Overs. For some reason, I've generally felt I
> had a cleaner read on what would happen at Bees home matches than the market."

### What drives his Under bets

1. **Tempo / pace of play** — slow teams create Under environments:
   > "Swansea Unders have been the most reliable bet in the Champ this season.
   > Even at 2.25 I would happily bet it." — "Forest Friday"
   > "3 of 13 matches for Swansea have been over 2.5 goals, and each of those
   > only had 3." — "Tuesday 5th Nov 2024"

2. **Sufferball / defensive coaching**:
   > "I feel like this will be sufferball on both sides, so the Under is my play.
   > Who doesn't love rooting for a lack of fun and joy in their football?"

3. **Weather / seasonality** — market underweights this:
   > "Weather is shitty tomorrow up North and the total on this is a bit above 2.
   > I'm taking under 2.25."
   > "These teams plus the time of year and the weather feel like they deserve an
   > Under bet, even at 2.25."

4. **One team dictating terms at low tempo**:
   > "I think this match will more likely be played at Newcastle's tempo, which
   > means Under is pretty interesting."

### What drives his Over bets

1. **"Track meet" matchups** — porous defenses meeting attacking teams:
   > "Ipswich matches are track meets, their defense is pretty porous... I also
   > like Over 3 goals."

2. **High-tempo chaos teams** (Watford, West Ham):
   > "West Ham matches average over 31 shots! Given Brighton's defensive struggles
   > and the mad tempo of West Ham's matches in general, I'm going Over 3."

3. **Brentford home games** — a persistent pattern he identified:
   > "The total on this is 3.5 and biased toward the Over. WHEEEE! Bees home
   > matches and Spurs."

4. **Correlated Overs** — when a big favorite should dominate:
   > "Because Newcastle are fairly big favs, this Over is correlated and might
   > actually be the correct bet period, even if you skip the handicap."

### No structural market bias claim

Ted does NOT argue "the market systematically overprices/underprices totals."
His edge is team-specific and situational:
- The market is **slow to adjust team-level tendencies** (Swansea Unders persisted
  as value for months before the line caught up)
- **Weather/seasonality** may be underweighted
- **Coaching changes** affect totals before the market catches up

### The "double dip" rule

> "I really wanted to bet the Under 3.25, but don't want to double dip on the
> dog with the extra variance I feel is involved."

He avoids betting a side AND a total on the same variance thesis. Exception: when
the side and total are **positively correlated** (big favorite + Over).

---

## 3. Our Model vs Ted's

### Where we align

| Aspect | Ted | Us | Status |
|--------|-----|----|--------|
| MI model (bivariate Poisson) | Core of his system | `lib/mi-model/solver.ts` | Aligned |
| xG variance analysis | FBref, qualitative | `lib/variance/calculator.ts` | Aligned |
| Asian Handicap focus | ~91% of bets | Primary bet type | Aligned |
| Home field advantage | ~0.3-0.4 goals | Solved per league (1.12-1.33x) | Aligned |
| Edge threshold | ~0.25 goals (~5%) | 5% probability edge | Aligned |
| Bet discipline | ~30% of matches | Filter by edge + variance | Aligned |
| Avoid draws | "24% win rate" | Excluded from output | Aligned |
| Cap odds | ~1.9-2.5 avg | Not yet capped | **Gap** |
| Unders preference | 2:1 Under:Over | TOTALS_UNDERS_ONLY=true | Aligned (by necessity) |

### Where we diverge

| Aspect | Ted | Us | Impact |
|--------|-----|----|--------|
| **Totals methodology** | Qualitative (tempo, weather, coaching) | Poisson model P(O/U) | **Our Overs fail** |
| **Injury overlay** | Central to his process | Not implemented | Missing signal |
| **Timing** | 1-2 days before match | Day of | Different market |
| **League scope** | EPL + Championship primary | 6 leagues | More noise |
| **xG source** | FBref (StatsBomb) | Understat + football-data proxy | Different numbers |
| **Qualitative override** | Coaching changes, motivation, etc. | None | Missing signal |

### The critical divergence: Totals

Ted's totals bets are NOT generated by computing P(Over 2.5) from Poisson lambdas.
He uses:
- Team-level tempo and style profiles
- Coaching philosophy (Dyche = Under, attacking coaches = Over)
- Weather and venue conditions
- xG vs actual goals gap → regression expectation
- Matchup-specific tactical analysis

Our model computes P(Over 2.5) = 1 - Σ P(score grid where total ≤ 2) and
compares to market. This is a fundamentally different approach that:
- **Can identify low-scoring environments** (Unders work: +6.8% ROI)
- **Cannot identify high-scoring environments** (Overs fail: -7.5% ROI)

The asymmetry likely exists because:
1. The model correctly spots when its expected goals are BELOW the market's
   implied total (Under signal), because Poisson conservatively estimates
   low-goal outcomes well
2. The model OVER-estimates high-goal scenarios because Poisson's tail is
   fat, lambda3 (correlation) inflates joint high scores, and the model
   systematically predicts 0.187 more goals/match than reality

---

## 4. Backtest Results

### Ted Comparison (76 weeks, 2024-25 + 2025-26)

| | Ted | Our Model |
|---|---|---|
| Total bets | 348 | 201 |
| W/L | 158W / 168L | 65W / 136L |
| Profit | -25.8u | +9.4u |
| Overlap | 40 bets across 76 weeks |

Note: Ted's -25.8u in our backtest likely understates his real performance
because we can't replicate his injury overlays or timing.

### Totals Backtest (6 leagues × 2 seasons, walk-forward 60/40 split)

**After fixes (lambda3 capped at 0.02 + 3.5% deflation):**

| Threshold | Bets | Won | Hit Rate | ROI | Profit |
|-----------|------|-----|----------|-----|--------|
| 3% edge | 1,355 | 662 | 48.9% | -0.9% | -11.9u |
| 5% edge | 1,072 | 525 | 49.0% | -0.1% | -0.8u |
| 7% edge | 784 | 368 | 46.9% | -2.9% | -22.4u |
| 10% edge | 501 | 229 | 45.7% | -4.5% | -22.5u |

**By direction (5% edge):**

| Direction | Bets | Won | Hit Rate | ROI |
|-----------|------|-----|----------|-----|
| Over 2.5 | 514 | 239 | 46.5% | **-7.5%** |
| Under 2.5 | 558 | 286 | 51.3% | **+6.8%** |

**By league (5% edge):**

| League | Bets | Hit Rate | ROI |
|--------|------|----------|-----|
| EPL | 153 | 52.9% | **+11.9%** |
| Championship | 313 | 52.4% | **+5.2%** |
| Ligue-1 | 109 | 46.8% | **+4.2%** |
| La Liga | 159 | 48.4% | +1.3% |
| Serie A | 201 | 46.3% | -9.5% |
| Bundesliga | 137 | 43.1% | -16.6% |

**Before fixes (for comparison):**

| | Before | After |
|---|---|---|
| Overall 5% | -3.3% ROI | -0.1% ROI |
| Overs | -5.9% ROI | -7.5% ROI |
| Unders | +2.3% ROI | +6.8% ROI |

Fixes helped Unders significantly. Overs remain unprofitable.

---

## 5. The Overs Problem

### Diagnostic findings (`scripts/diagnose-overs-bias.ts`)

1. **Expected goals inflation**: Model predicts 2.888 goals/match vs 2.702 actual
   (+0.187 bias, +6.9%)

2. **Lambda3 stuck at boundary**: Solver always picked λ3 = +0.05 (the max allowed
   in the old [-0.15, 0.05] range). This positive correlation inflates P(both teams
   scoring high) by ~2.2% on Overs. Tightened to [-0.08, 0.02].

3. **Calibration gap**: When model says P(Over 2.5) = 65-70%, actual hit rate is
   only 58.5% — a systematic 8.9% overestimate.

4. **Grid truncation**: NOT the issue. maxGoals=8 is sufficient.

5. **Edge detection failure**: At 15%+ "edge" on Overs, actual hit rate is 40.9%
   (should be ~65%). The model's "edge" on Overs is illusory.

### Fixes applied

1. **Lambda3 range**: [-0.15, 0.05] → [-0.08, 0.02] (prevents Over inflation)
2. **Totals deflation**: 3.5% lambda reduction for O/U grid only (separate from
   sides grid). Applied in `predictor.ts` and `our-bets.ts`.

### Why Overs still fail after fixes

The Poisson model fundamentally cannot capture what makes Overs happen:
- **Tempo and pace** — a 0-0 draw between defensive teams and a 3-3 thriller
  can have similar expected goals but wildly different totals
- **Weather/seasonality** — not in the model
- **Coaching style** — not in the model
- **Match state dynamics** — a team chasing a goal opens up, creating more chances
  for both sides. Poisson assumes static rates.
- **Squad rotation / fatigue** — not in the model

The model only has λ_home and λ_away. It can tell you the AVERAGE expected goals,
but it can't tell you the DISTRIBUTION of match types. Two matches can have
λ_home=1.5, λ_away=1.2 but one is a cagey affair and the other is end-to-end.

### Why Unders DO work

Under prediction is more tractable because:
1. Low-scoring environments are more predictable (defensive structure is stable)
2. The model's slight goal inflation actually HELPS Under detection — when even
   an inflated model says Under, the real probability is even more Under
3. Ted's insight applies: defensive coaching and tempo control are persistent
   team traits that show up in xG data
4. Market may genuinely overprice Overs (public bias toward action/goals)

---

## 6. Decision: Totals Strategy Going Forward

### Current state (validated)

- `MARKET_MODE = "both"` — evaluate sides + totals
- `TOTALS_UNDERS_ONLY = true` — only emit Under bets from the model
- Totals deflation = 0.965 (3.5% lambda reduction for O/U grid)
- Lambda3 range = [-0.08, 0.02]

### What to do about Overs

**Option A: Abandon model-based Overs entirely** ✅ RECOMMENDED

Keep `TOTALS_UNDERS_ONLY = true` permanently. The Poisson model is structurally
unable to identify Over environments reliably. This matches Ted's approach — he
bets Overs qualitatively, not from a model.

If we want Overs, build a separate signal:
- **Variance-only Overs**: Only emit Over bets when `assessTotalsThesis()` returns
  direction="over" with high confidence AND model agrees. This is the "correlated
  Over" play Ted uses — big favorite + both teams' variance pointing to goals.
- **Tempo/pace data**: If we can get shot pace, possession %, or tempo metrics,
  build a separate Over classifier outside the Poisson framework.

**Option B: Deeper model calibration** (more work, uncertain payoff)

- Per-league deflation factors instead of one-size-fits-all 0.965
- Time-varying lambda3 (could be seasonal)
- Isotonic regression on model probabilities to force calibration
- Separate Over/Under models rather than one Poisson grid

Not recommended yet. The structural limitations of Poisson for Overs suggest
calibration will hit diminishing returns.

**Option C: Correlated Over filter** (lightweight, worth trying)

Only allow Over bets when ALL of:
1. Model edge >= 7% on Over
2. `assessTotalsThesis()` direction = "over" with confidence >= 0.6
3. There is also a strong side bet on the favorite (AH -0.75 or better)
4. League is EPL or Championship (our profitable leagues)

This mimics Ted's "correlated Over" approach computationally. Small sample
but higher conviction per bet.

### League-specific considerations

EPL (+11.9% ROI) and Championship (+5.2%) are our strongest totals leagues.
Bundesliga (-16.6%) and Serie A (-9.5%) are actively harmful. Consider:
- League whitelist for totals: EPL, Championship, Ligue-1 only
- Or per-league edge thresholds (higher bar for weaker leagues)

---

## 7. Ted's Key Principles (Reference)

### Betting philosophy

- **Asian Handicap** is the primary market — lowest vig, ~50/50 bets
- **~30% of matches** warrant a bet — selectivity is the edge
- **Edge = ~0.25 goals** disagreement with market
- **Odds cap ~1.9-2.5** — avoid longshots ("need 33%+ hit rate minimum")
- **No draws** — "24% win rate" makes them poor value
- **Timing**: 1-2 days before match, not early market

### Variance theory

- **xGD is the single best measure of true team quality**
- **Defensive underperformance** (conceding >> xGA) is the most reliable
  regression signal
- **Attack overperformance** (scoring >> xG) is fragile and regresses fast
- **Persistent defiance** (>15 matches uncorrected) may indicate genuine
  skill, not just variance
- **Double variance** (attack AND defense diverging) = strongest signal

### Performance benchmarks

- Best seasons: 7-11% ROI on initial wagers (his self-reported range)
- Season 1 (2024-25, mid-season): +14 units on 182 bets (7.7% neutral ROI)
- Season 2 (2025-26): +22.5 units by Dec 2025
- Vig impact: ~1,700 paid in vig on 182 bets at 200 stakes. "If your bookie
  margin is double that... I would actually be in the negative despite being
  a highly winning bettor."

### On Poisson models

Ted's MI model IS a bivariate Poisson under the hood. He does not criticize
Poisson for sides — it's his core framework. He simply doesn't use it for
totals. His totals process is qualitative, team-specific, and situational.

---

## 8. Open Questions

1. **Odds capping**: Ted averages ~1.9 odds. We don't cap. Should we filter
   out bets above 2.5-2.8 odds? Backtest needed.

2. **Injury data**: Ted's biggest qualitative overlay. Could we integrate
   FotMob or another injury feed to adjust lambdas?

3. **Tempo/pace metrics**: If we had shot pace or possession % data, could
   we build a non-Poisson Over classifier?

4. **Per-league totals thresholds**: Should Bundesliga/Serie A totals be
   excluded entirely, or just held to a higher edge bar?

5. **Correlated Over prototype**: Worth building the filter from Section 6
   Option C? Small bet volume but higher conviction.

6. **Variance-only totals mode**: Instead of model edge, use ONLY
   `assessTotalsThesis()` for totals — completely decouple from Poisson
   for O/U. Would this perform better?

7. **Alt totals lines**: We compute O/U at 11 lines but only compare
   against O/U 2.5 market odds. Collecting 2.25/2.75/3.0/3.25 lines
   from the per-event Odds API could unlock Under 2.25 or Under 2.75
   value that O/U 2.5 misses.

---

*Last updated: 2026-03-11*
*Based on: Ted Knutson's Variance Betting canon (~110 newsletters, 2024-2026),
our MI Poisson model backtest (6 leagues × 2 seasons), and diagnostic analysis.*
