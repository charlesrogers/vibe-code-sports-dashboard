/**
 * Walk-Forward Backtester (Sharp Style)
 *
 * Key principles from Crane/Knutson/sharp community:
 * 1. NEVER look ahead — train only on data before the prediction date
 * 2. CLV (Closing Line Value) is the real validator, not P&L
 * 3. Calibration over accuracy — are your 60% events hitting 60%?
 * 4. Track edge decay — does your edge persist or was it data-mined?
 * 5. Out-of-sample only — no in-sample performance metrics
 *
 * Walk-forward: for each matchday, refit model on all prior data,
 * predict that matchday, compare to closing line + actual result.
 */

import { Match, DixonColesParams } from "../types";
import { fitDixonColes, predictMatch } from "../models/dixon-coles";
import { calculateEloRatings, eloWinProbability } from "../models/elo";
import { derive1X2, deriveOverUnder } from "../betting/markets";
import { blendProbs, devigOdds, type ModelWeights, DEFAULT_WEIGHTS } from "../models/composite";
import { type MatchWithOdds } from "../football-data-uk";

export interface BetRecord {
  date: string;
  homeTeam: string;
  awayTeam: string;
  round?: number;
  // Model predictions (out-of-sample)
  modelHome: number;
  modelDraw: number;
  modelAway: number;
  modelOver25: number;
  // Individual model outputs
  dcHome: number;
  dcDraw: number;
  dcAway: number;
  eloHome: number;
  eloDraw: number;
  eloAway: number;
  // Market (closing line, devigged)
  closingHome: number;
  closingDraw: number;
  closingAway: number;
  // CLV: model vs closing line (positive = we saw value market later agreed with)
  clvHome: number;
  clvDraw: number;
  clvAway: number;
  // Raw closing odds
  closingOddsHome: number;
  closingOddsDraw: number;
  closingOddsAway: number;
  // Actual result
  actualResult: "H" | "D" | "A";
  homeGoals: number;
  awayGoals: number;
  // Best bet for this match (highest edge)
  bestBetMarket: string;
  bestBetEdge: number;
  bestBetOdds: number;
  bestBetWon: boolean;
  // Brier score contribution
  brierScore: number;
}

export interface WalkForwardResult {
  bets: BetRecord[];
  summary: WalkForwardSummary;
  calibration: CalibrationBucket[];
  edgeDecay: EdgeDecayPoint[];
  modelComparison: ModelComparisonResult;
}

export interface WalkForwardSummary {
  totalMatches: number;
  // Probability quality
  brierScore: number;
  logLoss: number;
  accuracy: number;
  // CLV metrics (THE gold standard)
  avgCLV: number;          // avg CLV across all best bets
  clvPositiveRate: number; // % of bets with positive CLV
  clvByMarket: Record<string, { avg: number; count: number }>;
  // P&L (secondary — CLV is more important)
  totalBets: number;       // bets with edge > threshold
  wins: number;
  losses: number;
  hitRate: number;
  flatStakeROI: number;
  kellyROI: number;
  avgEdge: number;
  // Edge stability
  firstHalfCLV: number;
  secondHalfCLV: number;
  edgeDecayRate: number;   // negative = edge declining
}

export interface CalibrationBucket {
  range: string;
  midpoint: number;
  predicted: number;
  actual: number;
  count: number;
  deviation: number; // |predicted - actual|
}

export interface EdgeDecayPoint {
  matchday: number;
  cumulativeCLV: number;
  rollingCLV10: number;  // 10-match rolling avg CLV
  cumulativeROI: number;
}

export interface ModelComparisonResult {
  composite: { brier: number; logLoss: number; clv: number };
  dixonColes: { brier: number; logLoss: number; clv: number };
  elo: { brier: number; logLoss: number; clv: number };
  market: { brier: number; logLoss: number; clv: number };
}

/**
 * Run a full walk-forward backtest
 *
 * For each match in testMatches:
 * 1. Fit DC model on all matches BEFORE this date (never look ahead)
 * 2. Calculate ELO up to this date
 * 3. Generate composite prediction
 * 4. Compare to closing line (CLV) and actual result
 */
