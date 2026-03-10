/**
 * Model Evaluation API — Walk-Forward Out-of-Sample Testing
 *
 * Tests ALL models on completed matches:
 *   1. Dixon-Coles (structural Poisson)
 *   2. ELO (form/momentum)
 *   3. Bayesian Poisson (Mack's approach with shrinkage)
 *   4. Ted Variance (directional — needs xG data from Understat)
 *   5. Composite (weighted blend of 1-3)
 *
 * Metrics per Mack's hierarchy:
 *   #1 Log Loss, #2 Brier Score, #3 Accuracy
 * Ted is scored on directional accuracy (not Log Loss — it's a modifier, not a full 1X2 model)
 *
 * Supports multi-season evaluation via ?season=multi for statistical significance.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Match } from "@/lib/types";
import { fetchOpenFootballMatches, type League } from "@/lib/openfootball";
import { fitDixonColes, predictMatch } from "@/lib/models/dixon-coles";
import { calculateEloRatings, eloWinProbability } from "@/lib/models/elo";
import { fitBayesianPoisson, bayesPredict1X2 } from "@/lib/models/bayesian-poisson";
import { derive1X2 } from "@/lib/betting/markets";
import { fetchUnderstatRawHistory, aggregateXgBeforeDate, type UnderstatTeamHistory } from "@/lib/understat";
import { calculateTeamVariance } from "@/lib/variance/calculator";
import { assessMatch } from "@/lib/variance/match-assessor";
import { fetchMatchesWithOdds, type MatchWithOdds } from "@/lib/football-data-uk";

/**
 * Simple devig: normalize implied probabilities from decimal odds to sum to 1.
 * Removes the bookmaker's overround to get "true" probabilities.
 */
function devigClosingLine(homeOdds: number, drawOdds: number, awayOdds: number): { home: number; draw: number; away: number } | null {
  if (homeOdds <= 1 || drawOdds <= 1 || awayOdds <= 1) return null;
  const h = 1 / homeOdds, d = 1 / drawOdds, a = 1 / awayOdds;
  const total = h + d + a;
  return { home: h / total, draw: d / total, away: a / total };
}

interface MatchEval {
  date: string;
  round?: number;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  actualResult: "H" | "D" | "A";
  // Each model's 1X2 probabilities
  dixonColes: { home: number; draw: number; away: number };
  elo: { home: number; draw: number; away: number };
  bayesian: { home: number; draw: number; away: number };
  composite: { home: number; draw: number; away: number };
  // Market closing line (devigged probabilities from Pinnacle/avg odds)
  market?: { home: number; draw: number; away: number };
  marketCorrect?: boolean;
  closingOdds?: { home: number; draw: number; away: number }; // raw Pinnacle odds
  // Ted variance (directional, not 1X2)
  ted: { edgeSide: "home" | "away" | "neutral"; hasBet: boolean; grade: "A" | "B" | "C" | null; confidence: number } | null;
  // Per-model correctness
  dcCorrect: boolean;
  eloCorrect: boolean;
  bayesCorrect: boolean;
  compositeCorrect: boolean;
  tedCorrect: boolean | null; // null if Ted had no signal
}

interface ModelScore {
  logLoss: number;
  brier: number;
  accuracy: number;
  calibration: { bucket: string; predicted: number; actual: number; count: number }[];
}

interface TedScore {
  directionalAccuracy: number; // when Ted has a side, how often is it right?
  betHitRate: number;          // when Ted says "bet", how often does the side win?
  totalSignals: number;
  totalBets: number;
  byGrade: { grade: string; bets: number; wins: number; hitRate: number }[];
}

function logLossVal(prob: number): number {
  return -Math.log(Math.max(prob, 0.001));
}

function brierContrib(
  probs: { home: number; draw: number; away: number },
  result: "H" | "D" | "A"
): number {
  const actH = result === "H" ? 1 : 0;
  const actD = result === "D" ? 1 : 0;
  const actA = result === "A" ? 1 : 0;
  return (probs.home - actH) ** 2 + (probs.draw - actD) ** 2 + (probs.away - actA) ** 2;
}

function predictedResult(p: { home: number; draw: number; away: number }): "H" | "D" | "A" {
  if (p.home >= p.draw && p.home >= p.away) return "H";
  if (p.away >= p.draw) return "A";
  return "D";
}

function getLogLossForResult(
  probs: { home: number; draw: number; away: number },
  result: "H" | "D" | "A"
): number {
  const p = result === "H" ? probs.home : result === "D" ? probs.draw : probs.away;
  return logLossVal(p);
}

function buildCalibration(
  predictions: { prob: number; hit: boolean }[]
): { bucket: string; predicted: number; actual: number; count: number }[] {
  const buckets: { predicted: number; actual: number; count: number }[] = [];
  for (let i = 0; i < 10; i++) buckets.push({ predicted: 0, actual: 0, count: 0 });

  for (const p of predictions) {
    const idx = Math.min(9, Math.floor(p.prob * 10));
    buckets[idx].predicted += p.prob;
    buckets[idx].actual += p.hit ? 1 : 0;
    buckets[idx].count++;
  }

  return buckets
    .map((b, i) => ({
      bucket: `${i * 10}-${(i + 1) * 10}%`,
      predicted: b.count > 0 ? Math.round((b.predicted / b.count) * 1000) / 10 : 0,
      actual: b.count > 0 ? Math.round((b.actual / b.count) * 1000) / 10 : 0,
      count: b.count,
    }))
    .filter((b) => b.count >= 3);
}

