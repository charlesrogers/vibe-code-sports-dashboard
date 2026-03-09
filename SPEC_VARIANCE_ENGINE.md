# Variance Engine — Product Spec

## The Opportunity

We have a working prediction platform (Dixon-Coles + ELO + Market composite model, walk-forward backtester with CLV tracking, odds collection across 59 bookmakers, xG data from Understat). But it doesn't do what sharp bettors do: identify *variance* — the gap between xG and actual results — and convert that into bet signals. That's the missing layer.

From studying Ted Knutson's Variance Betting methodology and the "Sharper" playbook, we've extracted the principles. Now we build the engine that applies them — using our own data, our own model, our own calibration.

---

## What We're Building

A **Variance Engine** that sits alongside (and feeds into) the existing composite model. It adds four capabilities the platform currently lacks:

1. **Venue-specific xG variance detection** — the primary signal
2. **Variance decomposition** — attack vs defense, with regression confidence
3. **Injury-aware line assessment** — does the line reflect reality?
4. **Bet filtering** — the discipline layer that turns 100 matches into 30 bets

The engine doesn't replace the composite model. It adds a new signal source AND a decision layer on top.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    DATA LAYER                            │
├──────────┬──────────┬───────────┬───────────────────────┤
│ xG APIs  │ Football │ The Odds  │ Injury                │
│ Understat│ Data UK  │ API (59   │ Feed                  │
│ FBref    │ historics│ bookies)  │ (API + scraper)       │
│ Fotmob   │          │           │                       │
│ football │          │           │                       │
│ -data.org│          │           │                       │
└────┬─────┴────┬─────┴─────┬─────┴─────┬─────────────────┘
     │          │           │           │
┌────▼──────────▼───────────▼───────────▼─────────────────┐
│                 VARIANCE ENGINE                          │
├─────────────────────────────────────────────────────────┤
│  1. xG Variance Calculator (home/away splits)            │
│  2. Variance Decomposer (attack/defense/GK)              │
│  3. Regression Confidence Scorer                         │
│  4. Injury Impact Estimator                              │
│  5. Line Value Assessor                                  │
│  6. Bet Filter (selectivity gate)                        │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│              COMPOSITE MODEL (enhanced)                   │
├─────────────────────────────────────────────────────────┤
│  Dixon-Coles (35%) + ELO (15%) + Market (30%)            │
│  + Variance Signal (20%)  ← NEW                          │
│  → Blended probabilities                                 │
│  → Asian Handicap line generation                        │
│  → Edge calculation vs market                            │
│  → Bet/No-Bet decision with confidence                   │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│                   OUTPUT LAYER                            │
├──────────┬──────────┬──────────────────────────────────┤
│ Variance │ Smart    │ CLV                               │
│ Dashboard│ Bet Card │ Tracker                           │
│ (new pg) │ (new pg) │ (enhanced)                        │
└──────────┴──────────┴──────────────────────────────────┘
```

---

## Phase 1: The Data Foundation

### 1A. xG Data — Every Free Source Available

We need venue-specific xG splits. One source isn't enough — we want redundancy, cross-validation, and the richest possible picture.

#### Source 1: Understat (EXISTING — needs upgrade)

**Current state:** `lib/understat.ts` fetches team-level xG totals.

**Upgrade needed:** Scrape match-level xG data and aggregate into venue splits ourselves.

**Coverage:** Premier League, La Liga, Bundesliga, Serie A, Ligue 1, Russian Premier League.

**Data available:**
- Per-match: xG, xGA, xPts for each team
- Per-shot: location, xG value, result, situation, body part
- Per-player: xG, assists, key passes

**What we extract:**
- Team home xG, xGA, xGD (aggregated from match-level)
- Team away xG, xGA, xGD
- Match-level xG timeline (for trending analysis)
- Shot maps (for future deeper analysis)

**Integration:** Upgrade existing `lib/understat.ts` to return `TeamXGSplits` (see schema below).

#### Source 2: FBref / StatsBomb (NEW)

**What:** FBref provides free StatsBomb-powered xG data with additional metrics not available on Understat.

**Coverage:** Top 5 European leagues, EFL Championship, Champions League, Europa League, MLS, and more.

**Unique data not available elsewhere:**
- **PSxG (Post-Shot Expected Goals)** — factors in shot placement, not just location. Critical for goalkeeper analysis.
- **PSxG+/-** — goalkeeper performance metric. How many goals a keeper saved/conceded vs what the average keeper would from those exact shots.
- **npxG (Non-Penalty xG)** — xG excluding penalties. Cleaner signal of open-play quality.
- **xAG (Expected Assisted Goals)** — chance creation quality.
- **Progressive carries/passes** — possession quality metrics.
- **Shot-creating actions / Goal-creating actions** — buildup quality.

**Integration approach:** Scrape team season stats pages. FBref has well-structured HTML tables.

```
URL pattern: https://fbref.com/en/comps/{league_id}/{season}/stats/
Serie A: league_id = 11
Championship: league_id = 10
Premier League: league_id = 9
```

**What we extract:**
- Team home/away splits: xG, npxG, xGA, PSxG, PSxG+/-
- Goalkeeper PSxG+/- (from goalkeeping stats page)
- Per-match progressive data for trend analysis

**New file:** `lib/fbref.ts`

#### Source 3: Fotmob (NEW)

**What:** Fotmob provides free match-level xG via their API (used by their mobile app).

**Coverage:** Nearly every professional league worldwide.

**Unique value:**
- Match-level xG with minute-by-minute breakdown
- Live xG during matches (for future live betting features)
- Very wide league coverage (useful if we expand beyond Serie A/B)

**Integration approach:** Their API endpoints are publicly accessible (undocumented but stable):

```
Match details: https://www.fotmob.com/api/matchDetails?matchId={id}
League matches: https://www.fotmob.com/api/leagues?id={id}&season={season}
Team stats: https://www.fotmob.com/api/teams?id={id}&season={season}
```

**What we extract:**
- Match-level xG for each team
- Venue-specific aggregation
- Cross-validation against Understat/FBref numbers

**New file:** `lib/fotmob.ts`

#### Source 4: Football-data.org (EXISTING — xG extraction)

**Current state:** `lib/football-data.ts` fetches match results and standings.

**Upgrade:** Their API includes basic xG data in match details (for supported competitions). Extract and store alongside results.

#### Unified xG Schema

All sources feed into a single normalized structure:

```typescript
interface TeamXGSplits {
  team: string;
  teamId: string;                  // normalized across sources
  league: string;
  season: string;
  lastUpdated: string;

