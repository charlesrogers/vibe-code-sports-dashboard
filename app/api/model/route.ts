import { NextResponse } from "next/server";
import { fetchOpenFootballMatches } from "@/lib/openfootball";
import { fitDixonColes } from "@/lib/models/dixon-coles";
import { calculateEloRatings } from "@/lib/models/elo";
import { DixonColesParams, EloRating } from "@/lib/types";

// Cache model params in memory
let cachedParams: DixonColesParams | null = null;
let cachedElo: EloRating[] | null = null;
let lastFit: number = 0;
const CACHE_TTL = 3600000; // 1 hour

export async function GET() {
  try {
    const now = Date.now();

    if (cachedParams && cachedElo && now - lastFit < CACHE_TTL) {
      return NextResponse.json({ params: cachedParams, elo: cachedElo });
    }

    const matches = await fetchOpenFootballMatches();

    if (matches.length === 0) {
      return NextResponse.json({ error: "No match data available" }, { status: 500 });
    }

    cachedParams = fitDixonColes(matches);
    cachedElo = calculateEloRatings(matches);
    lastFit = now;

    return NextResponse.json({ params: cachedParams, elo: cachedElo });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
