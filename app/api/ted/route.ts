import { NextRequest, NextResponse } from "next/server";
import { fetchTeamXgFromFotmob } from "@/lib/fotmob";
import { fetchUpcomingFixtures } from "@/lib/openfootball";
import { calculateAllVariance } from "@/lib/variance/calculator";
import { assessMatch } from "@/lib/variance/match-assessor";
import type { League } from "@/lib/openfootball";

export async function GET(request: NextRequest) {
  const league = (request.nextUrl.searchParams.get("league") ||
    "serieA") as League;

  try {
    // Fetch xG data and upcoming fixtures in parallel
    const [xgData, fixtures] = await Promise.all([
      fetchTeamXgFromFotmob(league),
      fetchUpcomingFixtures("2025-26", league),
    ]);

    if (xgData.length === 0) {
      return NextResponse.json(
        { error: "No xG data available" },
        { status: 503 }
      );
    }

    // Calculate variance for all teams
    const teams = calculateAllVariance(xgData);

    // Build variance lookup by team name
    const varianceMap = new Map(teams.map((t) => [t.team, t]));

    // Assess upcoming matches
    const assessments = fixtures
      .map((f) => {
        const homeV = varianceMap.get(f.homeTeam);
        const awayV = varianceMap.get(f.awayTeam);
        if (!homeV || !awayV) return null;
        return assessMatch(homeV, awayV);
      })
      .filter(
        (a): a is NonNullable<typeof a> => a !== null
      );

    const bets = assessments.filter((a) => a.hasBet);

    return NextResponse.json({
      league,
      teams,
      assessments,
      bets,
      summary: {
        teamsAnalyzed: teams.length,
        matchesAssessed: assessments.length,
        betsFound: bets.length,
        selectivity:
          assessments.length > 0
            ? Math.round((bets.length / assessments.length) * 100)
            : 0,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Ted API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