  // Source tracking
  sources: {
    understat: boolean;
    fbref: boolean;
    fotmob: boolean;
    footballDataOrg: boolean;
  };

  // Overall
  overall: {
    xG: number; xGA: number; xGD: number;
    npxG: number | null;           // FBref only
    goals: number; goalsConceded: number; gd: number;
    matches: number;
  };

  // HOME splits — the key data
  home: {
    xG: number; xGA: number; xGD: number;
    npxG: number | null;
    goals: number; goalsConceded: number; gd: number;
    matches: number;
    xGPerMatch: number; xGAPerMatch: number; xGDPerMatch: number;
  };

  // AWAY splits — the key data
  away: {
    xG: number; xGA: number; xGD: number;
    npxG: number | null;
    goals: number; goalsConceded: number; gd: number;
    matches: number;
    xGPerMatch: number; xGAPerMatch: number; xGDPerMatch: number;
  };

  // Variance metrics (derived)
  homeVariance: {
    attackVariance: number;        // goals - xG (positive = overperforming)
    defenseVariance: number;       // goalsConceded - xGA (positive = leaking goals)
    totalVariance: number;         // gd - xGD
    attackVariancePct: number;     // (goals - xG) / xG
    defenseVariancePct: number;    // (goalsConceded - xGA) / xGA
  };
  awayVariance: {
    attackVariance: number;
    defenseVariance: number;
    totalVariance: number;
    attackVariancePct: number;
    defenseVariancePct: number;
  };

  // Goalkeeper data (FBref only)
  goalkeeper: {
    name: string;
    psxgPlusMinus: number | null;  // goals prevented vs average keeper
    psxgPerMatch: number | null;
    matchesPlayed: number;
  } | null;

  // Trending (last 5 matches)
  recentForm: {
    home: { xGD: number; gd: number; matches: number } | null;
    away: { xGD: number; gd: number; matches: number } | null;
  };
}
```

**Caching strategy:**
- Understat: 6 hours (existing)
- FBref: 12 hours (respectful scraping rate)
- Fotmob: 6 hours
- Football-data.org: 1 hour (existing)

When multiple sources provide xG for the same match, average them. Cross-source agreement increases confidence in the numbers.

---

### 1B. Injury Data

**Current state:** No injury data in the platform.

#### Approach: API First, Scraper Later

**Immediate (API):** Football-data.org has an injuries endpoint on some tiers. API-Football (~$10-20/mo) has comprehensive injury data. Start with whichever we can access.

**Future (Scraper):** Build a scraper for Transfermarkt injury pages and/or team news feeds. This is the long-term solution because:
- Free
- Most comprehensive (includes expected return dates, severity)
- Updated daily by a large community

#### Injury Schema

```typescript
interface TeamAvailability {
  team: string;
  teamId: string;
  league: string;
  matchDate: string;
  lastUpdated: string;

  unavailable: PlayerAbsence[];
  totalOut: number;
  startersOut: number;
  gkOut: boolean;
  impactScore: number;            // weighted sum (GK=3, starter DEF=2.5, starter MID/FWD=2, squad=1)

  // Data quality flag
  isComplete: boolean;            // false if we suspect we're missing info
  source: string;
}

interface PlayerAbsence {
  player: string;
  reason: "injury" | "suspension" | "international" | "personal" | "unknown";
  isStarter: boolean;
  position: "GK" | "DEF" | "MID" | "FWD";
  expectedReturn: string | null;
  severity: "minor" | "moderate" | "major" | "season" | "unknown";
}
```

**Impact scoring formula:**
```
impactScore = Σ (positionWeight × starterMultiplier)

