import { NextRequest, NextResponse } from "next/server";
import { loadLedger, saveLedger } from "@/lib/paper-trade/storage";
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

// DELETE — reset the ledger (requires CRON_SECRET)
export async function DELETE(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  await saveLedger({ version: 1, lastUpdated: new Date().toISOString(), bets: [] });
  return NextResponse.json({ reset: true, timestamp: new Date().toISOString() });
}
