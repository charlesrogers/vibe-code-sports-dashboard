import { NextRequest, NextResponse } from "next/server";
import { fetchTeamXgFromFotmob } from "@/lib/fotmob";
import { fetchUpcomingFixtures } from "@/lib/openfootball";
import {
  calculateAllVariance,
  calculateTeamVariance,
} from "@/lib/variance/calculator";
import { assessMatch } from "@/lib/variance/match-assessor";
import { fetchUnderstatCached } from "@/lib/understat";
import { loadVenueSplitXg, getVenueXgForFixture } from "@/lib/venue-split-xg";
import type { VenueSplitXg } from "@/lib/understat";
import type { League } from "@/lib/openfootball";

export async function GET(request: NextRequest) {
  const league = (request.nextUrl.searchParams.get("league") ||
    "serieA") as League;

  try {
    // 1. Try live Understat API for venue-split xG (best source)
    let venueSplits: VenueSplitXg[] | null = null;
    let xgSource = "none";

    try {
      const result = await fetchUnderstatCached(league);
      venueSplits = result.venueSplits;
      xgSource = result.source;
    } catch (e) {
      console.warn("Understat cached fetch failed, trying legacy file cache:", e);
      const cached = loadVenueSplitXg(league);
      if (cached) {
        venueSplits = cached.teams;
        xgSource = "legacy-file-cache";
      }
    }

    // 3. Fall back to Fotmob overall xG (no venue splits)
    const fotmobData =
      venueSplits && venueSplits.length > 0
        ? []
        : await fetchTeamXgFromFotmob(league);

    if ((!venueSplits || venueSplits.length === 0) && fotmobData.length === 0) {
      xgSource = "fotmob";
    }

    const fixtures = await fetchUpcomingFixtures("2025-26", league);

    if (
      (!venueSplits || venueSplits.length === 0) &&
      fotmobData.length === 0
    ) {
      return NextResponse.json(
        { error: "No xG data available from any source" },
        { status: 503 }
      );
    }

    const hasVenueSplits = venueSplits !== null && venueSplits.length > 0;

    // Overall team table uses overall stats for display
    const overallXgData = hasVenueSplits
      ? venueSplits!.map((t) => t.overall)
      : fotmobData;
    const teams = calculateAllVariance(overallXgData);

    // Match assessment: venue-specific variance when available
    const assessments = fixtures
      .map((f) => {
        if (hasVenueSplits) {
          const { homeXg, awayXg } = getVenueXgForFixture(
            f.homeTeam,
            f.awayTeam,
            venueSplits!
          );
          if (!homeXg || !awayXg) return null;

          const homeV = calculateTeamVariance(homeXg);
          const awayV = calculateTeamVariance(awayXg);
          const assessment = assessMatch(homeV, awayV);
          return { ...assessment, round: f.round ?? null, date: f.date };
        } else {
          const varianceMap = new Map(teams.map((t) => [t.team, t]));
          const homeV = varianceMap.get(f.homeTeam);
          const awayV = varianceMap.get(f.awayTeam);
          if (!homeV || !awayV) return null;
          const assessment = assessMatch(homeV, awayV);
          return { ...assessment, round: f.round ?? null, date: f.date };
        }
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    const bets = assessments.filter((a) => a.hasBet);

    const rounds = [
      ...new Set(
        assessments
          .map((a) => a.round)
          .filter((r): r is number => r !== null)
      ),
    ].sort((a, b) => a - b);

    return NextResponse.json({
      league,
      usingVenueSplits: hasVenueSplits,
      xgSource,
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
