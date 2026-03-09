import { NextRequest, NextResponse } from "next/server";
import { fetchTeamXgFromFotmob } from "@/lib/fotmob";
import { fetchTeamXg } from "@/lib/understat";
import { cacheXgSnapshot, loadCachedXg } from "@/lib/xg-cache";

export async function GET(request: NextRequest) {
  const league = request.nextUrl.searchParams.get("league") || "serieA";

  // Try Fotmob first (reliable API), fall back to Understat (scraping)
  try {
    const xgData = await fetchTeamXgFromFotmob(league);
    if (xgData.length > 0) {
      // Cache the fresh data in the background — don't block the response
      cacheXgSnapshot(league, xgData, "fotmob").catch((err) =>
        console.warn("xG cache write failed:", err)
      );
      return NextResponse.json(xgData);
    }
  } catch (e: any) {
    console.warn("Fotmob xG fetch failed:", e.message);
  }

  try {
    const xgData = await fetchTeamXg(2024);
    if (xgData.length > 0) {
      cacheXgSnapshot(league, xgData, "understat").catch((err) =>
        console.warn("xG cache write failed:", err)
      );
      return NextResponse.json(xgData);
    }
  } catch (e: any) {
    console.warn("Understat xG fetch failed:", e.message);
  }

  // Both live sources failed — try loading from cache as final fallback
  try {
    const cached = await loadCachedXg(league);
    if (cached && cached.teams.length > 0) {
      console.log(
        `Serving cached xG for ${league} from ${cached.timestamp} (source: ${cached.source})`
      );
      return NextResponse.json(cached.teams);
    }
  } catch (e: any) {
    console.warn("xG cache read failed:", e.message);
  }

  return NextResponse.json(
    { error: "xG data unavailable from all sources" },
    { status: 503 }
  );
}