positionWeight: GK = 3.0, DEF = 1.5, MID = 1.2, FWD = 1.5
starterMultiplier: starter = 2.0, squad = 1.0
```

A team missing their starting goalkeeper and two first-choice center-backs:
`(3.0 × 2.0) + (1.5 × 2.0) + (1.5 × 2.0) = 12.0`

A team missing five squad rotation players:
`5 × (1.3 × 1.0) = 6.5`

The first scenario is worse despite fewer players out. The impact score captures this.

**New file:** `lib/injuries.ts`

---

## Phase 2: The Variance Engine

### 2A. Variance Calculator

**What:** For every upcoming match, compute venue-specific xG variance for both teams.

**Input:** `TeamXGSplits` for home team (home record) and away team (away record).

**Output:**
```typescript
interface MatchVariance {
  homeTeam: string;
  awayTeam: string;
  league: string;
  matchDate: string;

  home: VenueVariance;
  away: VenueVariance;

  // Net variance advantage — who benefits more from regression
  varianceEdge: number;
  varianceEdgeSide: "home" | "away" | "neutral";
  confidence: number;              // 0-1
}

interface VenueVariance {
  team: string;
  venue: "home" | "away";

  // Raw data
  xGD: number;
  actualGD: number;
  xG: number;
  goals: number;
  xGA: number;
  goalsConceded: number;
  matches: number;

  // Variance
  totalVariance: number;           // actualGD - xGD (negative = underperforming results)
  attackVariance: number;          // goals - xG
  defenseVariance: number;         // goalsConceded - xGA (positive = conceding too many)

  // Percentage terms
  attackVariancePct: number;
  defenseVariancePct: number;

  // Classification
  varianceSignal: VarianceSignal;
  dominantType: "attack_overperf" | "attack_underperf" |
                "defense_overperf" | "defense_underperf" |
                "balanced" | "neutral";
}

type VarianceSignal =
  | "strong_positive"    // results much better than xG → regression will HURT this team
  | "weak_positive"
  | "neutral"
  | "weak_negative"      // results worse than xG → regression will HELP this team
  | "strong_negative";   // results much worse than xG → strong regression candidate
```

**Signal thresholds (calibrated from studying 111 newsletters of sharp analysis):**

| Metric | Value | Signal |
|--------|-------|--------|
| Total variance < 3 goals | | `neutral` |
| Total variance 3-5 goals | | `weak_positive` / `weak_negative` |
| Total variance 5-8 goals | | `strong_positive` / `strong_negative` |
| Total variance > 8 goals | | Very high confidence signal |
| Attack overperf > 130% (goals/xG) | | Fragile — will regress down |
| Defense underperf > 140% (GA/xGA) | | Very reliable — will regress favorably |
| Defense overperf < 70% (GA/xGA) | | Will crack — bet against |
| Sample size < 5 matches | | Unreliable — reduce confidence |
| Sample size 5-10 matches | | Usable with caution |
| Sample size > 10 matches | | Reliable |

**New file:** `lib/variance/calculator.ts`

---

### 2B. Regression Confidence Scorer

**What:** Not all variance is equally likely to regress. Score how confident we are.

**Factors that increase confidence:**

| Factor | Weight | Reasoning |
|--------|--------|-----------|
| Large xGD/GD gap | 0.25 | Bigger gap = more likely to regress |
| Defensive underperformance (as dominant type) | 0.20 | Most reliable regression type — opponent finishing is random |
| Large sample size (10+ venue matches) | 0.15 | More data = more signal, less noise |
| Opposing variance (opponent has complementary variance) | 0.15 | Both sides regressing in your favor |
| Trend alignment (recent xG metrics moving toward thesis) | 0.10 | Process is already correcting |
| Goalkeeper PSxG+/- near zero | 0.10 | GK isn't driving the variance — it's pure randomness |
| Multiple xG sources agree on the variance | 0.05 | Cross-validated signal |

**Factors that decrease confidence:**

| Factor | Penalty | Reasoning |
|--------|---------|-----------|
| Attacking overperformance is the dominant variance type | -0.15 | More sustainable than defensive variance |
| Small sample (< 5 venue matches) | -0.20 | Could be noise |
| Persistent defiance (overperforming 15+ matches without correcting) | -0.20 | Maybe there's something the model doesn't capture |
| Goalkeeper with extreme PSxG+/- | -0.10 | GK quality is a real effect, not just variance |
| Manager change mid-season | -0.10 | Structural break in the data |
| Significant transfers since start of data | -0.10 | The team isn't the same team |

**Output:**
```typescript
interface RegressionScore {
  score: number;                   // 0-1 (final confidence)

  factors: {
    gapMagnitude: number;          // 0-1
    varianceType: number;          // 0-1 (defense underperf = 1.0, attack overperf = 0.4)
    sampleSize: number;            // 0-1
    opposingVariance: number;      // 0-1
    trendAlignment: number;        // 0-1
    gkNeutrality: number;         // 0-1 (1.0 if GK PSxG near zero)
    crossSourceAgreement: number;  // 0-1
  };