export function walkForwardBacktest(
  allMatches: Match[],           // all historical match data (for training)
  testMatches: MatchWithOdds[],  // matches with odds to test on
  weights: ModelWeights = DEFAULT_WEIGHTS,
  minTrainingMatches: number = 100,
  minEdge: number = 0.03,
): WalkForwardResult {
  // Sort everything chronologically
  const sortedAll = [...allMatches].sort((a, b) => a.date.localeCompare(b.date));
  const sortedTest = [...testMatches].sort((a, b) => a.date.localeCompare(b.date));

  const bets: BetRecord[] = [];

  // Group test matches by date for efficient refitting
  const dateGroups = new Map<string, MatchWithOdds[]>();
  for (const m of sortedTest) {
    if (!dateGroups.has(m.date)) dateGroups.set(m.date, []);
    dateGroups.get(m.date)!.push(m);
  }

  const dates = [...dateGroups.keys()].sort();

  // Track last fit to avoid refitting every single day
  let lastFitDate = "";
  let dcParams: DixonColesParams | null = null;
  let eloMap: Map<string, number> = new Map();

  for (const date of dates) {
    const matches = dateGroups.get(date)!;

    // Get training data: all matches strictly before this date
    const trainingMatches = sortedAll.filter((m) => m.date < date);

    if (trainingMatches.length < minTrainingMatches) continue;

    // Refit model (at most once per week to save compute)
    const weekKey = date.slice(0, 7); // YYYY-MM
    if (weekKey !== lastFitDate || !dcParams) {
      dcParams = fitDixonColes(trainingMatches);
      const eloRatings = calculateEloRatings(trainingMatches);
      eloMap = new Map(eloRatings.map((e) => [e.team, e.rating]));
      lastFitDate = weekKey;
    }

    for (const m of matches) {
      // Skip if teams not in model
      if (!(m.homeTeam in dcParams.attack) || !(m.awayTeam in dcParams.attack)) continue;

      // 1. Dixon-Coles prediction
      const grid = predictMatch(m.homeTeam, m.awayTeam, dcParams);
      const dcProbs = derive1X2(grid);
      const dcOU25 = deriveOverUnder(grid, 2.5);

      // 2. ELO prediction
      const homeElo = eloMap.get(m.homeTeam) || 1500;
      const awayElo = eloMap.get(m.awayTeam) || 1500;
      const eloProbs = eloWinProbability(homeElo, awayElo);

      // 3. Market closing line (use Pinnacle or average — sharpest available)
      const closingOdds = {
        home: m.pinnacleHome || m.avgHome,
        draw: m.pinnacleDraw || m.avgDraw,
        away: m.pinnacleAway || m.avgAway,
      };

      if (closingOdds.home <= 1 || closingOdds.draw <= 1 || closingOdds.away <= 1) continue;

      const closingProbs = devigOdds(closingOdds.home, closingOdds.draw, closingOdds.away);
      if (!closingProbs) continue;

      // 4. Composite blend
      const blended = blendProbs(dcProbs, eloProbs, closingProbs, weights);

      // Actual result
      const actualResult = m.result as "H" | "D" | "A";

      // CLV: our model probability minus closing line probability
      // Positive CLV = we identified value that the sharp market later confirmed
      const clvHome = blended.home - closingProbs.home;
      const clvDraw = blended.draw - closingProbs.draw;
      const clvAway = blended.away - closingProbs.away;

      // Find best bet (highest edge vs closing line)
      const edges = [
        { market: "Home", edge: clvHome, odds: closingOdds.home, won: actualResult === "H" },
        { market: "Draw", edge: clvDraw, odds: closingOdds.draw, won: actualResult === "D" },
        { market: "Away", edge: clvAway, odds: closingOdds.away, won: actualResult === "A" },
      ];
      const bestBet = edges.sort((a, b) => b.edge - a.edge)[0];

      // Brier score (all 3 outcomes)
      const actH = actualResult === "H" ? 1 : 0;
      const actD = actualResult === "D" ? 1 : 0;
      const actA = actualResult === "A" ? 1 : 0;
      const brier = (blended.home - actH) ** 2 + (blended.draw - actD) ** 2 + (blended.away - actA) ** 2;

      bets.push({
        date: m.date,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        round: undefined,
        modelHome: blended.home,
        modelDraw: blended.draw,
        modelAway: blended.away,
        modelOver25: dcOU25.over,
        dcHome: dcProbs.home,
        dcDraw: dcProbs.draw,
        dcAway: dcProbs.away,
        eloHome: eloProbs.home,
        eloDraw: eloProbs.draw,
        eloAway: eloProbs.away,
        closingHome: closingProbs.home,
        closingDraw: closingProbs.draw,
        closingAway: closingProbs.away,
        clvHome,
        clvDraw,
        clvAway,
        closingOddsHome: closingOdds.home,
        closingOddsDraw: closingOdds.draw,
        closingOddsAway: closingOdds.away,
        actualResult,
        homeGoals: m.homeGoals,
        awayGoals: m.awayGoals,
        bestBetMarket: bestBet.market,
        bestBetEdge: bestBet.edge,
        bestBetOdds: bestBet.odds,
        bestBetWon: bestBet.won,
        brierScore: brier,
      });
    }
  }

  // Calculate summary stats
  const summary = calculateSummary(bets, minEdge);
  const calibration = calculateCalibration(bets);
  const edgeDecay = calculateEdgeDecay(bets);
  const modelComparison = calculateModelComparison(bets);

  return { bets, summary, calibration, edgeDecay, modelComparison };
}

