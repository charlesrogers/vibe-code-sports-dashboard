import type { PaperBet, PaperTradeStats } from "./types";

function buildBreakdown(
  settled: PaperBet[],
  keyFn: (b: PaperBet) => string,
): Record<string, { n: number; roi: number; clv: number; profit: number; staked: number; hitRate: number }> {
  const groups: Record<string, { n: number; wins: number; profit: number; staked: number; clvSum: number; clvCount: number }> = {};

  for (const b of settled) {
    const k = keyFn(b);
    if (!groups[k]) groups[k] = { n: 0, wins: 0, profit: 0, staked: 0, clvSum: 0, clvCount: 0 };
    const g = groups[k];
    g.n++;
    if (b.status === "won") g.wins++;
    g.profit += b.profit || 0;
    g.staked += b.stake || 20;
    if (b.clv != null) { g.clvSum += b.clv; g.clvCount++; }
  }

  const result: Record<string, { n: number; roi: number; clv: number; profit: number; staked: number; hitRate: number }> = {};
  for (const [k, g] of Object.entries(groups)) {
    const losses = g.n - g.wins; // approximate: pushes counted as non-wins
    result[k] = {
      n: g.n,
      roi: g.staked > 0 ? Math.round((g.profit / g.staked) * 10000) / 100 : 0,
      clv: g.clvCount > 0 ? Math.round((g.clvSum / g.clvCount) * 10000) / 100 : 0,
      profit: Math.round(g.profit * 100) / 100,
      staked: Math.round(g.staked * 100) / 100,
      hitRate: g.n > 0 ? Math.round((g.wins / g.n) * 10000) / 100 : 0,
    };
  }
  return result;
}

export function computeStats(bets: PaperBet[]): PaperTradeStats {
  // Exclude superseded bets — they were replaced by better-odds versions
  const activeBets = bets.filter(b => b.status !== "superseded");
  const settled = activeBets.filter(b => b.status !== "pending");
  const pending = activeBets.filter(b => b.status === "pending");
  const wins = settled.filter(b => b.status === "won");
  const losses = settled.filter(b => b.status === "lost");
  const pushes = settled.filter(b => b.status === "push");

  const totalProfit = settled.reduce((s, b) => s + (b.profit || 0), 0);
  const totalStaked = settled.reduce((s, b) => s + (b.stake || 20), 0);

  // Breakdowns
  const byLeague = buildBreakdown(settled, b => b.league);
  const byGrade = buildBreakdown(settled, b => b.confidenceGrade || "none");
  const byMarketType = buildBreakdown(settled, b => b.marketType);

  // Daily P&L
  const dailyMap = new Map<string, { profit: number; bets: number }>();
  for (const b of settled) {
    const date = b.matchDate;
    const day = dailyMap.get(date) || { profit: 0, bets: 0 };
    day.profit += b.profit || 0;
    day.bets++;
    dailyMap.set(date, day);
  }
  const sortedDates = [...dailyMap.keys()].sort();
  let cumProfit = 0;
  const dailyPnL = sortedDates.map(date => {
    const day = dailyMap.get(date)!;
    cumProfit += day.profit;
    return { date, profit: Math.round(day.profit * 100) / 100, cumProfit: Math.round(cumProfit * 100) / 100, bets: day.bets };
  });

  const settledWithCLV = settled.filter(b => b.clv != null);

  return {
    totalBets: activeBets.length,
    settledBets: settled.length,
    pendingBets: pending.length,
    wins: wins.length,
    losses: losses.length,
    pushes: pushes.length,
    hitRate: settled.length > 0 ? wins.length / (wins.length + losses.length) : 0,
    totalProfit: Math.round(totalProfit * 100) / 100,
    roi: totalStaked > 0 ? Math.round((totalProfit / totalStaked) * 10000) / 100 : 0,
    avgEdge: activeBets.length > 0 ? Math.round(activeBets.reduce((s, b) => s + b.edge, 0) / activeBets.length * 10000) / 100 : 0,
    avgCLV: settledWithCLV.length > 0
      ? Math.round(settledWithCLV.reduce((s, b) => s + (b.clv || 0), 0) / settledWithCLV.length * 10000) / 100
      : 0,
    byLeague,
    byGrade,
    byMarketType,
    dailyPnL,
  };
}