function scoreModel(
  matchEvals: MatchEval[],
  getProbs: (m: MatchEval) => { home: number; draw: number; away: number },
  getCorrect: (m: MatchEval) => boolean
): ModelScore {
  const n = matchEvals.length;
  let llSum = 0;
  let brierSum = 0;
  let correctCount = 0;
  const calData: { prob: number; hit: boolean }[] = [];

  for (const m of matchEvals) {
    const probs = getProbs(m);
    llSum += getLogLossForResult(probs, m.actualResult);
    brierSum += brierContrib(probs, m.actualResult);
    if (getCorrect(m)) correctCount++;
    calData.push({ prob: probs.home, hit: m.actualResult === "H" });
    calData.push({ prob: probs.draw, hit: m.actualResult === "D" });
    calData.push({ prob: probs.away, hit: m.actualResult === "A" });
  }

  return {
    logLoss: Math.round((llSum / n) * 1000) / 1000,
    brier: Math.round((brierSum / n) * 10000) / 10000,
    accuracy: Math.round((correctCount / n) * 1000) / 10,
    calibration: buildCalibration(calData),
  };
}

function scoreTed(matchEvals: MatchEval[]): TedScore {
  const withSignal = matchEvals.filter((m) => m.ted && m.ted.edgeSide !== "neutral");
  const withBet = matchEvals.filter((m) => m.ted && m.ted.hasBet);

  let directionalCorrect = 0;
  for (const m of withSignal) {
    const tedSide = m.ted!.edgeSide;
    if (
      (tedSide === "home" && m.actualResult === "H") ||
      (tedSide === "away" && m.actualResult === "A")
    ) {
      directionalCorrect++;
    }
  }

  let betWins = 0;
  for (const m of withBet) {
    const tedSide = m.ted!.edgeSide;
    if (
      (tedSide === "home" && m.actualResult === "H") ||
      (tedSide === "away" && m.actualResult === "A")
    ) {
      betWins++;
    }
  }

  // By grade
  const gradeMap = new Map<string, { bets: number; wins: number }>();
  for (const m of withBet) {
    const g = m.ted!.grade || "C";
    if (!gradeMap.has(g)) gradeMap.set(g, { bets: 0, wins: 0 });
    const entry = gradeMap.get(g)!;
    entry.bets++;
    const tedSide = m.ted!.edgeSide;
    if (
      (tedSide === "home" && m.actualResult === "H") ||
      (tedSide === "away" && m.actualResult === "A")
    ) {
      entry.wins++;
    }
  }

  const byGrade = [...gradeMap.entries()]
    .map(([grade, { bets, wins }]) => ({
      grade,
      bets,
      wins,
      hitRate: bets > 0 ? Math.round((wins / bets) * 1000) / 10 : 0,
    }))
    .sort((a, b) => a.grade.localeCompare(b.grade));

  return {
    directionalAccuracy: withSignal.length > 0 ? Math.round((directionalCorrect / withSignal.length) * 1000) / 10 : 0,
    betHitRate: withBet.length > 0 ? Math.round((betWins / withBet.length) * 1000) / 10 : 0,
    totalSignals: withSignal.length,
    totalBets: withBet.length,
    byGrade,
  };
}

/**
 * Apply Ted's directional signal as a probability modifier to a base model.
 * When Ted has a signal, shift probability toward Ted's favored side.
 * The shift is proportional to Ted's confidence.
 *
 * This tests whether Ted adds value as an overlay — its intended use case.
 */
function applyTedOverlay(
  baseProbs: { home: number; draw: number; away: number },
  ted: MatchEval["ted"],
  strength: number = 0.08 // max shift: 8% of probability mass
): { home: number; draw: number; away: number } {
  if (!ted || ted.edgeSide === "neutral") return baseProbs;

  const shift = strength * ted.confidence;
  let { home, draw, away } = baseProbs;

  if (ted.edgeSide === "home") {
    home += shift;
    draw -= shift * 0.4;
    away -= shift * 0.6;
  } else {
    away += shift;
    draw -= shift * 0.4;
    home -= shift * 0.6;
  }

  // Clamp and normalize
  home = Math.max(0.01, home);
  draw = Math.max(0.01, draw);
  away = Math.max(0.01, away);
  const total = home + draw + away;
  return { home: home / total, draw: draw / total, away: away / total };
}

/**
 * Score a model with Ted overlay applied — for comparison with base model.
 */