  penalties: {
    persistenceRisk: number;       // 0-1 (high if team keeps defying model)
    structuralBreak: number;       // 0-1 (manager change, major transfers)
    smallSample: number;           // 0-1
  };

  explanation: string;
  // e.g. "Strong regression candidate: +8.5 goal defensive underperformance
  //  over 14 home matches. Opponents scoring at 172% of xGA rate.
  //  Goalkeeper PSxG+/- is -0.3 (near average), confirming this is
  //  random variance, not poor goalkeeping. Cross-validated across
  //  Understat and FBref."
}
```

**New file:** `lib/variance/regression-scorer.ts`

---

### 2C. Line Value Assessor

**What:** Given the variance signal and regression confidence, does the current market line offer value?

**Process:**
1. Get composite model's predicted probability for each outcome
2. Compute variance adjustment: `regressionConfidence × varianceDirection × scalingFactor`
3. Adjusted probability = model probability + variance adjustment
4. Compare to devigged market odds from our 59 bookmakers
5. Calculate edge: `(adjusted_probability × decimal_odds) - 1`
6. Separately calculate edge vs Pinnacle (the sharp benchmark)
7. Determine if edge exceeds minimum threshold

**Output:**
```typescript
interface LineAssessment {
  match: string;
  homeTeam: string;
  awayTeam: string;

  // Best bet identified
  bestBet: {
    market: "asian_handicap" | "over_under" | "1x2";
    line: number;                    // -0.25, 2.5, etc.
    side: string;                    // "home -0.25", "over 2.5"
    odds: number;                    // best available from 59 bookmakers
    bookmaker: string;               // which book has the best price

    // Probabilities
    modelProbability: number;        // from composite (before variance)
    varianceAdjustment: number;      // from variance engine
    adjustedProbability: number;     // model + variance
    marketImpliedProb: number;       // devigged from best odds

    // Edge
    edge: number;                    // adjusted_prob × odds - 1
    edgeVsPinnacle: number | null;   // edge specifically vs Pinnacle
    hasValue: boolean;               // edge > minimum threshold (4%)
    centsOfPlay: number;             // how much line can move before edge = 0
  } | null;

  // All markets assessed (for transparency)
  markets: MarketAssessment[];

  // Model contributions
  modelBreakdown: {
    dixonColes: { home: number; draw: number; away: number };
    elo: { home: number; draw: number; away: number };
    market: { home: number; draw: number; away: number } | null;
    varianceAdj: { home: number; draw: number; away: number };
    composite: { home: number; draw: number; away: number };
  };

  // Pinnacle benchmark
  pinnacle: {
    odds: { home: number; draw: number; away: number } | null;
    devigged: { home: number; draw: number; away: number } | null;
  };

  // Kelly sizing
  kellyFraction: number;            // quarter-Kelly stake as fraction of bankroll
  kellyUnits: number;               // in standard units (assuming 100-unit bankroll)
}

interface MarketAssessment {
  market: string;
  line: number;
  side: string;
  bestOdds: number;
  bookmaker: string;
  adjustedProb: number;
  impliedProb: number;
  edge: number;
  hasValue: boolean;
}
```

**Edge threshold:** 4% minimum (calibrated from the sharp betting literature's documented hold rates for xG-based approaches).

**Cents of play calculation:**
```
centsOfPlay = bestOdds - (1 / adjustedProbability)
```
If your adjusted probability is 52% and the best odds are 2.05:
- Fair odds = 1/0.52 = 1.923
- Cents of play = 2.05 - 1.923 = 0.127 (about 13 cents)
- The line could move 13 cents against you and you'd still have value

**New file:** `lib/variance/line-assessor.ts`

---

### 2D. Bet Filter (Selectivity Gate)

**What:** Apply sharp betting discipline to narrow matches to actual bets. The engine should recommend bets on roughly 25-35% of matches — not everything with a sliver of edge.

**Filter architecture:**

```typescript
interface BetDecision {
  match: string;
  homeTeam: string;
  awayTeam: string;

  // Decision
  recommendation: "bet" | "lean" | "no_bet" | "off_limits";
  betScore: number;                // 0-1 composite quality score
  reason: string;                  // natural language explanation

  // Hard gates (must ALL pass for "bet")
  hardGates: {
    minimumEdge: { passed: boolean; value: number; threshold: number };
    minimumSampleSize: { passed: boolean; homeMatches: number; awayMatches: number; threshold: number };
    injuryInfoAvailable: { passed: boolean; homeComplete: boolean; awayComplete: boolean };
    notOffLimits: { passed: boolean; reason: string | null };
    seasonMinimum: { passed: boolean; matchday: number; threshold: number };
  };

  // Soft scoring (weighted factors, 0-1 each)
  softFactors: {
    varianceSignalStrength: { score: number; weight: number };
    regressionConfidence: { score: number; weight: number };
    injuryAdvantage: { score: number; weight: number };
    formAlignment: { score: number; weight: number };
    lineStillHasValue: { score: number; weight: number };
    crossSourceAgreement: { score: number; weight: number };
  };

  // If bet: which bet and why
  bet: LineAssessment["bestBet"] | null;

