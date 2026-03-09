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

    const teams = calculateAllVariance(xgData);
    const varianceMap = new Map(teams.map((t) => [t.team, t]));

    // Assess upcoming matches — include round + date from fixture
    const assessments = fixtures
      .map((f) => {
        const homeV = varianceMap.get(f.homeTeam);
        const awayV = varianceMap.get(f.awayTeam);
        if (!homeV || !awayV) return null;
        const assessment = assessMatch(homeV, awayV);
        return {
          ...assessment,
          round: f.round ?? null,
          date: f.date,
        };
      })
      .filter(
        (a): a is NonNullable<typeof a> => a !== null
      );

    const bets = assessments.filter((a) => a.hasBet);

    // Organize by round
    const rounds = [...new Set(assessments.map((a) => a.round).filter((r): r is number => r !== null))].sort((a, b) => a - b);

    return NextResponse.json({
      league,
      teams,
      assessments,
      bets,
      rounds,
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
