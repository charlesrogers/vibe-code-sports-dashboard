export type BetStatus = "pending" | "won" | "lost" | "push" | "superseded";
export type MarketType = "1X2" | "AH" | "OU25";

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