  // If no bet: why not (for transparency)
  passReason: string | null;
  // e.g. "Line is fair — edge of 1.8% below 4% threshold"
  // e.g. "Both sides chaotic — home defensive underperf meets away attacking overperf"
  // e.g. "Insufficient injury data for away side"
  // e.g. "Early season (matchday 3) — sample too small"
}
```

**Hard gates (must ALL pass):**

| Gate | Threshold | From |
|------|-----------|------|
| Minimum edge | > 4% | Sharp literature hold rate |
| Minimum sample | > 5 venue-specific matches per side | Noise filtering |
| Injury info available | At least partial for both teams | Can't assess without it |
| Not off limits | No financial/integrity flags | Manual flag list |
| Season minimum | Matchday 6+ | "League betting needs 5 matches" |

**Soft factors (weighted scoring):**

| Factor | Weight | What It Measures |
|--------|--------|-----------------|
| Variance signal strength | 0.25 | How large is the xGD/GD gap? |
| Regression confidence | 0.25 | How likely is regression to actually happen? |
| Injury advantage | 0.20 | Do injuries favor our side? |
| Form alignment | 0.15 | Does the recent trend confirm the thesis? |
| Line still has value | 0.10 | Has the line moved since we identified the edge? |
| Cross-source agreement | 0.05 | Do multiple xG providers agree? |

**Bet score = weighted sum of soft factors. Recommendations:**

| Score | Recommendation | Meaning |
|-------|---------------|---------|
| > 0.70 | `bet` | Strong — multiple factors align |
| 0.50 - 0.70 | `lean` | Interesting but not clean — show to user but flag uncertainty |
| < 0.50 | `no_bet` | Not enough signal or too many concerns |
| (off limits flag) | `off_limits` | Don't touch regardless of score |

**Auto-calibration (Phase 4):** The soft factor weights and bet score threshold will be tuned using our own CLV results over time. Start with the weights above, then optimize based on: "which weight configuration maximizes average CLV on recommended bets?"

**New file:** `lib/variance/bet-filter.ts`

---

## Phase 3: User Interface

### 3A. Variance Dashboard (New Page: `/variance`)

**Purpose:** The main analytical view. Shows xG variance across all teams in a league, with drill-down to match-level decomposition.

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│ VARIANCE DASHBOARD                                       │
│ [League: Serie A ▼] [Season: 2025-26 ▼]                │
│ [View: Home Splits ○ Away Splits ○ Both ●]              │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  VARIANCE LEADERBOARD                                    │
│  Sorted by: [Gap ▼] [Confidence] [Type]                 │
│  ┌──────────────────────────────────────────────────────┐│
│  │ Team      │ Venue │ xGD   │ GD   │ Gap   │ Type     ││
│  │           │       │       │      │       │          ││
│  │ Cagliari  │ Home  │ +4.21 │ -3   │ 7.21  │ DEF ↑   ││
│  │           │       │       │      │       │ Conf:0.88││
│  │───────────┼───────┼───────┼──────┼───────┼──────────││
│  │ Lecce     │ Away  │ -2.10 │ -9   │ 6.90  │ DEF ↑   ││
│  │           │       │       │      │       │ Conf:0.82││
│  │───────────┼───────┼───────┼──────┼───────┼──────────││
│  │ Napoli    │ Home  │+12.30 │ +16  │ 3.70  │ ATT ↓   ││
│  │           │       │       │      │       │ Conf:0.54││
│  │───────────┼───────┼───────┼──────┼───────┼──────────││
│  │ Juventus  │ Away  │ +1.50 │ +1   │ 0.50  │ Neutral ││
│  │           │       │       │      │       │ Conf:0.12││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ───── TEAM DRILL-DOWN (click any row) ─────            │
│                                                          │
│  ┌──────────────────────────────────────────────────────┐│
│  │ CAGLIARI (Home) — 14 matches                         ││
│  │                                                      ││
│  │ ATTACK                                               ││
│  │ 18 goals from 20.33 xG  (-2.33, -11%)              ││
│  │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░  Slight underperformance     ││
│  │                                                      ││
│  │ DEFENSE                                              ││
│  │ 24 conceded from 13.94 xGA  (+10.06, +72%)         ││
│  │ ▓▓▓▓▓▓▓▓▓░░░░░░░░░░░  MAJOR underperformance  ⚠   ││
│  │                                                      ││
│  │ NET: xGD +4.21, actual GD -3 → gap of 7.21 goals   ││
│  │                                                      ││
│  │ REGRESSION CONFIDENCE: 0.88 (HIGH)                   ││
│  │ ▸ 72% defensive underperformance is very reliable    ││
│  │ ▸ 14-match sample is robust                          ││
│  │ ▸ GK PSxG+/- is -0.4 (near average — not GK issue) ││
│  │ ▸ Understat and FBref agree within 0.3 xGD          ││
│  │ ▸ Last 5 home: xGD +2.1, GD -1 (still diverging)   ││
│  │                                                      ││
│  │ ┌────────── xGD TREND ──────────┐                   ││
│  │ │  ╱‾‾╲    ╱╲                   │  ← xGD per match  ││
│  │ │ ╱    ╲╱╱  ╲  ╱‾╲             │                   ││
│  │ │╱           ╲╱   ╲_____       │  ← GD per match   ││
│  │ │  MD1  MD5  MD10  MD14        │                   ││
│  │ └──────────────────────────────┘                    ││
│  │                                                      ││
│  │ GOALKEEPER: Simone Scuffet                           ││
│  │ PSxG+/-: -0.4 (near average)                        ││
│  │ → Defensive underperf is NOT goalkeeper-driven       ││
│  └──────────────────────────────────────────────────────┘│
│                                                          │
│  ───── xG SOURCE COMPARISON ─────                       │
│  ┌──────────────────────────────────────────────────────┐│
│  │ Source     │ Home xGD │ Away xGD │ Coverage          ││
│  │ Understat  │ +4.21    │ -1.85    │ 14/14 matches     ││
│  │ FBref      │ +4.48    │ -2.01    │ 14/14 matches     ││
│  │ Fotmob     │ +3.95    │ -1.72    │ 13/14 matches     ││
│  │ Average    │ +4.21    │ -1.86    │                   ││
│  │ Agreement  │ HIGH     │ HIGH     │ Δ < 0.5           ││
│  └──────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

**Key features:**
- Sortable by gap magnitude, regression confidence, variance type
- Color coding: green = regression will help team, red = regression will hurt
- Drill-down shows full decomposition with natural language explanation
- xGD trending chart per team (are metrics improving or deteriorating?)
- Goalkeeper analysis panel (PSxG+/- from FBref)
- Multi-source comparison table showing cross-validation
- Toggle between home/away splits

---

### 3B. Smart Bet Card (New Page: `/smart-bets`)

**Purpose:** The final output. Actionable bets with full reasoning, plus transparent explanations for every no-bet.

**Layout:**

```
┌─────────────────────────────────────────────────────────┐
│ SMART BETS                                               │
│ [League: Serie A ▼]  [Matchday 28]                      │
│                                                          │
│ 3 of 10 matches qualify (30% selectivity)                │
│ Avg edge: 6.1% | Avg confidence: 0.79                   │
├─────────────────────────────────────────────────────────┤
│                                                          │
│ ┌─── BET 1 ─── CONFIDENCE: HIGH (0.87) ──────────────┐ │
│ │                                                      │ │
│ │ Cagliari v Lecce                                     │ │
│ │ Saturday 15:00 | Serie A Matchday 28                 │ │
│ │                                                      │ │
│ │ BET: CAGLIARI -0.25 @ 1.98 (Pinnacle)               │ │
│ │ Edge: 7.2% | Kelly: 1.8u | Cents of play: 14        │ │
│ │                                                      │ │
│ │ ── WHY ──                                            │ │
│ │                                                      │ │
│ │ Cagliari (Home):                                     │ │
│ │ ▸ Home xGD: +4.21 but actual GD: -3                 │ │
│ │ ▸ Gap of 7.21 goals — dominated by defensive         │ │
│ │   underperformance (24 conceded from 13.94 xGA)      │ │
│ │ ▸ GK Scuffet PSxG+/- near zero — it's variance,     │ │
│ │   not bad goalkeeping                                 │ │
│ │ ▸ Regression confidence: 0.88                        │ │
│ │                                                      │ │
│ │ Lecce (Away):                                        │ │
│ │ ▸ Away xGD: -2.10 with actual GD: -9                │ │
│ │ ▸ Also defensively underperforming — but this        │ │
│ │   helps our side (their regression = fewer goals)     │ │
│ │                                                      │ │
│ │ Injuries:                                            │ │
│ │ ▸ Cagliari: 2 out (1 squad player, 1 backup DEF)    │ │
│ │ ▸ Lecce: 4 out (2 starters including starting GK)   │ │
│ │ ▸ Injury advantage: Cagliari (+3.5 impact score)     │ │
│ │                                                      │ │
│ │ ── MODELS ──                                         │ │
│ │ DC: Cagliari 44% | ELO: 41% | Market: 39%          │ │
│ │ Variance adj: +5.2% → Composite: 44.2%              │ │
│ │ Market implied (devigged): 37.8%                     │ │
│ │ Edge: 44.2% × 1.98 - 1 = +7.2%                     │ │
│ │                                                      │ │
│ │ ── LINE SHOP ──                                      │ │
│ │ Pinnacle: 1.98 | Bet365: 1.95 | Betfair: 2.02      │ │
│ │ Best: Betfair @ 2.02 → Edge becomes 8.8%            │ │
│ │                                                      │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─── NO BET ─── REASON: LINE IS FAIR ────────────────┐ │
│ │                                                      │ │
│ │ Napoli v Roma                                        │ │
│ │                                                      │ │
│ │ Napoli's +12.30 home xGD is elite, but actual GD    │ │
│ │ of +16 is built on attacking overperformance (28     │ │
│ │ goals from 22.1 xG, +27%). This is the fragile      │ │
│ │ type of variance. Line already reflects Napoli's     │ │
│ │ quality. Edge: 1.8% (below 4% threshold).           │ │
│ │                                                      │ │
│ │ Gate failed: minimum edge (1.8% < 4.0%)             │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─── NO BET ─── REASON: EARLY SEASON ────────────────┐ │
│ │                                                      │ │
│ │ Promoted FC v Established FC                         │ │
│ │                                                      │ │
│ │ Only 4 matches played — below 5-match minimum.       │ │
│ │ xG splits are not yet reliable.                      │ │
│ │                                                      │ │
│ │ Gate failed: season minimum (matchday 4 < 6)         │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ┌─── LEAN ─── CONFIDENCE: MEDIUM (0.58) ─────────────┐ │
│ │                                                      │ │
│ │ Torino v Fiorentina                                  │ │
│ │                                                      │ │
│ │ Torino home xGD: +2.8, actual GD: -1 (gap: 3.8)    │ │
│ │ Moderate signal, but Fiorentina injury info is       │ │
│ │ incomplete. Edge: 5.1%. Would be a bet with full     │ │
│ │ injury data.                                         │ │
│ │                                                      │ │
│ │ Soft factor penalty: injury info incomplete (away)   │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ ─── SEASON TRACKER ───                                   │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Total bets: 47 | Selectivity: 28%                   │ │
│ │ Avg CLV: +2.8% | CLV positive rate: 61%             │ │
│ │ Flat ROI: +4.2% | Kelly ROI: +7.1%                  │ │
│ │ Current streak: W3 | Longest losing: L6              │ │
│ │                                                      │ │
│ │ CLV over time:                                       │ │
│ │ +5%│    ╱╲        ╱‾╲                               │ │
│ │ +2%│╱‾╲╱  ╲  ╱‾╲╱   ╲╱‾‾                          │ │
│ │  0%│──────────────────────                          │ │
│ │ -2%│        ╲╱                                      │ │
│ │    └────────────────────── matchday                  │ │
│ └──────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Key features:**
- Every match gets a card — bets AND non-bets — with full reasoning
- Bets show: which side, best odds, edge, Kelly sizing, cents of play, line shop
- No-bets show: which gate failed and why (transparency builds trust in the system)
- "Lean" category for borderline bets — user can decide based on additional info
- All four model contributions visible (DC, ELO, Market, Variance)
- Season tracker: running CLV, ROI, selectivity stats
- Natural language explanations generated from the variance decomposition