function calculateSummary(bets: BetRecord[], minEdge: number): WalkForwardSummary {
  const n = bets.length;
  if (n === 0) {
    return {
      totalMatches: 0, brierScore: 0, logLoss: 0, accuracy: 0,
      avgCLV: 0, clvPositiveRate: 0, clvByMarket: {},
      totalBets: 0, wins: 0, losses: 0, hitRate: 0,
      flatStakeROI: 0, kellyROI: 0, avgEdge: 0,
      firstHalfCLV: 0, secondHalfCLV: 0, edgeDecayRate: 0,
    };
  }

  // Probability quality metrics
  const brierScore = bets.reduce((s, b) => s + b.brierScore, 0) / n;

  let logLossSum = 0;
  let correct = 0;
  for (const b of bets) {
    const p = b.actualResult === "H" ? b.modelHome
      : b.actualResult === "D" ? b.modelDraw : b.modelAway;
    logLossSum += -Math.log(Math.max(p, 0.001));
    const predicted = b.modelHome >= b.modelDraw && b.modelHome >= b.modelAway ? "H"
      : b.modelAway >= b.modelDraw ? "A" : "D";
    if (predicted === b.actualResult) correct++;
  }

  // CLV metrics
  const clvValues = bets.map((b) => b.bestBetEdge);
  const avgCLV = clvValues.reduce((s, v) => s + v, 0) / n;
  const clvPositiveRate = clvValues.filter((v) => v > 0).length / n;

  // CLV by market
  const clvByMarket: Record<string, { avg: number; count: number }> = {};
  for (const b of bets) {
    if (!clvByMarket[b.bestBetMarket]) clvByMarket[b.bestBetMarket] = { avg: 0, count: 0 };
    clvByMarket[b.bestBetMarket].avg += b.bestBetEdge;
    clvByMarket[b.bestBetMarket].count++;
  }
  for (const m of Object.keys(clvByMarket)) {
    clvByMarket[m].avg = clvByMarket[m].avg / clvByMarket[m].count;
  }

  // P&L: only on bets where model found edge > minEdge
  const edgeBets = bets.filter((b) => b.bestBetEdge >= minEdge);
  const wins = edgeBets.filter((b) => b.bestBetWon);
  const totalReturn = wins.reduce((s, b) => s + b.bestBetOdds, 0);
  const flatROI = edgeBets.length > 0
    ? ((totalReturn - edgeBets.length) / edgeBets.length) * 100
    : 0;

  // Kelly P&L
  let kellyBankroll = 100;
  for (const b of edgeBets) {
    const edge = b.bestBetEdge;
    const odds = b.bestBetOdds - 1;
    const kelly = Math.min(0.05, Math.max(0, (odds * (b.modelHome >= b.modelDraw && b.modelHome >= b.modelAway ? b.modelHome : b.modelAway >= b.modelDraw ? b.modelAway : b.modelDraw) - (1 - (b.modelHome >= b.modelDraw && b.modelHome >= b.modelAway ? b.modelHome : b.modelAway >= b.modelDraw ? b.modelAway : b.modelDraw))) / odds));
    const stake = kellyBankroll * kelly * 0.25; // quarter Kelly
    if (b.bestBetWon) {
      kellyBankroll += stake * (b.bestBetOdds - 1);
    } else {
      kellyBankroll -= stake;
    }
  }
  const kellyROI = ((kellyBankroll - 100) / 100) * 100;

  // Edge decay: first half vs second half CLV
  const half = Math.floor(n / 2);
  const firstHalfCLV = bets.slice(0, half).reduce((s, b) => s + b.bestBetEdge, 0) / half;
  const secondHalfCLV = bets.slice(half).reduce((s, b) => s + b.bestBetEdge, 0) / (n - half);

  return {
    totalMatches: n,
    brierScore: Math.round(brierScore * 10000) / 10000,
    logLoss: Math.round(logLossSum / n * 1000) / 1000,
    accuracy: Math.round(correct / n * 1000) / 10,
    avgCLV: Math.round(avgCLV * 10000) / 100,      // as percentage
    clvPositiveRate: Math.round(clvPositiveRate * 1000) / 10,
    clvByMarket,
    totalBets: edgeBets.length,
    wins: wins.length,
    losses: edgeBets.length - wins.length,
    hitRate: edgeBets.length > 0 ? Math.round(wins.length / edgeBets.length * 1000) / 10 : 0,
    flatStakeROI: Math.round(flatROI * 10) / 10,
    kellyROI: Math.round(kellyROI * 10) / 10,
    avgEdge: edgeBets.length > 0
      ? Math.round(edgeBets.reduce((s, b) => s + b.bestBetEdge, 0) / edgeBets.length * 10000) / 100
      : 0,
    firstHalfCLV: Math.round(firstHalfCLV * 10000) / 100,
    secondHalfCLV: Math.round(secondHalfCLV * 10000) / 100,
    edgeDecayRate: Math.round((secondHalfCLV - firstHalfCLV) * 10000) / 100,
  };
}

