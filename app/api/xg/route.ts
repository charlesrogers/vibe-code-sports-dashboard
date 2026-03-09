import { NextRequest, NextResponse } from "next/server";
import { fetchTeamXgFromFotmob } from "@/lib/fotmob";
import { fetchTeamXg } from "@/lib/understat";

export async function GET(request: NextRequest) {
  const league = request.nextUrl.searchParams.get("league") || "serieA";

  // Try Fotmob first (reliable API), fall back to Understat (scraping)
  try {
    const xgData = await fetchTeamXgFromFotmob(league);
    if (xgData.length > 0) {
      return NextResponse.json(xgData);
    }
  } catch (e: any) {
    console.warn("Fotmob xG fetch failed:", e.message);
  }

  try {
    const xgData = await fetchTeamXg(2024);
    if (xgData.length > 0) {
      return NextResponse.json(xgData);
    }
  } catch (e: any) {
    console.warn("Understat xG fetch failed:", e.message);
  }

  return NextResponse.json(
    { error: "xG data unavailable from all sources" },
    { status: 503 }
  );
}