---

### 3C. Enhanced CLV Tracker (Existing `/backtest` page — upgrade)

**Add to the existing backtest page:**

1. **Variance-influenced CLV vs baseline CLV**
   - Split view: CLV on bets where variance signal was strong vs where it was weak
   - Does the variance signal actually improve CLV?

2. **CLV by variance type**
   - Defensive underperformance bets vs attacking overperformance bets
   - Which type generates better CLV?

3. **Confidence calibration**
   - For bets scored as "high confidence" (>0.70), what's the actual CLV?
   - For "medium confidence" (0.50-0.70), what's the CLV?
   - Is the confidence score actually predictive?

4. **Selectivity analysis**
   - What if we were more selective (top 20% only)?
   - What if we were less selective (top 40%)?
   - Where's the CLV-maximizing selectivity threshold?

---

## Phase 4: The Feedback Loop

### 4A. CLV-Calibrated Variance Weights

**What:** Use our own bet results to optimize the variance signal's contribution.

**Process:**
1. Log every bet with: odds taken, closing odds, variance signal strength, regression confidence, bet filter score
2. After 50+ bets, calculate: does higher variance signal correlate with higher CLV?
3. Optimize the variance weight in the composite model (currently 20%) to maximize average CLV
4. Optimize the soft factor weights in the bet filter to maximize average CLV on recommended bets
5. Re-run monthly

