import type { PaperBet, PaperTradeStats } from "./types";

export function computeStats(bets: PaperBet[]): PaperTradeStats {
  // Exclude superseded bets — they were replaced by better-odds versions
  const activeBets = bets.filter(b => b.status !== "superseded");
  const settled = activeBets.filter(b => b.status !== "pending");
  const pending = activeBets.filter(b => b.status === "pending");
  const wins = settled.filter(b => b.status === "won");
  const losses = settled.filter(b => b.status === "lost");
  const pushes = settled.filter(b => b.status === "push");

  const totalProfit = settled.reduce((s, b) => s + (b.profit || 0), 0);
  const totalStaked = settled.length;

  // By league
  const byLeague: Record<string, { n: number; roi: number; clv: number; profit: number }> = {};
  for (const b of settled) {
    if (!byLeague[b.league]) byLeague[b.league] = { n: 0, roi: 0, clv: 0, profit: 0 };
    byLeague[b.league].n++;
    byLeague[b.league].profit += b.profit || 0;
  }
  for (const [, v] of Object.entries(byLeague)) {
    v.roi = v.n > 0 ? v.profit / v.n : 0;
    const leagueBets = settled.filter(b => b.league === Object.keys(byLeague).find(k => byLeague[k] === v));
    v.clv = leagueBets.length > 0 ? leagueBets.reduce((s, b) => s + (b.clv || 0), 0) / leagueBets.length : 0;
  }

  // By grade
  const byGrade: Record<string, { n: number; roi: number; clv: number; profit: number }> = {};
  for (const b of settled) {
    const g = b.confidenceGrade || "none";
    if (!byGrade[g]) byGrade[g] = { n: 0, roi: 0, clv: 0, profit: 0 };
    byGrade[g].n++;
    byGrade[g].profit += b.profit || 0;
  }
  for (const [g, v] of Object.entries(byGrade)) {
    v.roi = v.n > 0 ? v.profit / v.n : 0;
    const gradeBets = settled.filter(b => (b.confidenceGrade || "none") === g);
    v.clv = gradeBets.length > 0 ? gradeBets.reduce((s, b) => s + (b.clv || 0), 0) / gradeBets.length : 0;
  }

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
    dailyPnL,
  };
}
