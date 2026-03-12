export type BetStatus = "pending" | "won" | "lost" | "push" | "superseded";
export type MarketType = "1X2" | "AH" | "OU25";

/** Paper trading configuration — flat staking per Ted's Variance Betting Playbook */
export const PAPER_CONFIG = {
  bankroll: 1000,      // $1000 starting capital
  unitSize: 20,        // $20 flat stake (2% of bankroll, 50 units)
  slippage: 0.01,      // 1% odds degradation (line moves against you)
  maxDaysOut: 6,       // only bet matches within 6 days (Ted's Tue→Sun window)
} as const;

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
  bestBook?: string;       // book offering best odds at time of logging
  bestBookOdds?: number;   // odds at that book (pre-slippage)
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
  byLeague: Record<string, { n: number; roi: number; clv: number; profit: number; staked: number; hitRate: number }>;
  byGrade: Record<string, { n: number; roi: number; clv: number; profit: number; staked: number; hitRate: number }>;
  byMarketType: Record<string, { n: number; roi: number; clv: number; profit: number; staked: number; hitRate: number }>;
  dailyPnL: { date: string; profit: number; cumProfit: number; bets: number }[];
}