**Implementation:**
```typescript
interface VarianceCalibration {
  // Current weights
  compositeVarianceWeight: number;   // starts at 0.20

  // Performance by variance signal strength
  bySignalStrength: {
    strong: { bets: number; avgCLV: number; roi: number };
    moderate: { bets: number; avgCLV: number; roi: number };
    weak: { bets: number; avgCLV: number; roi: number };
    none: { bets: number; avgCLV: number; roi: number };
  };

  // Optimal weight (from optimization)
  optimalVarianceWeight: number;
  optimalBetThreshold: number;

  // Confidence in calibration
  sampleSize: number;
  isCalibrated: boolean;             // true after 100+ bets
}
```

**New file:** `lib/variance/calibration.ts`

### 4B. Auto-Tuning Bet Filter

**What:** The bet filter's selectivity threshold and soft factor weights auto-adjust based on CLV results.

**Process:**
1. Every recommended bet gets tracked with full metadata
2. After each batch of 25+ bets, run optimization:
   - Try different soft factor weight combinations
   - Try different bet score thresholds (0.50 to 0.80)
   - Find the combination that maximizes: `avg_CLV × sqrt(number_of_bets)`
   - (This balances edge quality with bet volume — pure CLV maximization would recommend 1 bet/year)
3. Gradually shift weights toward optimal (don't jump — use exponential moving average)
4. Display on the CLV tracker page: "Filter confidence: calibrated on 127 bets. Current optimal threshold: 0.62"

**Safety rails:**
- Never auto-adjust to < 20% selectivity (too many bets, edge dilution)
- Never auto-adjust to > 40% selectivity (too few bets, insufficient volume)
- Require 50+ bets minimum before any auto-adjustment
- Cap weight changes at ±0.05 per calibration cycle

---

## Technical Summary

### New Files

```
lib/
  fbref.ts                         — FBref/StatsBomb scraper (xG, PSxG, npxG)
  fotmob.ts                        — Fotmob API client (match-level xG)
  injuries.ts                      — Injury data feed (API + future scraper)
  xg-splits.ts                     — Unified multi-source xG venue splits

  variance/
    types.ts                       — All interfaces
    calculator.ts                  — xG venue splits → variance metrics
    regression-scorer.ts           — Confidence scoring
    line-assessor.ts               — Edge calculation with variance adjustment
    bet-filter.ts                  — Selectivity gate
    calibration.ts                 — CLV-based weight optimization

app/
  variance/
    page.tsx                       — Variance dashboard
  smart-bets/
    page.tsx                       — Filtered bet recommendations

  api/
    variance/
      route.ts                     — Variance data API
    smart-bets/
      route.ts                     — Filtered bets API
    xg-splits/
      route.ts                     — Multi-source xG splits API
    injuries/
      route.ts                     — Injury data API
```

### Modified Files

```
lib/models/composite.ts            — Add variance as 4th signal (20% weight)
app/backtest/page.tsx              — Add variance CLV analysis panels
lib/team-mapping.ts                — Extend mappings for FBref + Fotmob team IDs
```

### Composite Model Weight Change

```typescript
// Current
weights: { dixonColes: 0.45, elo: 0.20, market: 0.35 }

// New (when variance data available)
weights: { dixonColes: 0.35, elo: 0.15, market: 0.30, variance: 0.20 }

// Fallback (no variance data — e.g., early season < 5 matches)
weights: { dixonColes: 0.45, elo: 0.20, market: 0.35, variance: 0.00 }
```

The variance signal provides a probability adjustment based on regression expectation. When variance is neutral (xG ≈ actual), the adjustment is near zero and the other three models carry proportionally more weight.

### Data Flow

```
Understat ──┐
FBref ──────┤
Fotmob ─────┤──→ xg-splits.ts ──→ calculator.ts ──→ regression-scorer.ts
football-   │                            │                    │
data.org ───┘                            │                    │
                                         ▼                    ▼
injuries.ts ──────────────────→ bet-filter.ts ◄──── line-assessor.ts
                                         │                    ▲
                                         │                    │
                                         ▼                    │
                                   composite.ts ──────────────┘
                                     (enhanced)
                                         │
                                         ▼
                                  Smart Bet Card
                                  Variance Dashboard
                                  CLV Tracker
```

---

## Implementation Priority

| Phase | Component | Effort | Impact |
|-------|-----------|--------|--------|
| **1A** | Understat xG splits upgrade | Low | Critical |
| **1A** | FBref scraper (PSxG, npxG) | Medium | High |
| **1A** | Fotmob API client | Medium | Medium |
| **1B** | Injury data feed | Medium | High |
| **2A** | Variance calculator | Low | Critical |
| **2B** | Regression confidence scorer | Medium | High |
| **2C** | Line value assessor | Low | High |
| **2D** | Bet filter | Medium | Critical |
| **3A** | Variance dashboard page | Medium | High |
| **3B** | Smart bet card page | Medium | Critical |
| **3C** | Enhanced CLV tracker | Low | Medium |
| **4A** | CLV-calibrated weights | Medium | High |
| **4B** | Auto-tuning bet filter | Medium | High |

### Build Order

**Sprint 1:** xG data + core engine
- Upgrade Understat to venue splits
- Build FBref scraper
- Build Fotmob client
- Build variance calculator + regression scorer

**Sprint 2:** Assessment layer + first UI
- Line value assessor
- Bet filter
- Injury data integration
- Variance dashboard page

**Sprint 3:** Output + tracking
- Smart bet card page
- Composite model integration (add variance as 4th signal)
- Enhanced CLV tracker panels

**Sprint 4:** Feedback loop
- CLV-calibrated variance weights
- Auto-tuning bet filter
- Selectivity optimization

---

## Success Metrics

| Metric | Target | How We Measure |
|--------|--------|---------------|
| **CLV** | > +2% average | Track closing line vs bet price for all recommended bets |
| **Selectivity** | 25-35% of matches | Count bets / total matches analyzed |
| **Flat stake ROI** | > 3% | P&L tracking over 200+ bets |
| **Confidence calibration** | High-confidence bets CLV > medium-confidence | Split CLV by confidence bucket |
| **Variance signal value** | Composite with variance beats composite without | A/B in walk-forward backtest |
| **Cross-source agreement** | > 80% of teams within 0.5 xGD across sources | Track discrepancies |

---

*This engine applies the principles of xG variance betting — venue-specific splits, attack/defense decomposition, regression confidence, injury awareness, line discipline, and ruthless selectivity — using our own data sources, our own model calibration, and our own CLV feedback loop. No external picks. No copied bets. Just the framework that works, built on data we control.*
