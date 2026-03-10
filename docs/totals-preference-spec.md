# Totals Preference Mechanism — Specification

## Problem

Our MI Poisson model currently outputs only AH side bets (e.g., "Chelsea +0.5"). Ted Knutson also bets Over/Under totals (~9% of his bets), and sometimes bets both a side AND a total on the same match. We need to:

1. Evaluate O/U at multiple lines beyond 2.5 (2.25, 2.75, 3.0, 3.25, 3.5)
2. Allow the system to output totals bets alongside or instead of side bets
3. Use variance signals to inform whether sides or totals (or both) are appropriate
4. Preserve the current side-bet pipeline as the default


## Current State

### What works now

- `deriveOverUnder(grid, lines)` already computes O/U probabilities at any line from the score grid. It currently runs on `[0.5, 1.5, 2.5, 3.5, 4.5]`.
- `MatchPrediction.overUnder` stores these as `Record<string, { over, under }>`.
- `findBestAHLine()` checks O/U 2.5 from Pinnacle's `overOdds`/`underOdds` and emits "Over 2.5" or "Under 2.5" bets when edge >= threshold.
- The Odds API provides `alternate_totals` on per-event endpoints (lines like 1.5, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4.5). These are already parsed into `BookmakerOdds.altTotals[]`.
- The variance model tracks `attackVariance`, `defenseVariance`, and `dominantType` per team.

### What's missing

- Only O/U 2.5 is checked against market odds. Other lines (2.25, 2.75, 3.0, etc.) are computed by the model but never compared to market prices.
- The system picks ONE bet per match (best edge among AH/ML/O/U). Ted picks multiple when edges exist in different markets.
- No variance-informed logic for choosing between sides and totals.
- No "market mode" switch — it's always "everything, pick the best one."


## Design

### 1. Market Mode Configuration

Add a `MarketMode` setting that controls which markets the system evaluates:

```
type MarketMode = "sides_only" | "totals_only" | "both";
```

| Mode | What it evaluates | When to use |
|------|-------------------|-------------|
| `sides_only` | AH + ML + Draw (current behavior) | Default. Backtested. Known edge profile. |
| `totals_only` | O/U at all available lines | Debugging totals model. Specific research. |
| `both` | All markets. Can output multiple bets per match. | Production goal once totals are validated. |

This is a top-level config constant in `our-bets.ts`, not a per-match decision. Set it once per run.

**Default**: `sides_only` until totals backtesting is complete. Switch to `both` after validation.

### 2. Multi-Line O/U Evaluation

#### Expand the lines the model evaluates

Change the `deriveOverUnder` call in `predictMatch` and `predictCrossLeague` from:

```
deriveOverUnder(grid, [0.5, 1.5, 2.5, 3.5, 4.5])
```

to:

```
deriveOverUnder(grid, [0.5, 1.5, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 4, 4.5])
```

The `deriveOverUnder` function already handles any numeric line correctly (it sums grid cells where `i + j < line`). Quarter lines (2.25, 2.75, 3.25) work because they split the bet: e.g., O/U 2.25 means half the stake on O/U 2.0 and half on O/U 2.5. The model probability for "Over 2.25" is the average of P(goals > 2) and P(goals > 2.5), which `deriveOverUnder` computes correctly since `i + j < 2.25` captures exactly goals = 0, 1, or 2 (same as Under 2.5 but the push on exactly 2 goes to Over).

#### Match O/U model probabilities against market odds

In `findBestAHLine` (or a new `findBestTotalLine` function), iterate over all totals lines available from the bookmaker data:

1. **Bulk odds** provide O/U 2.5 via `pinnacle.overOdds` / `pinnacle.underOdds` (already handled).
2. **Alt totals** from per-event data provide additional lines via `bookmaker.altTotals[]` — an array of `{ line, over, under }`.

For each available market line:
- Look up the model probability from `pred.overUnder[lineStr]`
- Devig the market odds using `devigOdds2Way(overPrice, underPrice)`
- Compute edge = modelProb - marketProb
- If edge >= `MIN_EDGE`, emit a `TedBet` with selection like `"Over 3.25"` or `"Under 2.75"`

#### Prefer the best line per direction

When multiple Over lines show edge (e.g., Over 2.5 at 6% edge and Over 3.0 at 4% edge), keep only the line with the highest edge per direction (Over or Under). Don't output both "Over 2.5" and "Over 3.0" for the same match — that's doubling up on the same thesis.

