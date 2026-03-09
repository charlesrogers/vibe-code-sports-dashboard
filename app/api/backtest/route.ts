import { NextRequest, NextResponse } from "next/server";
import { fetchOpenFootballMatches, type League } from "@/lib/openfootball";
import { fetchMatchesWithOdds, type League as UKLeague } from "@/lib/football-data-uk";
import { walkForwardBacktest, type WalkForwardResult } from "@/lib/backtest/walk-forward";
import { type ModelWeights, DEFAULT_WEIGHTS } from "@/lib/models/composite";

// Cache results (expensive computation)
const cache = new Map<string, { result: WalkForwardResult; time: number }>();
const CACHE_TTL = 3600000;

export async function GET(request: NextRequest) {
  const season = request.nextUrl.searchParams.get("season") || "2025-26";
  const league = (request.nextUrl.searchParams.get("league") || "serieA") as League;
  const minEdge = parseFloat(request.nextUrl.searchParams.get("minEdge") || "0.03");

  // Custom weights
  const dcWeight = parseFloat(request.nextUrl.searchParams.get("dc") || "0.45");
  const eloWeight = parseFloat(request.nextUrl.searchParams.get("elo") || "0.20");
  const mktWeight = parseFloat(request.nextUrl.searchParams.get("mkt") || "0.35");
  const total = dcWeight + eloWeight + mktWeight;
  const weights: ModelWeights = {
    dixonColes: dcWeight / total,
    elo: eloWeight / total,
    market: mktWeight / total,
  };

  const cacheKey = `${league}:${season}:${minEdge}:${dcWeight}:${eloWeight}:${mktWeight}`;

  try {
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.time < CACHE_TTL) {
      return NextResponse.json({ ...cached.result, league, season, weights });
    }

    // Get training data: current season + prior seasons
    const priorSeasons: Record<string, string[]> = {
      "2025-26": ["2025-26", "2024-25", "2023-24"],
      "2024-25": ["2024-25", "2023-24", "2022-23"],
      "2023-24": ["2023-24", "2022-23", "2021-22"],
      "2022-23": ["2022-23", "2021-22", "2020-21"],
    };
    const trainSeasons = priorSeasons[season] || [season];

    // For Serie B, openfootball only has 2024-25+
    const ofSeasons = league === "serieB"
      ? trainSeasons.filter((s) => s >= "2024-25")
      : trainSeasons;

    const [allMatches, oddsMatches] = await Promise.all([
      fetchOpenFootballMatches(ofSeasons, league),
      fetchMatchesWithOdds(season, league as UKLeague),
    ]);

    if (oddsMatches.length === 0) {
      return NextResponse.json({ error: "No odds data for this season" }, { status: 400 });
    }

    const result = walkForwardBacktest(allMatches, oddsMatches, weights, 50, minEdge);

    cache.set(cacheKey, { result, time: Date.now() });

    return NextResponse.json({
      ...result,
      league,
      season,
      weights,
      trainingMatches: allMatches.length,
      testMatches: oddsMatches.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
