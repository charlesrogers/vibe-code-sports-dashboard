import { NextResponse } from "next/server";
import { loadLedger } from "@/lib/paper-trade/storage";
import { computeStats } from "@/lib/paper-trade/stats";

export async function GET() {
  try {
    const ledger = await loadLedger();
    const stats = computeStats(ledger.bets);
    return NextResponse.json({ ledger: ledger.bets, stats, lastUpdated: ledger.lastUpdated });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