function scoreModelWithTed(
  matchEvals: MatchEval[],
  getBaseProbs: (m: MatchEval) => { home: number; draw: number; away: number }
): ModelScore {
  const n = matchEvals.length;
  let llSum = 0;
  let brierSum = 0;
  let correctCount = 0;
  const calData: { prob: number; hit: boolean }[] = [];

  for (const m of matchEvals) {
    const base = getBaseProbs(m);
    const adjusted = applyTedOverlay(base, m.ted);
    llSum += getLogLossForResult(adjusted, m.actualResult);
    brierSum += brierContrib(adjusted, m.actualResult);
    if (predictedResult(adjusted) === m.actualResult) correctCount++;
    calData.push({ prob: adjusted.home, hit: m.actualResult === "H" });
    calData.push({ prob: adjusted.draw, hit: m.actualResult === "D" });
    calData.push({ prob: adjusted.away, hit: m.actualResult === "A" });
  }

  return {
    logLoss: Math.round((llSum / n) * 1000) / 1000,
    brier: Math.round((brierSum / n) * 10000) / 10000,
    accuracy: Math.round((correctCount / n) * 1000) / 10,
    calibration: buildCalibration(calData),
  };
}

function r4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

// Cache
let evalCache: { league: string; result: unknown; ts: number } | null = null;
const CACHE_TTL = 30 * 60 * 1000;

/**
 * Map a season string like "2023-24" to the Understat year format "2023".
 * Understat uses the starting year of the season.
 */
function seasonToUnderstatYear(season: string): string {
  return season.split("-")[0];
}


/**
 * Evaluate a single test season with walk-forward methodology:
 * train on all seasons strictly before the test season, predict test matches.
 * Returns the matchEvals and xgSource for that season.
 */
async function evaluateSingleSeasonEvals(
  allMatches: Match[],
  testSeason: string,
  league: string,
  understatYear: string | null
): Promise<{ matchEvals: MatchEval[]; xgSource: string }> {
  // Walk-forward: train only on seasons strictly before the test season
  const testMatches = allMatches.filter((m) => m.season === testSeason);
  const training = allMatches.filter((m) => m.season < testSeason);

  if (testMatches.length === 0 || training.length < 80) {
    return { matchEvals: [], xgSource: "none" };
  }

  // Fit all probability models on training data
  const dcParams = fitDixonColes(training);
  const eloRatings = calculateEloRatings(training);
  const eloMap = new Map(eloRatings.map((e) => [e.team, e.rating]));
  const bayesParams = fitBayesianPoisson(training);

  // Fetch raw Understat xG history for walk-forward Ted Variance
  let rawXgHistory: UnderstatTeamHistory[] | null = null;
  let xgSource = "none";
  if (understatYear) {
    try {
      rawXgHistory = await fetchUnderstatRawHistory(league, understatYear);
      xgSource = `understat-live (walk-forward, ${understatYear})`;
    } catch {
      xgSource = "unavailable";
    }
  }
  const xgByTeam = new Map<string, UnderstatTeamHistory>();
  if (rawXgHistory) {
    for (const t of rawXgHistory) xgByTeam.set(t.team, t);
  }

  // Fetch betting odds from football-data.co.uk for this season
  let oddsData: MatchWithOdds[] = [];
  try {
    oddsData = await fetchMatchesWithOdds(testSeason, league as "serieA" | "serieB");
  } catch {
    // odds unavailable for this season
  }
  const oddsLookup = new Map<string, MatchWithOdds>();
  for (const od of oddsData) {
    const key = `${od.date}-${od.homeTeam}-${od.awayTeam}`;
    oddsLookup.set(key, od);
  }

  // Evaluate each match
  const sortedTest = [...testMatches].sort((a, b) => a.date.localeCompare(b.date));
  const matchEvals: MatchEval[] = [];

  for (const match of sortedTest) {
    if (!(match.homeTeam in dcParams.attack) || !(match.awayTeam in dcParams.attack)) continue;
    if (!(match.homeTeam in bayesParams.attack) || !(match.awayTeam in bayesParams.attack)) continue;

    const actual: "H" | "D" | "A" =
      match.homeGoals > match.awayGoals ? "H" :
      match.homeGoals < match.awayGoals ? "A" : "D";

    const grid = predictMatch(match.homeTeam, match.awayTeam, dcParams);
    const dcProbs = derive1X2(grid);

    const homeElo = eloMap.get(match.homeTeam) || 1500;
    const awayElo = eloMap.get(match.awayTeam) || 1500;
    const eloProbs = eloWinProbability(homeElo, awayElo);

    const bayesProbs = bayesPredict1X2(match.homeTeam, match.awayTeam, bayesParams);

    // Ted Variance (walk-forward)
    let tedResult: MatchEval["ted"] = null;
    let tedCorrect: boolean | null = null;
    if (rawXgHistory) {
      const homeHistory = xgByTeam.get(match.homeTeam);
      const awayHistory = xgByTeam.get(match.awayTeam);
      if (homeHistory && awayHistory) {
        const homeXg = aggregateXgBeforeDate(homeHistory, match.date, "h");
        const awayXg = aggregateXgBeforeDate(awayHistory, match.date, "a");
        if (homeXg && awayXg) {
          const homeV = calculateTeamVariance(homeXg);
          const awayV = calculateTeamVariance(awayXg);
          const assessment = assessMatch(homeV, awayV);
          tedResult = {
            edgeSide: assessment.edgeSide,
            hasBet: assessment.hasBet,
            grade: assessment.betGrade,
            confidence: assessment.confidence,
          };
          if (assessment.edgeSide !== "neutral") {
            tedCorrect =
              (assessment.edgeSide === "home" && actual === "H") ||
              (assessment.edgeSide === "away" && actual === "A");
          }
        }
      }
    }

    // Market closing line
    let marketProbs: { home: number; draw: number; away: number } | undefined;
    let closingOddsRaw: { home: number; draw: number; away: number } | undefined;
    const oddsKey = `${match.date}-${match.homeTeam}-${match.awayTeam}`;
    const oddsMatch = oddsLookup.get(oddsKey);
    if (oddsMatch) {
      const hOdds = oddsMatch.pinnacleHome || oddsMatch.avgHome;
      const dOdds = oddsMatch.pinnacleDraw || oddsMatch.avgDraw;
      const aOdds = oddsMatch.pinnacleAway || oddsMatch.avgAway;
      closingOddsRaw = { home: hOdds, draw: dOdds, away: aOdds };
      const devigged = devigClosingLine(hOdds, dOdds, aOdds);
      if (devigged) {
        marketProbs = devigged;
      }
    }

    // Composite (DC 50% + Bayes 25% + ELO 25%)
    const compHome = 0.50 * dcProbs.home + 0.25 * bayesProbs.home + 0.25 * eloProbs.home;
    const compDraw = 0.50 * dcProbs.draw + 0.25 * bayesProbs.draw + 0.25 * eloProbs.draw;
    const compAway = 0.50 * dcProbs.away + 0.25 * bayesProbs.away + 0.25 * eloProbs.away;
    const compTotal = compHome + compDraw + compAway;
    const compositeProbs = {
      home: compHome / compTotal,
      draw: compDraw / compTotal,
      away: compAway / compTotal,
    };

    matchEvals.push({
      date: match.date,
      round: match.round,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      actualResult: actual,
      dixonColes: { home: r4(dcProbs.home), draw: r4(dcProbs.draw), away: r4(dcProbs.away) },
      elo: { home: r4(eloProbs.home), draw: r4(eloProbs.draw), away: r4(eloProbs.away) },
      bayesian: { home: r4(bayesProbs.home), draw: r4(bayesProbs.draw), away: r4(bayesProbs.away) },
      composite: { home: r4(compositeProbs.home), draw: r4(compositeProbs.draw), away: r4(compositeProbs.away) },
      market: marketProbs ? { home: r4(marketProbs.home), draw: r4(marketProbs.draw), away: r4(marketProbs.away) } : undefined,
      marketCorrect: marketProbs ? predictedResult(marketProbs) === actual : undefined,
      closingOdds: closingOddsRaw,
      ted: tedResult,
      dcCorrect: predictedResult(dcProbs) === actual,
      eloCorrect: predictedResult(eloProbs) === actual,
      bayesCorrect: predictedResult(bayesProbs) === actual,
      compositeCorrect: predictedResult(compositeProbs) === actual,
      tedCorrect,
    });
  }

  return { matchEvals, xgSource };
}