Exception: if Over and Under show edge at very different lines (e.g., Over 2.25 and Under 4.5), both could be valid — but in practice this won't happen because they'd be contradictory.

### 3. Multiple Bets Per Match

#### Current behavior

`findBestAHLine` returns all bets with edge above threshold, but the caller in `our-bets.ts` picks ONE per match:

```typescript
const ahBets = bets.filter(b => !b.selection.includes("ML") && !b.selection.includes("Draw"));
const best = ahBets.length > 0 ? ahBets[0] : bets[0];
```

#### New behavior (when `MarketMode = "both"`)

Allow up to TWO bets per match: one side bet and one totals bet. The logic:

1. From all bets returned by `findBestAHLine`, partition into:
   - **Side bets**: AH lines, ML (anything with a team name or "Draw")
   - **Totals bets**: Over/Under (anything starting with "Over" or "Under")

2. Pick the best side bet (highest edge among sides).
3. Pick the best totals bet (highest edge among totals).
4. Output both if both exist and both pass the minimum edge threshold.

Do NOT pick two side bets (e.g., "Chelsea +0.5" AND "Chelsea ML") or two totals bets (e.g., "Over 2.5" AND "Over 3.0"). One of each, max.

#### Edge correlation guard

If the side bet and totals bet are correlated (they reinforce each other), that's fine — Ted does this (PSG v Chelsea: Chelsea +0.5 AND Over 3). If they're contradictory (e.g., "Home -1.5" and "Under 2.5" — one says blowout, the other says low scoring), flag with a warning but still output both. The model may genuinely see edge in both directions if the market is mispricing different things.

### 4. Integration With findBestAHLine

Two options. Recommend **Option A** for simplicity.

#### Option A: Extend findBestAHLine (recommended)

Add the multi-line O/U logic directly into `findBestAHLine`. It already checks O/U 2.5 at the bottom. Expand that section to loop over all alt totals lines from the snapshot data. Rename the function to `findBestBets` to reflect that it's no longer AH-specific.

Pseudocode for the new totals section:

```
// Check all available O/U lines
const allTotalsLines = collectTotalsLines(snap);  // from pinnacle + altTotals
for each { line, overPrice, underPrice } in allTotalsLines:
    const ouKey = String(line);
    const modelOU = pred.overUnder[ouKey];
    if (!modelOU) continue;
    const marketOU = devigOdds2Way(overPrice, underPrice);
    if (modelOU.over - marketOU.prob1 >= minEdge):
        bets.push({ selection: `Over ${line}`, ... });
    if (modelOU.under - marketOU.prob2 >= minEdge):
        bets.push({ selection: `Under ${line}`, ... });
```

Then in the caller, apply the "one side + one total" grouping logic from section 3.

#### Option B: Separate function

Create `findBestTotalLine(pred, snap, minEdge)` that only evaluates totals. Call it alongside `findBestAHLine`. Merge results in the caller. More modular but adds surface area.

### 5. Variance-Informed Market Selection

The variance model doesn't just tell us WHICH SIDE to bet — it can tell us WHETHER TO BET SIDES OR TOTALS. This is the Ted insight: sometimes the variance thesis points to a totals bet, not a side bet.

#### Variance signals that point to totals

| Variance pattern | Totals implication | Example |
|---|---|---|
| Both teams have `attack_overperf` | **Under** — both attacks will regress, fewer goals | Two teams outscoring their xG by 15%+. The goals will dry up. |
| Both teams have `attack_underperf` | **Over** — both attacks will regress upward, more goals | Two teams underscoring xG. The finishing will normalize. |
| Both teams have `defense_underperf` | **Over** — both defenses leaking, more goals coming | Both conceding way above xGA. Goal-fest incoming. |
| Both teams have `defense_overperf` | **Under** — defensive luck will hold or goals stay low | Both conceding well below xGA. Low-scoring trend may persist (or crack — use with caution). |
| One team `attack_overperf` + other `defense_underperf` | **Over (with caution)** — one team's goals are inflated AND the other team leaks | Mixed signal but net effect is more goals expected. |
| Teams have opposite variance types (one attack, one defense) | **Sides** — variance is directional, not totals-related | Classic side-bet territory. One team is better than results show. |

#### Implementation: Variance Totals Thesis

