import { NextResponse } from "next/server";
import { loadLedger } from "@/lib/paper-trade/storage";
import { computeModelHealth } from "@/lib/model-health-monitor";

export async function GET() {
  try {
    const ledger = await loadLedger();
    const report = computeModelHealth(ledger.bets);
    return NextResponse.json(report, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