/**
 * Score all models and build the full result object from a set of matchEvals.
 * Used by both single-season and multi-season paths to avoid duplication.
 */
function buildResultFromEvals(
  matchEvals: MatchEval[],
  league: string,
  season: string,
  xgSource: string,
  methodologyTraining: string,
  methodologyTestSet: string,
  seasonBreakdown?: { season: string; matchesEvaluated: number; models: { dixonColes: ModelScore; elo: ModelScore; bayesian: ModelScore; composite: ModelScore; market?: ModelScore | null }; ted: TedScore }[]
): Record<string, unknown> {
  // Score each base model
  const dcScore = scoreModel(matchEvals, (m) => m.dixonColes, (m) => m.dcCorrect);
  const eloScore = scoreModel(matchEvals, (m) => m.elo, (m) => m.eloCorrect);
  const bayesScore = scoreModel(matchEvals, (m) => m.bayesian, (m) => m.bayesCorrect);
  const compositeScore = scoreModel(matchEvals, (m) => m.composite, (m) => m.compositeCorrect);
  const tedScore = scoreTed(matchEvals);

  // Score Market model (only on matches that have odds data)
  const matchesWithMarket = matchEvals.filter((m) => m.market != null);
  let marketScore: ModelScore | null = null;
  if (matchesWithMarket.length > 0) {
    marketScore = scoreModel(
      matchesWithMarket,
      (m) => m.market!,
      (m) => m.marketCorrect === true,
    );
  }

  // Compute CLV for each model
  const clv: Record<string, { avgCLV: number; matchesWithOdds: number }> = {};
  if (matchesWithMarket.length > 0) {
    const modelAccessors: { name: string; getProbs: (m: MatchEval) => { home: number; draw: number; away: number } }[] = [
      { name: "dixonColes", getProbs: (m) => m.dixonColes },
      { name: "elo", getProbs: (m) => m.elo },
      { name: "bayesian", getProbs: (m) => m.bayesian },
      { name: "composite", getProbs: (m) => m.composite },
    ];

    for (const { name, getProbs } of modelAccessors) {
      let clvSum = 0;
      for (const m of matchesWithMarket) {
        const probs = getProbs(m);
        const market = m.market!;
        if (m.actualResult === "H") clvSum += probs.home - market.home;
        else if (m.actualResult === "D") clvSum += probs.draw - market.draw;
        else clvSum += probs.away - market.away;
      }
      clv[name] = {
        avgCLV: Math.round((clvSum / matchesWithMarket.length) * 10000) / 10000,
        matchesWithOdds: matchesWithMarket.length,
      };
    }
  }

  // Score each model WITH Ted overlay
  const dcTedScore = scoreModelWithTed(matchEvals, (m) => m.dixonColes);
  const eloTedScore = scoreModelWithTed(matchEvals, (m) => m.elo);
  const bayesTedScore = scoreModelWithTed(matchEvals, (m) => m.bayesian);
  const compositeTedScore = scoreModelWithTed(matchEvals, (m) => m.composite);

  // Score Market + Ted overlay
  let marketTedScore: ModelScore | null = null;
  if (matchesWithMarket.length > 0) {
    marketTedScore = scoreModelWithTed(matchesWithMarket, (m) => m.market!);
  }

  // Build Ted overlay comparison
  const tedOverlayComparison = [
    {
      model: "Dixon-Coles",
      base: { logLoss: dcScore.logLoss, brier: dcScore.brier, accuracy: dcScore.accuracy },
      withTed: { logLoss: dcTedScore.logLoss, brier: dcTedScore.brier, accuracy: dcTedScore.accuracy },
      delta: {
        logLoss: Math.round((dcTedScore.logLoss - dcScore.logLoss) * 1000) / 1000,
        brier: Math.round((dcTedScore.brier - dcScore.brier) * 10000) / 10000,
        accuracy: Math.round((dcTedScore.accuracy - dcScore.accuracy) * 10) / 10,
      },
    },
    {
      model: "ELO",
      base: { logLoss: eloScore.logLoss, brier: eloScore.brier, accuracy: eloScore.accuracy },
      withTed: { logLoss: eloTedScore.logLoss, brier: eloTedScore.brier, accuracy: eloTedScore.accuracy },
      delta: {
        logLoss: Math.round((eloTedScore.logLoss - eloScore.logLoss) * 1000) / 1000,
        brier: Math.round((eloTedScore.brier - eloScore.brier) * 10000) / 10000,
        accuracy: Math.round((eloTedScore.accuracy - eloScore.accuracy) * 10) / 10,
      },
    },
    {
      model: "Bayesian Poisson",
      base: { logLoss: bayesScore.logLoss, brier: bayesScore.brier, accuracy: bayesScore.accuracy },
      withTed: { logLoss: bayesTedScore.logLoss, brier: bayesTedScore.brier, accuracy: bayesTedScore.accuracy },
      delta: {
        logLoss: Math.round((bayesTedScore.logLoss - bayesScore.logLoss) * 1000) / 1000,
        brier: Math.round((bayesTedScore.brier - bayesScore.brier) * 10000) / 10000,
        accuracy: Math.round((bayesTedScore.accuracy - bayesScore.accuracy) * 10) / 10,
      },
    },
    {
      model: "Composite",
      base: { logLoss: compositeScore.logLoss, brier: compositeScore.brier, accuracy: compositeScore.accuracy },
      withTed: { logLoss: compositeTedScore.logLoss, brier: compositeTedScore.brier, accuracy: compositeTedScore.accuracy },
      delta: {
        logLoss: Math.round((compositeTedScore.logLoss - compositeScore.logLoss) * 1000) / 1000,
        brier: Math.round((compositeTedScore.brier - compositeScore.brier) * 10000) / 10000,
        accuracy: Math.round((compositeTedScore.accuracy - compositeScore.accuracy) * 10) / 10,
      },
    },
    // Market + Ted overlay (only if market data available)
    ...(marketScore && marketTedScore ? [{
      model: "Market",
      base: { logLoss: marketScore.logLoss, brier: marketScore.brier, accuracy: marketScore.accuracy },
      withTed: { logLoss: marketTedScore.logLoss, brier: marketTedScore.brier, accuracy: marketTedScore.accuracy },
      delta: {
        logLoss: Math.round((marketTedScore.logLoss - marketScore.logLoss) * 1000) / 1000,
        brier: Math.round((marketTedScore.brier - marketScore.brier) * 10000) / 10000,
        accuracy: Math.round((marketTedScore.accuracy - marketScore.accuracy) * 10) / 10,
      },
    }] : []),
  ];

  // Rank all variants (base + with-Ted) by Log Loss
  const ranking = [
    { model: "Composite", logLoss: compositeScore.logLoss, brier: compositeScore.brier, accuracy: compositeScore.accuracy },
    { model: "Composite + Ted", logLoss: compositeTedScore.logLoss, brier: compositeTedScore.brier, accuracy: compositeTedScore.accuracy },
    { model: "Dixon-Coles", logLoss: dcScore.logLoss, brier: dcScore.brier, accuracy: dcScore.accuracy },
    { model: "Dixon-Coles + Ted", logLoss: dcTedScore.logLoss, brier: dcTedScore.brier, accuracy: dcTedScore.accuracy },
    { model: "ELO", logLoss: eloScore.logLoss, brier: eloScore.brier, accuracy: eloScore.accuracy },
    { model: "ELO + Ted", logLoss: eloTedScore.logLoss, brier: eloTedScore.brier, accuracy: eloTedScore.accuracy },
    { model: "Bayesian Poisson", logLoss: bayesScore.logLoss, brier: bayesScore.brier, accuracy: bayesScore.accuracy },
    { model: "Bayesian + Ted", logLoss: bayesTedScore.logLoss, brier: bayesTedScore.brier, accuracy: bayesTedScore.accuracy },
    // Include Market and Market + Ted in ranking if available
    ...(marketScore ? [{ model: "Market (Closing Line)", logLoss: marketScore.logLoss, brier: marketScore.brier, accuracy: marketScore.accuracy }] : []),
    ...(marketTedScore ? [{ model: "Market + Ted", logLoss: marketTedScore.logLoss, brier: marketTedScore.brier, accuracy: marketTedScore.accuracy }] : []),
  ].sort((a, b) => a.logLoss - b.logLoss);

  const result: Record<string, unknown> = {
    league,
    season,
    matchesEvaluated: matchEvals.length,
    xgSource,
    matchesWithOdds: matchesWithMarket.length,
    models: {
      dixonColes: dcScore,
      elo: eloScore,
      bayesian: bayesScore,
      composite: compositeScore,
      ...(marketScore ? { market: marketScore } : {}),
    },
    clv,
    ted: tedScore,
    tedOverlay: tedOverlayComparison,
    ranking,
    gameLog: matchEvals,
    methodology: {
      approach: "Holdout out-of-sample (Mack 2019/2024)",
      training: methodologyTraining,
      testSet: methodologyTestSet,
      compositeWeights: "DC 50% + Bayesian 25% + ELO 25%",
      tedNote: "Ted Variance is a directional modifier (not a full 1X2 model) — scored on directional accuracy and bet hit rate, not Log Loss",
      marketNote: "Market model uses devigged Pinnacle closing odds (fallback: avg market odds) as a benchmark — the line to beat",
      clvNote: "CLV = model_prob - closing_prob on the winning outcome. Positive avg CLV means the model finds real edges vs the market.",
      metrics: {
        logLoss: "Primary — penalizes confident wrong predictions heavily (Mack #1)",
        brier: "Calibration quality — lower is better (Mack #2)",
        accuracy: "Classification rate — least important per Mack (#3)",
      },
      sampleSizeWarning: `${matchEvals.length} matches evaluated. Mack: 'We'd want hundreds if not thousands of games before reasonable conclusions.'`,
    },
  };

  if (seasonBreakdown) {
    result.seasonBreakdown = seasonBreakdown;
  }

  return result;
}