Add a new function `assessTotalsThesis(homeVariance, awayVariance)` in the variance module that returns:

```
interface TotalsThesis {
  direction: "over" | "under" | "none";
  confidence: number;          // 0-1
  reasoning: string;
  varianceAlignment: number;   // how strongly both teams' variance points to the same totals direction
}
```

The key metric is **variance alignment** — when both teams' dominant variance type points in the same totals direction, that's a strong signal. When they point in opposite directions or are mixed, there's no totals thesis.

Calculation:
- Map each team's `dominantType` to a totals direction (see table above)
- If both point the same way, `varianceAlignment` = average of both teams' `regressionConfidence`
- If they point opposite ways or are "balanced", `varianceAlignment` = 0
- `direction` = the agreed-upon direction (or "none")
- `confidence` = `varianceAlignment * edgeMagnitudeFactor`

#### Using the totals thesis in bet selection

When `MarketMode = "both"`:

1. Compute side bets and totals bets as normal (pure edge from model vs market).
2. Compute `TotalsThesis` from variance data.
3. **Boost**: If variance thesis agrees with a totals bet's direction (e.g., variance says "Over" and model finds Over 2.75 edge), add a `signal: "model+variance"` tag and increase confidence. This is a strong bet.
4. **New bet**: If variance thesis is strong (`confidence >= 0.7`) but no totals edge exists in the model, flag the match as "variance suggests totals but model disagrees — monitor line." Don't force a bet.
5. **Conflict**: If variance says "Under" but model says "Over 2.5" has edge, trust the model's edge but tag with `signal: "model_only (variance_conflict)"`. The model has the price comparison; variance is supplementary.

#### Using the totals thesis to prefer markets

When the variance model produces a strong totals thesis AND the model finds edge in both sides and totals for a match:

- If `TotalsThesis.confidence >= 0.6` and totals edge >= `MIN_EDGE`, prefer the totals bet as primary.
- The side bet is still valid — output it as secondary.
- In the output, mark which bet is "variance-aligned" vs. "model-only."

This mirrors Ted's approach: he picks the market with the clearest narrative, and sometimes Over/Under has a better story than AH.


## Example Scenarios

### Scenario A: Two attacking teams — Over value

**Match**: Liverpool v Barcelona (UCL)
**Model**: lambdaHome = 1.9, lambdaAway = 1.6, expected total = 3.5
**Variance**: Liverpool `attack_underperf` (scoring below xG), Barcelona `defense_underperf` (conceding above xGA)
**Market**: Pinnacle Over 2.5 @ 1.55 (implied 62%), model says Over 2.5 = 72%. Alt totals: Over 3.0 @ 1.82 (implied 52%), model says 64%.

**System output (mode = both)**:
1. Best totals bet: **Over 3.0** — 12% edge, signal: `model+variance`. Variance thesis: Liverpool's attack will regress up, Barcelona's defense will leak more goals.
2. Best side bet: **Barcelona +0.5** — 5.5% edge, signal: `model_only`.

Both are output. The totals bet is flagged as primary because variance alignment is strong for the Over direction.

### Scenario B: Classic side bet — no totals thesis

**Match**: Blackburn v QPR (Championship)
**Model**: lambdaHome = 1.4, lambdaAway = 0.9, expected total = 2.3
**Variance**: Blackburn `defense_underperf` (good xGD, bad actual GD — classic Ted). QPR `attack_overperf` (fragile scoring).
**Market**: Pinnacle AH Blackburn -0.5 @ 1.72 (implied 55%), model says 63%.

**System output (mode = both)**:
1. Best side bet: **Blackburn -0.5** — 8% edge, signal: `model+variance`.
2. No totals bet — O/U lines show no edge above threshold, and variance types are directional (one defense, one attack), not totals-aligned.

### Scenario C: Both markets have edge

