import { NextRequest, NextResponse } from "next/server";
import { fetchMatchesWithOdds, getAvailableSeasons, type League } from "@/lib/football-data-uk";

export async function GET(request: NextRequest) {
  const season = request.nextUrl.searchParams.get("season") || "2025-26";
  const league = (request.nextUrl.searchParams.get("league") || "serieA") as League;

  try {
    const matches = await fetchMatchesWithOdds(season, league);
    return NextResponse.json({
      season,
      league,
      availableSeasons: getAvailableSeasons(),
      matches,
      count: matches.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
