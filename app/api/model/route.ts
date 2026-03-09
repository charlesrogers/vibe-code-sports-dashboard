import { NextRequest, NextResponse } from "next/server";
import { fetchOpenFootballMatches, type League } from "@/lib/openfootball";
import { fitDixonColes } from "@/lib/models/dixon-coles";
import { calculateEloRatings } from "@/lib/models/elo";
import { DixonColesParams, EloRating } from "@/lib/types";

// Cache per season+league
const cache = new Map<string, { params: DixonColesParams; elo: EloRating[]; time: number }>();
const CACHE_TTL = 3600000;

export async function GET(request: NextRequest) {
  const season = request.nextUrl.searchParams.get("season");
  const league = (request.nextUrl.searchParams.get("league") || "serieA") as League;

  try {
    const cacheKey = `${league}:${season || "all"}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return NextResponse.json({ params: cached.params, elo: cached.elo, season: season || "all", league });
    }

    const defaultSeasons = league === "serieB"
      ? ["2025-26", "2024-25"]
      : ["2025-26", "2024-25", "2023-24"];
    const seasons = season ? [season] : defaultSeasons;
    const matches = await fetchOpenFootballMatches(seasons, league);

    if (matches.length === 0) {
      return NextResponse.json({ error: "No match data available" }, { status: 500 });
    }

    const params = fitDixonColes(matches);
    const elo = calculateEloRatings(matches);
    cache.set(cacheKey, { params, elo, time: Date.now() });

    return NextResponse.json({ params, elo, season: season || "all", league, matchCount: matches.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
