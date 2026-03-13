import { NextResponse } from "next/server";
import { loadLedger } from "@/lib/paper-trade/storage";
import type { PaperBet } from "@/lib/paper-trade/types";

interface SignalScore {
  signal: string;
  n: number;
  clvMean: number;
  roi: number;
  hitRate: number;
  profit: number;
  staked: number;
  last10CLV: number[];
  trend: "up" | "down" | "flat";
}

function computeSignalScorecard(bets: PaperBet[]): SignalScore[] {
  const settled = bets.filter(b => b.status !== "pending" && b.status !== "superseded");

  const groups: Record<string, PaperBet[]> = {};
  for (const b of settled) {
    const signals = b.activeSignals ?? ["untagged"];
    for (const sig of signals) {
      if (!groups[sig]) groups[sig] = [];
      groups[sig].push(b);
    }
  }

  const scorecard: SignalScore[] = [];
  for (const [signal, sigBets] of Object.entries(groups)) {
    const wins = sigBets.filter(b => b.status === "won").length;
    const profit = sigBets.reduce((s, b) => s + (b.profit || 0), 0);
    const staked = sigBets.reduce((s, b) => s + (b.stake || 20), 0);
    const withCLV = sigBets.filter(b => b.clv != null);
    const clvMean = withCLV.length > 0
      ? withCLV.reduce((s, b) => s + (b.clv || 0), 0) / withCLV.length
      : 0;

    // Last 10 CLV values for trend
    const last10 = withCLV
      .sort((a, b) => (a.settledAt || a.matchDate).localeCompare(b.settledAt || b.matchDate))
      .slice(-10)
      .map(b => b.clv || 0);

    // Trend: compare first half vs second half of last 10
    let trend: "up" | "down" | "flat" = "flat";
    if (last10.length >= 6) {
      const mid = Math.floor(last10.length / 2);
      const firstHalf = last10.slice(0, mid).reduce((s, v) => s + v, 0) / mid;
      const secondHalf = last10.slice(mid).reduce((s, v) => s + v, 0) / (last10.length - mid);
      if (secondHalf > firstHalf + 0.005) trend = "up";
      else if (secondHalf < firstHalf - 0.005) trend = "down";
    }

    scorecard.push({
      signal,
      n: sigBets.length,
      clvMean: Math.round(clvMean * 10000) / 100,
      roi: staked > 0 ? Math.round((profit / staked) * 10000) / 100 : 0,
      hitRate: sigBets.length > 0 ? Math.round((wins / sigBets.length) * 10000) / 100 : 0,
      profit: Math.round(profit * 100) / 100,
      staked: Math.round(staked * 100) / 100,
      last10CLV: last10.map(v => Math.round(v * 10000) / 100),
      trend,
    });
  }

  // Sort by CLV contribution (highest first)
  scorecard.sort((a, b) => b.clvMean - a.clvMean);
  return scorecard;
}

export async function GET() {
  try {
    const ledger = await loadLedger();
    const scorecard = computeSignalScorecard(ledger.bets);
    return NextResponse.json({
      scorecard,
      totalSettled: ledger.bets.filter(b => b.status !== "pending" && b.status !== "superseded").length,
      totalTagged: ledger.bets.filter(b => b.activeSignals && b.activeSignals.length > 0).length,
      generatedAt: new Date().toISOString(),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
