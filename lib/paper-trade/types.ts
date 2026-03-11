export type BetStatus = "pending" | "won" | "lost" | "push" | "superseded";
export type MarketType = "1X2" | "AH" | "OU25";

/** Paper trading configuration */
export const PAPER_CONFIG = {
  bankroll: 1000,         // $1000 starting capital
  kellyFraction: 0.25,    // quarter Kelly
  maxStakePct: 0.05,      // max 5% of bankroll per bet
  minStake: 5,            // floor: $5 minimum
  slippage: 0.01,         // 1% odds degradation (line moves against you)
} as const;

/** Quarter Kelly stake sizing: stake = bankroll × min(kelly, maxPct) × fraction */
export function kellyStake(
  modelProb: number,
  odds: number,
  bankroll: number = PAPER_CONFIG.bankroll,
): number {
  const b = odds - 1; // net odds
  const q = 1 - modelProb;
  const kelly = Math.max(0, (b * modelProb - q) / b);
  const capped = Math.min(kelly, PAPER_CONFIG.maxStakePct);
  const stake = bankroll * capped * PAPER_CONFIG.kellyFraction;
  return Math.max(PAPER_CONFIG.minStake, Math.round(stake * 100) / 100);
}

export interface PaperBet {
  id: string;
  createdAt: string;
  matchDate: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  marketType: MarketType;
  selection: string;
  ahLine?: number;
  stake: number;
  modelProb: number;
  marketOdds: number;
  executionOdds: number;  // marketOdds after slippage — what you actually got
  edge: number;
  confidenceGrade: "A" | "B" | "C" | null;
  oddsTimestamp?: string;
  evalWindow?: number;
  status: BetStatus;
  settledAt?: string;
  homeGoals?: number;
  awayGoals?: number;
  profit?: number;
  closingOdds?: number;
  clv?: number;
}

export interface PaperTradeLedger {
  version: 1;
  lastUpdated: string;
  bets: PaperBet[];
}

export interface PaperTradeStats {
  totalBets: number;
  settledBets: number;
  pendingBets: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  totalProfit: number;
  roi: number;
  avgEdge: number;
  avgCLV: number;
  byLeague: Record<string, { n: number; roi: number; clv: number; profit: number }>;
  byGrade: Record<string, { n: number; roi: number; clv: number; profit: number }>;
  dailyPnL: { date: string; profit: number; cumProfit: number; bets: number }[];
}
