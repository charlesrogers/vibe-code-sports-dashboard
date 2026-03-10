/**
 * MI Model Value Detector — finds edges between model fair prices and market prices
 *
 * Compares MatchPrediction probabilities against current market odds to identify
 * value bets across 1X2, Over/Under, and Asian Handicap markets.
 */

import type { MatchPrediction, ValueBet, MarketMatch } from "./types";

export interface MarketOdds {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  date?: string;
  // 1X2 (devigged probabilities)
  home1X2?: number;
  draw1X2?: number;
  away1X2?: number;
  // Over/Under 2.5 (devigged probabilities)
  over25?: number;
  under25?: number;
  // Asian Handicap
  ahLine?: number;
  ahHome?: number;
  ahAway?: number;
}

export interface ValueDetectorConfig {
  /** Minimum edge to flag as value (default 0.03 = 3%) */
  minEdge: number;
  /** Markets to scan (default: all) */
  markets: ("1x2" | "over_under" | "asian_handicap")[];
  /** Minimum model probability to consider (avoids tiny-prob noise) */
  minModelProb: number;
}

export const DEFAULT_VALUE_CONFIG: ValueDetectorConfig = {
  minEdge: 0.03,
  markets: ["1x2", "over_under", "asian_handicap"],
  minModelProb: 0.05,
};

/**
 * Detect value bets for a single match by comparing model vs market.
 */
export function detectValue(
  prediction: MatchPrediction,
  market: MarketOdds,
  config: ValueDetectorConfig = DEFAULT_VALUE_CONFIG
): ValueBet[] {
  const bets: ValueBet[] = [];

  // 1X2 markets
  if (config.markets.includes("1x2") && market.home1X2 && market.draw1X2 && market.away1X2) {
    const selections = [
      { selection: "home", modelProb: prediction.probs1X2.home, marketProb: market.home1X2 },
      { selection: "draw", modelProb: prediction.probs1X2.draw, marketProb: market.draw1X2 },
      { selection: "away", modelProb: prediction.probs1X2.away, marketProb: market.away1X2 },
    ];

    for (const s of selections) {
      if (s.modelProb < config.minModelProb) continue;
      const edge = s.modelProb - s.marketProb;
      if (edge >= config.minEdge) {
        bets.push({
          matchId: market.matchId,
          homeTeam: prediction.homeTeam,
          awayTeam: prediction.awayTeam,
          selection: s.selection,
          modelProb: round(s.modelProb),
          marketProb: round(s.marketProb),
          edge: round(edge),
          varianceAgreement: null,
          combinedSignal: null,
        });
      }
    }
  }

  // Over/Under 2.5
  if (config.markets.includes("over_under") && market.over25 && market.under25) {
    const ou = prediction.overUnder["2.5"];
    if (ou) {
      const ouSelections = [
        { selection: "over2.5", modelProb: ou.over, marketProb: market.over25 },
        { selection: "under2.5", modelProb: ou.under, marketProb: market.under25 },
      ];
      for (const s of ouSelections) {
        if (s.modelProb < config.minModelProb) continue;
        const edge = s.modelProb - s.marketProb;
        if (edge >= config.minEdge) {
          bets.push({
            matchId: market.matchId,
            homeTeam: prediction.homeTeam,
            awayTeam: prediction.awayTeam,
            selection: s.selection,
            modelProb: round(s.modelProb),
            marketProb: round(s.marketProb),
            edge: round(edge),
            varianceAgreement: null,
            combinedSignal: null,
          });
        }
      }
    }
  }

  // Asian Handicap
  if (config.markets.includes("asian_handicap") && market.ahLine != null && market.ahHome && market.ahAway) {
    const lineKey = String(market.ahLine);
    const ah = prediction.asianHandicap[lineKey];
    if (ah) {
      const ahSelections = [
        { selection: `ah_home_${lineKey}`, modelProb: ah.home, marketProb: market.ahHome },
        { selection: `ah_away_${lineKey}`, modelProb: ah.away, marketProb: market.ahAway },
      ];
      for (const s of ahSelections) {
        if (s.modelProb < config.minModelProb) continue;
        const edge = s.modelProb - s.marketProb;
        if (edge >= config.minEdge) {
          bets.push({
            matchId: market.matchId,
            homeTeam: prediction.homeTeam,
            awayTeam: prediction.awayTeam,
            selection: s.selection,
            modelProb: round(s.modelProb),
            marketProb: round(s.marketProb),
            edge: round(edge),
            varianceAgreement: null,
            combinedSignal: null,
          });
        }
      }
    }
  }

  // Sort by edge descending
  bets.sort((a, b) => b.edge - a.edge);
  return bets;
}

/**
 * Detect value across multiple matches.
 */
export function detectValueBatch(
  predictions: MatchPrediction[],
  markets: MarketOdds[],
  config: ValueDetectorConfig = DEFAULT_VALUE_CONFIG
): ValueBet[] {
  const marketMap = new Map<string, MarketOdds>();
  for (const m of markets) {
    marketMap.set(m.matchId, m);
    // Also index by team pair for flexible matching
    marketMap.set(`${m.homeTeam}|${m.awayTeam}`, m);
  }

  const allBets: ValueBet[] = [];
  for (const pred of predictions) {
    const key = `${pred.homeTeam}|${pred.awayTeam}`;
    const market = marketMap.get(key);
    if (!market) continue;
    const bets = detectValue(pred, market, config);
    allBets.push(...bets);
  }

  allBets.sort((a, b) => b.edge - a.edge);
  return allBets;
}

/**
 * Convert a MarketMatch (from data-prep) to MarketOdds (for value detection).
 * Useful for backtesting: the market odds ARE the market.
 */
export function marketMatchToMarketOdds(m: MarketMatch): MarketOdds {
  return {
    matchId: m.id,
    homeTeam: m.homeTeam,
    awayTeam: m.awayTeam,
    date: m.date,
    home1X2: m.marketProbs.home,
    draw1X2: m.marketProbs.draw,
    away1X2: m.marketProbs.away,
    ahLine: m.ahLine ?? undefined,
    ahHome: m.ahHomeProb ?? undefined,
    ahAway: m.ahHomeProb != null ? 1 - m.ahHomeProb : undefined,
  };
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