function calculateCalibration(bets: BetRecord[]): CalibrationBucket[] {
  // 20 buckets of 5% each for finer-grained calibration
  const buckets: { predicted: number; actual: number; count: number }[] = [];
  for (let i = 0; i < 20; i++) buckets.push({ predicted: 0, actual: 0, count: 0 });

  for (const b of bets) {
    // Check each outcome's calibration
    const outcomes = [
      { prob: b.modelHome, hit: b.actualResult === "H" },
      { prob: b.modelDraw, hit: b.actualResult === "D" },
      { prob: b.modelAway, hit: b.actualResult === "A" },
    ];

    for (const o of outcomes) {
      const idx = Math.min(19, Math.floor(o.prob * 20));
      buckets[idx].predicted += o.prob;
      buckets[idx].actual += o.hit ? 1 : 0;
      buckets[idx].count++;
    }
  }

  return buckets
    .map((b, i) => ({
      range: `${i * 5}-${(i + 1) * 5}%`,
      midpoint: (i * 5 + 2.5) / 100,
      predicted: b.count > 0 ? b.predicted / b.count : 0,
      actual: b.count > 0 ? b.actual / b.count : 0,
      count: b.count,
      deviation: b.count > 0 ? Math.abs(b.predicted / b.count - b.actual / b.count) : 0,
    }))
    .filter((b) => b.count >= 5); // only show buckets with enough data
}

function calculateEdgeDecay(bets: BetRecord[]): EdgeDecayPoint[] {
  const points: EdgeDecayPoint[] = [];
  let cumCLV = 0;
  let cumPnL = 0;
  const window = 10;

  for (let i = 0; i < bets.length; i++) {
    cumCLV += bets[i].bestBetEdge;
    cumPnL += bets[i].bestBetWon ? (bets[i].bestBetOdds - 1) : -1;

    // Rolling CLV (10-match window)
    const start = Math.max(0, i - window + 1);
    const windowBets = bets.slice(start, i + 1);
    const rollingCLV = windowBets.reduce((s, b) => s + b.bestBetEdge, 0) / windowBets.length;

    if (i % 5 === 0 || i === bets.length - 1) { // sample every 5 matches
      points.push({
        matchday: i + 1,
        cumulativeCLV: Math.round(cumCLV / (i + 1) * 10000) / 100,
        rollingCLV10: Math.round(rollingCLV * 10000) / 100,
        cumulativeROI: Math.round(cumPnL / (i + 1) * 10000) / 100,
      });
    }
  }

  return points;
}

