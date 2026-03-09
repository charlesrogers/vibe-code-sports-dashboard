import { NextRequest, NextResponse } from "next/server";
import { collectAndSaveOdds, checkApiStatus } from "@/lib/odds-collector/the-odds-api";

// GET: Check API status
// POST: Trigger odds collection (call on a cron or manually)
// Automation: Vercel Cron, cron-job.org (free), or manual curl -X POST
export async function GET() {
  try {
    const status = await checkApiStatus();
    return NextResponse.json({
      status: status.hasKey ? "configured" : "no_api_key",
      ...status,
      setup: !status.hasKey
        ? "Get a free API key at https://the-odds-api.com/ and add ODDS_API_KEY to .env.local"
        : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const league = (request.nextUrl.searchParams.get("league") || "serieA") as "serieA" | "serieB";

  try {
    const result = await collectAndSaveOdds(league);
    return NextResponse.json({
      success: true,
      league,
      matchesCollected: result.saved,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