/**
 * Auto-save evaluation results to disk.
 */
function autoSaveResult(result: Record<string, unknown>, league: string, season: string) {
  try {
    const fs = require("fs");
    const path = require("path");
    const evalDir = path.join(process.cwd(), "data", "evaluations");
    if (!fs.existsSync(evalDir)) {
      fs.mkdirSync(evalDir, { recursive: true });
    }
    const evalFile = path.join(evalDir, `eval-${league}-${season}.json`);
    fs.writeFileSync(evalFile, JSON.stringify(result, null, 2));
    console.log(`[model-eval] Auto-saved to ${evalFile}`);
  } catch (saveErr) {
    console.error("[model-eval] Auto-save failed:", saveErr);
  }
}

export async function GET(request: NextRequest) {
  const league = (request.nextUrl.searchParams.get("league") || "serieA") as League;
  const season = request.nextUrl.searchParams.get("season") || "2025-26";
  const isMulti = season === "multi";

  const cacheKey = `${league}-${season}`;
  if (evalCache && evalCache.league === cacheKey && Date.now() - evalCache.ts < CACHE_TTL) {
    return NextResponse.json(evalCache.result);
  }

  try {
    // 1. Fetch match data — always fetch all available seasons
    const allSeasons = league === "serieA"
      ? ["2025-26", "2024-25", "2023-24", "2022-23"]
      : ["2025-26", "2024-25"];
    const allMatches = await fetchOpenFootballMatches(allSeasons, league);

    if (isMulti) {
      // ===== MULTI-SEASON EVALUATION =====
      // Walk-forward: for each test season, train on all prior seasons
      const testSeasons = ["2023-24", "2024-25", "2025-26"];

      const allMatchEvals: MatchEval[] = [];
      const seasonBreakdown: { season: string; matchesEvaluated: number; models: { dixonColes: ModelScore; elo: ModelScore; bayesian: ModelScore; composite: ModelScore; market?: ModelScore | null }; ted: TedScore }[] = [];
      const xgSources: string[] = [];

      for (const testSeason of testSeasons) {
        const understatYear = seasonToUnderstatYear(testSeason);
        const { matchEvals, xgSource } = await evaluateSingleSeasonEvals(
          allMatches,
          testSeason,
          league,
          understatYear
        );

        if (matchEvals.length === 0) continue;

        allMatchEvals.push(...matchEvals);
        xgSources.push(xgSource);

        // Per-season scoring for breakdown
        const dcScore = scoreModel(matchEvals, (m) => m.dixonColes, (m) => m.dcCorrect);
        const eloScore = scoreModel(matchEvals, (m) => m.elo, (m) => m.eloCorrect);
        const bayesScore = scoreModel(matchEvals, (m) => m.bayesian, (m) => m.bayesCorrect);
        const compositeScore = scoreModel(matchEvals, (m) => m.composite, (m) => m.compositeCorrect);
        const tedScore = scoreTed(matchEvals);

        // Per-season market score
        const seasonMatchesWithMarket = matchEvals.filter((m) => m.market != null);
        let seasonMarketScore: ModelScore | null = null;
        if (seasonMatchesWithMarket.length > 0) {
          seasonMarketScore = scoreModel(
            seasonMatchesWithMarket,
            (m) => m.market!,
            (m) => m.marketCorrect === true,
          );
        }

        seasonBreakdown.push({
          season: testSeason,
          matchesEvaluated: matchEvals.length,
          models: {
            dixonColes: dcScore,
            elo: eloScore,
            bayesian: bayesScore,
            composite: compositeScore,
            market: seasonMarketScore,
          },
          ted: tedScore,
        });
      }

      if (allMatchEvals.length === 0) {
        return NextResponse.json({ error: "No completed matches across any test season" }, { status: 404 });
      }

      const uniqueXgSources = [...new Set(xgSources)];
      const combinedXgSource = uniqueXgSources.join(", ");
      const evaluatedSeasons = seasonBreakdown.map((b) => b.season).join(", ");

      const result = buildResultFromEvals(
        allMatchEvals,
        league,
        "multi (2023-26)",
        combinedXgSource,
        "Walk-forward: for each test season, train on all prior seasons",
        `Combined: ${evaluatedSeasons}`,
        seasonBreakdown
      );

      evalCache = { league: cacheKey, result, ts: Date.now() };
      autoSaveResult(result, league, "multi");
      return NextResponse.json(result);
    } else {
      // ===== SINGLE-SEASON EVALUATION (existing behavior) =====
      const testMatches = allMatches.filter((m) => m.season === season);
      const training = allMatches.filter((m) => m.season !== season);

      if (testMatches.length === 0) {
        return NextResponse.json({ error: "No completed matches for this season" }, { status: 404 });
      }
      if (training.length < 80) {
        return NextResponse.json({ error: "Not enough training data" }, { status: 404 });
      }

      // 2. Fit all probability models on training data
      const dcParams = fitDixonColes(training);
      const eloRatings = calculateEloRatings(training);
      const eloMap = new Map(eloRatings.map((e) => [e.team, e.rating]));
      const bayesParams = fitBayesianPoisson(training);

      // 3. Fetch raw Understat xG history for walk-forward Ted Variance
      let rawXgHistory: UnderstatTeamHistory[] | null = null;
      let xgSource = "none";
      try {
        rawXgHistory = await fetchUnderstatRawHistory(league);
        xgSource = "understat-live (walk-forward)";
      } catch {
        xgSource = "unavailable";
      }
      // Build lookup map for fast access
      const xgByTeam = new Map<string, UnderstatTeamHistory>();
      if (rawXgHistory) {
        for (const t of rawXgHistory) xgByTeam.set(t.team, t);
      }

      // 3b. Fetch betting odds from football-data.co.uk
      let oddsData: MatchWithOdds[] = [];
      let oddsSource = "none";
      try {
        oddsData = await fetchMatchesWithOdds(season, league as "serieA" | "serieB");
        if (oddsData.length > 0) oddsSource = "football-data.co.uk";
      } catch {
        oddsSource = "unavailable";
      }

      // Build odds lookup map: key = "YYYY-MM-DD-HomeTeam-AwayTeam"
      const oddsLookup = new Map<string, MatchWithOdds>();
      for (const od of oddsData) {
        const key = `${od.date}-${od.homeTeam}-${od.awayTeam}`;
        oddsLookup.set(key, od);
      }

      // 4. Evaluate each match
      const sortedTest = [...testMatches].sort((a, b) => a.date.localeCompare(b.date));
      const matchEvals: MatchEval[] = [];

      for (const match of sortedTest) {
        // Skip promoted teams not in training data
        if (!(match.homeTeam in dcParams.attack) || !(match.awayTeam in dcParams.attack)) continue;
        if (!(match.homeTeam in bayesParams.attack) || !(match.awayTeam in bayesParams.attack)) continue;

        const actual: "H" | "D" | "A" =
          match.homeGoals > match.awayGoals ? "H" :
          match.homeGoals < match.awayGoals ? "A" : "D";

        // --- Dixon-Coles ---
        const grid = predictMatch(match.homeTeam, match.awayTeam, dcParams);
        const dcProbs = derive1X2(grid);

        // --- ELO ---
        const homeElo = eloMap.get(match.homeTeam) || 1500;
        const awayElo = eloMap.get(match.awayTeam) || 1500;
        const eloProbs = eloWinProbability(homeElo, awayElo);

        // --- Bayesian Poisson ---
        const bayesProbs = bayesPredict1X2(match.homeTeam, match.awayTeam, bayesParams);

        // --- Ted Variance (walk-forward: only use xG data from BEFORE this match) ---
        let tedResult: MatchEval["ted"] = null;
        let tedCorrect: boolean | null = null;
        if (rawXgHistory) {
          const homeHistory = xgByTeam.get(match.homeTeam);
          const awayHistory = xgByTeam.get(match.awayTeam);
          if (homeHistory && awayHistory) {
            // Only aggregate xG from matches played BEFORE this date (no look-ahead)
            const homeXg = aggregateXgBeforeDate(homeHistory, match.date, "h");
            const awayXg = aggregateXgBeforeDate(awayHistory, match.date, "a");
            if (homeXg && awayXg) {
              const homeV = calculateTeamVariance(homeXg);
              const awayV = calculateTeamVariance(awayXg);
              const assessment = assessMatch(homeV, awayV);
              tedResult = {
                edgeSide: assessment.edgeSide,
                hasBet: assessment.hasBet,
                grade: assessment.betGrade,
                confidence: assessment.confidence,
              };
              if (assessment.edgeSide !== "neutral") {
                tedCorrect =
                  (assessment.edgeSide === "home" && actual === "H") ||
                  (assessment.edgeSide === "away" && actual === "A");
              }
            }
          }
        }

        // --- Market (closing line from football-data.co.uk) ---
        let marketProbs: { home: number; draw: number; away: number } | undefined;
        let closingOddsRaw: { home: number; draw: number; away: number } | undefined;
        const oddsKey = `${match.date}-${match.homeTeam}-${match.awayTeam}`;
        const oddsMatch = oddsLookup.get(oddsKey);
        if (oddsMatch) {
          // Prefer Pinnacle (sharpest), fall back to market average
          const hOdds = oddsMatch.pinnacleHome || oddsMatch.avgHome;
          const dOdds = oddsMatch.pinnacleDraw || oddsMatch.avgDraw;
          const aOdds = oddsMatch.pinnacleAway || oddsMatch.avgAway;
          closingOddsRaw = { home: hOdds, draw: dOdds, away: aOdds };
          const devigged = devigClosingLine(hOdds, dOdds, aOdds);
          if (devigged) {
            marketProbs = devigged;
          }
        }

        // --- Composite (DC 50% + Bayes 25% + ELO 25%) ---
        const compHome = 0.50 * dcProbs.home + 0.25 * bayesProbs.home + 0.25 * eloProbs.home;
        const compDraw = 0.50 * dcProbs.draw + 0.25 * bayesProbs.draw + 0.25 * eloProbs.draw;
        const compAway = 0.50 * dcProbs.away + 0.25 * bayesProbs.away + 0.25 * eloProbs.away;
        const compTotal = compHome + compDraw + compAway;
        const compositeProbs = {
          home: compHome / compTotal,
          draw: compDraw / compTotal,
          away: compAway / compTotal,
        };

        matchEvals.push({
          date: match.date,
          round: match.round,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          homeGoals: match.homeGoals,
          awayGoals: match.awayGoals,
          actualResult: actual,
          dixonColes: { home: r4(dcProbs.home), draw: r4(dcProbs.draw), away: r4(dcProbs.away) },
          elo: { home: r4(eloProbs.home), draw: r4(eloProbs.draw), away: r4(eloProbs.away) },
          bayesian: { home: r4(bayesProbs.home), draw: r4(bayesProbs.draw), away: r4(bayesProbs.away) },
          composite: { home: r4(compositeProbs.home), draw: r4(compositeProbs.draw), away: r4(compositeProbs.away) },
          market: marketProbs ? { home: r4(marketProbs.home), draw: r4(marketProbs.draw), away: r4(marketProbs.away) } : undefined,
          marketCorrect: marketProbs ? predictedResult(marketProbs) === actual : undefined,
          closingOdds: closingOddsRaw,
          ted: tedResult,
          dcCorrect: predictedResult(dcProbs) === actual,
          eloCorrect: predictedResult(eloProbs) === actual,
          bayesCorrect: predictedResult(bayesProbs) === actual,
          compositeCorrect: predictedResult(compositeProbs) === actual,
          tedCorrect,
        });
      }

      if (matchEvals.length === 0) {
        return NextResponse.json({ error: "Not enough data to evaluate" }, { status: 404 });
      }

      const result = buildResultFromEvals(
        matchEvals,
        league,
        season,
        xgSource,
        `All completed matches from seasons before ${season}`,
        `All completed ${season} matches`
      );

      // Add oddsSource to single-season result
      result.oddsSource = oddsSource;

      evalCache = { league: cacheKey, result, ts: Date.now() };
      autoSaveResult(result, league, season);
      return NextResponse.json(result);
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Model eval error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
