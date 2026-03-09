import { NextRequest, NextResponse } from "next/server";
import { fetchMatchesWithOdds, getAvailableSeasons } from "@/lib/football-data-uk";

export async function GET(request: NextRequest) {
  const season = request.nextUrl.searchParams.get("season") || "2024-25";

  try {
    const matches = await fetchMatchesWithOdds(season);
    return NextResponse.json({
      season,
      availableSeasons: getAvailableSeasons(),
      matches,
      count: matches.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
