import { NextRequest, NextResponse } from "next/server";
import { generatePicks } from "@/lib/mi-picks/picks-engine";

export async function GET(request: NextRequest) {
  const leagueParam = request.nextUrl.searchParams.get("leagues");
  const leagues = leagueParam ? leagueParam.split(",") : undefined;

  try {
    const { picks, summary } = await generatePicks(leagues);
    return NextResponse.json({ picks, summary });
  } catch (e: any) {
    console.error("MI Picks API error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