function calculateModelComparison(bets: BetRecord[]): ModelComparisonResult {
  const n = bets.length;
  if (n === 0) {
    const zero = { brier: 0, logLoss: 0, clv: 0 };
    return { composite: zero, dixonColes: zero, elo: zero, market: zero };
  }

  let compBrier = 0, dcBrier = 0, eloBrier = 0, mktBrier = 0;
  let compLL = 0, dcLL = 0, eloLL = 0, mktLL = 0;
  let compCLV = 0, dcCLV = 0, eloCLV = 0;

  for (const b of bets) {
    const actH = b.actualResult === "H" ? 1 : 0;
    const actD = b.actualResult === "D" ? 1 : 0;
    const actA = b.actualResult === "A" ? 1 : 0;

    // Composite
    compBrier += (b.modelHome - actH) ** 2 + (b.modelDraw - actD) ** 2 + (b.modelAway - actA) ** 2;
    compLL += -Math.log(Math.max(actH ? b.modelHome : actD ? b.modelDraw : b.modelAway, 0.001));

    // Dixon-Coles
    dcBrier += (b.dcHome - actH) ** 2 + (b.dcDraw - actD) ** 2 + (b.dcAway - actA) ** 2;
    dcLL += -Math.log(Math.max(actH ? b.dcHome : actD ? b.dcDraw : b.dcAway, 0.001));

    // ELO
    eloBrier += (b.eloHome - actH) ** 2 + (b.eloDraw - actD) ** 2 + (b.eloAway - actA) ** 2;
    eloLL += -Math.log(Math.max(actH ? b.eloHome : actD ? b.eloDraw : b.eloAway, 0.001));

    // Market (closing line)
    mktBrier += (b.closingHome - actH) ** 2 + (b.closingDraw - actD) ** 2 + (b.closingAway - actA) ** 2;
    mktLL += -Math.log(Math.max(actH ? b.closingHome : actD ? b.closingDraw : b.closingAway, 0.001));

    // CLV: each model vs closing line
    const bestMarketIdx = [b.modelHome, b.modelDraw, b.modelAway].indexOf(Math.max(b.modelHome, b.modelDraw, b.modelAway));
    const closings = [b.closingHome, b.closingDraw, b.closingAway];
    compCLV += [b.modelHome, b.modelDraw, b.modelAway][bestMarketIdx] - closings[bestMarketIdx];

    const dcBestIdx = [b.dcHome, b.dcDraw, b.dcAway].indexOf(Math.max(b.dcHome, b.dcDraw, b.dcAway));
    dcCLV += [b.dcHome, b.dcDraw, b.dcAway][dcBestIdx] - closings[dcBestIdx];

    const eloBestIdx = [b.eloHome, b.eloDraw, b.eloAway].indexOf(Math.max(b.eloHome, b.eloDraw, b.eloAway));
    eloCLV += [b.eloHome, b.eloDraw, b.eloAway][eloBestIdx] - closings[eloBestIdx];
  }

  return {
    composite: {
      brier: Math.round(compBrier / n * 10000) / 10000,
      logLoss: Math.round(compLL / n * 1000) / 1000,
      clv: Math.round(compCLV / n * 10000) / 100,
    },
    dixonColes: {
      brier: Math.round(dcBrier / n * 10000) / 10000,
      logLoss: Math.round(dcLL / n * 1000) / 1000,
      clv: Math.round(dcCLV / n * 10000) / 100,
    },
    elo: {
      brier: Math.round(eloBrier / n * 10000) / 10000,
      logLoss: Math.round(eloLL / n * 1000) / 1000,
      clv: Math.round(eloCLV / n * 10000) / 100,
    },
    market: {
      brier: Math.round(mktBrier / n * 10000) / 10000,
      logLoss: Math.round(mktLL / n * 1000) / 1000,
      clv: 0, // market vs itself = 0 by definition
    },
  };
}
