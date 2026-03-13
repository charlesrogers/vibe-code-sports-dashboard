import type { PaperBet, PaperTradeStats, DriftIndicators, RollingWindow, DriftAlert } from "./types";

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

function buildSignalBreakdown(
  settled: PaperBet[],
): Record<string, { n: number; roi: number; clv: number; profit: number; staked: number; hitRate: number }> {
  const groups: Record<string, { n: number; wins: number; profit: number; staked: number; clvSum: number; clvCount: number }> = {};

  for (const b of settled) {
    const signals = b.activeSignals ?? ["untagged"];
    for (const sig of signals) {
      if (!groups[sig]) groups[sig] = { n: 0, wins: 0, profit: 0, staked: 0, clvSum: 0, clvCount: 0 };
      const g = groups[sig];
      g.n++;
      if (b.status === "won") g.wins++;
      g.profit += b.profit || 0;
      g.staked += b.stake || 20;
      if (b.clv != null) { g.clvSum += b.clv; g.clvCount++; }
    }
  }

  const result: Record<string, { n: number; roi: number; clv: number; profit: number; staked: number; hitRate: number }> = {};
  for (const [k, g] of Object.entries(groups)) {
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

  // Signal breakdown — one bet can appear in multiple signal groups
  const bySignal = buildSignalBreakdown(settled);

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

  // Drift indicators
  const driftIndicators = computeDriftIndicators(settled);

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
    bySignal,
    dailyPnL,
    driftIndicators,
  };
}

function computeRollingWindow(settled: PaperBet[], windowSize: number): RollingWindow | null {
  if (settled.length < windowSize) return null;
  const window = settled.slice(-windowSize);
  const wins = window.filter(b => b.status === "won").length;
  const losses = window.filter(b => b.status === "lost").length;
  const decided = wins + losses;
  const profit = window.reduce((s, b) => s + (b.profit || 0), 0);
  const staked = window.reduce((s, b) => s + (b.stake || 20), 0);
  const withCLV = window.filter(b => b.clv != null);
  const avgCLV = withCLV.length > 0
    ? withCLV.reduce((s, b) => s + (b.clv || 0), 0) / withCLV.length * 100
    : 0;

  return {
    n: windowSize,
    hitRate: decided > 0 ? Math.round((wins / decided) * 10000) / 100 : 0,
    roi: staked > 0 ? Math.round((profit / staked) * 10000) / 100 : 0,
    avgCLV: Math.round(avgCLV * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    oldestDate: window[0].matchDate,
    newestDate: window[window.length - 1].matchDate,
  };
}

function computeDriftIndicators(settled: PaperBet[]): DriftIndicators {
  // Sort by matchDate then settledAt for consistent ordering
  const sorted = [...settled].sort((a, b) =>
    a.matchDate.localeCompare(b.matchDate) || (a.settledAt || "").localeCompare(b.settledAt || "")
  );

  const rolling30 = computeRollingWindow(sorted, 30);
  const rolling50 = computeRollingWindow(sorted, 50);

  const alerts: DriftAlert[] = [];

  // Check rolling 30 for alerts
  if (rolling30) {
    if (rolling30.avgCLV < 0) {
      alerts.push({
        type: "clv_negative",
        severity: rolling30.avgCLV < -2 ? "critical" : "warning",
        message: `Rolling 30-bet CLV is ${rolling30.avgCLV > 0 ? "+" : ""}${rolling30.avgCLV.toFixed(1)}% — ${rolling30.avgCLV < -2 ? "model may be miscalibrated" : "monitor closely"}`,
      });
    }
    if (rolling30.roi < -10) {
      alerts.push({
        type: "roi_negative",
        severity: "critical",
        message: `Rolling 30-bet ROI is ${rolling30.roi.toFixed(1)}% — significant drawdown`,
      });
    } else if (rolling30.roi < 0) {
      alerts.push({
        type: "roi_negative",
        severity: "warning",
        message: `Rolling 30-bet ROI is ${rolling30.roi.toFixed(1)}% — in drawdown`,
      });
    }
    if (rolling30.hitRate < 40) {
      alerts.push({
        type: "hit_rate_low",
        severity: rolling30.hitRate < 35 ? "critical" : "warning",
        message: `Rolling 30-bet hit rate is ${rolling30.hitRate.toFixed(0)}% — below expected range`,
      });
    }
  }

  // CLV trend: compare first half vs second half of rolling 50
  if (rolling50 && sorted.length >= 50) {
    const firstHalf = sorted.slice(-50, -25);
    const secondHalf = sorted.slice(-25);
    const firstCLV = firstHalf.filter(b => b.clv != null);
    const secondCLV = secondHalf.filter(b => b.clv != null);
    if (firstCLV.length >= 10 && secondCLV.length >= 10) {
      const avgFirst = firstCLV.reduce((s, b) => s + (b.clv || 0), 0) / firstCLV.length;
      const avgSecond = secondCLV.reduce((s, b) => s + (b.clv || 0), 0) / secondCLV.length;
      if (avgSecond < avgFirst - 0.02) { // CLV dropped by 2pp+
        alerts.push({
          type: "clv_declining",
          severity: avgSecond < 0 ? "critical" : "warning",
          message: `CLV declining: ${(avgFirst * 100).toFixed(1)}% → ${(avgSecond * 100).toFixed(1)}% (first 25 vs last 25 of rolling 50)`,
        });
      }
    }
  }

  return { rolling30, rolling50, alerts };
}
