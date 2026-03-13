import { NextRequest, NextResponse } from "next/server";
import { appendBets } from "@/lib/paper-trade/storage";
import type { PaperBet } from "@/lib/paper-trade/types";
import { PAPER_CONFIG } from "@/lib/paper-trade/types";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      homeTeam, awayTeam, league, matchDate,
      marketType, selection, ahLine,
      odds, modelProb, edge, grade, bestBook, bestBookOdds,
    } = body;

    if (!homeTeam || !awayTeam || !marketType || !selection || !odds) {
      return NextResponse.json(
        { error: "Required: homeTeam, awayTeam, marketType, selection, odds" },
        { status: 400 }
      );
    }

    const now = new Date();
    const hour = now.getUTCHours();
    const dateStr = matchDate || now.toISOString().slice(0, 10);
    const id = `${dateStr}_${homeTeam}_vs_${awayTeam}_${marketType}_${selection}_T${hour}`.replace(/\s+/g, "_");

    const executionOdds = Math.round(odds * (1 - PAPER_CONFIG.slippage) * 100) / 100;

    const bet: PaperBet = {
      id,
      createdAt: now.toISOString(),
      matchDate: dateStr,
      league: league || "unknown",
      homeTeam,
      awayTeam,
      marketType,
      selection,
      ahLine: ahLine ?? undefined,
      stake: PAPER_CONFIG.unitSize,
      modelProb: modelProb || 0,
      marketOdds: odds,
      executionOdds,
      edge: edge || 0,
      confidenceGrade: grade || null,
      bestBook: bestBook ?? undefined,
      bestBookOdds: bestBookOdds ?? undefined,
      oddsTimestamp: now.toISOString(),
      evalWindow: hour,
      status: "pending",
    };

    const result = await appendBets([bet]);
    return NextResponse.json({ ...result, bet: { id: bet.id, matchDate: bet.matchDate } });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