**Match**: PSG v Chelsea (UCL, inspired by Ted's actual bet)
**Model**: lambdaHome = 1.7, lambdaAway = 1.5, expected total = 3.2
**Variance**: PSG `attack_overperf` (scoring way above xG), Chelsea `attack_underperf` (creating chances but not finishing)
**Market**: Over 3.0 @ 2.00 (implied 48%), model says 57%. Chelsea +0.5 @ 1.85 (implied 52%), model says 60%.

**System output (mode = both)**:
1. **Over 3.0** — 9% edge, signal: `model_only`. (Variance is mixed — PSG's attack should decline but Chelsea's should improve, net effect unclear for totals.)
2. **Chelsea +0.5** — 8% edge, signal: `model+variance`. (Chelsea underperforming xG, PSG overperforming — classic regression to both sides.)

Both bets output. The side bet has stronger variance backing but the totals bet has higher raw edge.

### Scenario D: Totals-only mode catches what sides miss

**Match**: Stoke v Millwall (Championship)
**Model**: lambdaHome = 0.9, lambdaAway = 0.8, expected total = 1.7
**Variance**: Stoke `defense_overperf` (conceding below xGA), Millwall `defense_overperf` (same).
**Market**: Under 2.5 @ 1.65 (implied 58%), model says 69%. No AH edge found.

**System output (mode = both)**:
1. **Under 2.5** — 11% edge, signal: `model+variance`. Both defenses overperforming xGA — but model predicts low-scoring independently. Variance alignment is moderate (defense overperf = Under thesis, but it's the weakest totals signal — these defenses might actually be good, not lucky).
2. No side bet — AH lines fairly priced.

In `sides_only` mode, this match would produce no bets. In `both` mode, the Under bet is found.


## Data Pipeline Changes

### Odds collection

The bulk endpoint already fetches `h2h,totals,spreads` in one API call. The `totals` market only returns the primary line (usually 2.5). To get alternate lines (2.25, 2.75, 3.0, etc.), we need the per-event endpoint with `alternate_totals`.

**Budget impact**: Each per-event call costs 1 API request. Only fetch alt totals for matches where:
- The model shows expected goals significantly away from 2.5 (e.g., xG total > 3.0 or < 2.0)
- There's already a side bet candidate (so we're interested in the match anyway)

This keeps API usage in check. Estimate: 3-5 extra requests per collection cycle.

### Snapshot storage

`BookmakerOdds.altTotals` already exists as `{ line, over, under }[]`. No schema change needed. Just ensure `collectDeepOdds` is called for matches of interest.

### Live odds JSON files

The flat JSON files in `data/live-odds/` need to carry `altTotals` through to `our-bets.ts`. Currently these files are written by the collection scripts. Verify that alt totals data flows through to the snap objects in `findBestAHLine`. If not, add it to the serialization.


## Rollout Plan

### Phase 1: Model expansion (no behavior change)
- Expand `deriveOverUnder` to include lines 2.0, 2.25, 2.75, 3.0, 3.25, 3.5, 4.0
- Log multi-line O/U probabilities alongside current output
- No new bets emitted yet

### Phase 2: Totals edge detection
- Add multi-line O/U market comparison in `findBestAHLine`
- Add `MarketMode` config, default to `sides_only`
- Implement "one side + one total" grouping
- Run in shadow mode: log what totals bets WOULD have been picked, but don't emit them

### Phase 3: Variance totals thesis
- Implement `assessTotalsThesis` function
- Add variance-totals signals to bet output
- Tag bets with `model+variance` vs `model_only`

### Phase 4: Go live with totals
- Backtest totals-only and both-market results against historical data
- Switch `MarketMode` to `both`
- Compare against Ted's totals hit rate

### Phase 5: Alt totals collection
- Add selective per-event fetching for alt totals lines
- Budget the API calls based on match interest scoring


## Open Questions

1. **Minimum edge for totals vs sides**: Should totals bets have a higher or lower minimum edge than sides? Totals markets tend to be more efficient (more volume) so edges may be smaller but more reliable. Start with the same threshold and adjust after backtesting.

2. **Quarter-line handling**: O/U 2.25 and 2.75 are split bets. The model computes these correctly, but the edge calculation should account for the fact that half the stake pushes on the round number. Verify `deriveOverUnder` handles this — it does, since `i + j < 2.25` captures goals 0, 1, 2 as Under.

3. **Correlation between side and total bets**: When we bet both "Home -1.5" and "Over 2.5" on the same match, these bets are positively correlated (a 2-0 or 3-0 win covers both). Should we discount the combined edge? For now, no — treat them as independent bets with independent bankroll allocation. Revisit if bankroll management becomes formal.

4. **Variance thesis for BTTS**: Both Teams to Score is another totals-adjacent market. The variance decomposition (attack vs defense per team) maps naturally to BTTS. Park this for now but it's a logical extension.
