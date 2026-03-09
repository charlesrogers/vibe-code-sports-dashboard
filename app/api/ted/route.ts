import { NextRequest, NextResponse } from "next/server";
import { fetchTeamXgFromFotmob } from "@/lib/fotmob";
import { fetchUpcomingFixtures } from "@/lib/openfootball";
import {
  calculateAllVariance,
  calculateTeamVariance,
} from "@/lib/variance/calculator";
import { assessMatch } from "@/lib/variance/match-assessor";
import {
  loadVenueSplitXg,
  getVenueXgForFixture,
} from "@/lib/venue-split-xg";
import type { League } from "@/lib/openfootball";

export async function GET(request: NextRequest) {
  const league = (request.nextUrl.searchParams.get("league") ||
    "serieA") as League;

  try {
    // Load venue-split xG from Understat scrape cache
    const venueSplit = loadVenueSplitXg(league);

    // Fall back to Fotmob overall xG if no venue-split data
    const fotmobData = venueSplit
      ? []
      : await fetchTeamXgFromFotmob(league);

    const fixtures = await fetchUpcomingFixtures("2025-26", league);

    if (!venueSplit && fotmobData.length === 0) {
      return NextResponse.json(
        { error: "No xG data available" },
        { status: 503 }
      );
    }

    // When we have venue splits, calculate variance per team per venue
    // The overall team table still uses overall stats for display
    const overallXgData = venueSplit
      ? venueSplit.teams.map((t) => t.overall)
      : fotmobData;
    const teams = calculateAllVariance(overallXgData);

    // For match assessment: use venue-specific variance
    // Home team → their HOME xG stats
    // Away team → their AWAY xG stats
    // This is Ted's key principle: "never use overall season numbers"
    const assessments = fixtures
      .map((f) => {
        if (venueSplit) {
          // Venue-split mode (correct Ted approach)
          const { homeXg, awayXg } = getVenueXgForFixture(
            f.homeTeam,
            f.awayTeam,
            venueSplit.teams
          );
          if (!homeXg || !awayXg) return null;

          const homeV = calculateTeamVariance(homeXg);
          const awayV = calculateTeamVariance(awayXg);
          const assessment = assessMatch(homeV, awayV);
          return {
            ...assessment,
            round: f.round ?? null,
            date: f.date,
          };
        } else {
          // Fallback: overall variance (not ideal, but works without scrape)
          const varianceMap = new Map(teams.map((t) => [t.team, t]));
          const homeV = varianceMap.get(f.homeTeam);
          const awayV = varianceMap.get(f.awayTeam);
          if (!homeV || !awayV) return null;
          const assessment = assessMatch(homeV, awayV);
          return {
            ...assessment,
            round: f.round ?? null,
            date: f.date,
          };
        }
      })
      .filter(
        (a): a is NonNullable<typeof a> => a !== null
      );

    const bets = assessments.filter((a) => a.hasBet);

    // Organize by round
    const rounds = [
      ...new Set(
        assessments
          .map((a) => a.round)
          .filter((r): r is number => r !== null)
      ),
    ].sort((a, b) => a - b);

    return NextResponse.json({
      league,
      usingVenueSplits: !!venueSplit,
      scrapedAt: venueSplit?.scrapedAt ?? null,
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
