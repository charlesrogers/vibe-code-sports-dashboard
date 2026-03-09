import { NextRequest, NextResponse } from "next/server";
import { loadSnapshots, buildMatchHistory, getCollectionStats } from "@/lib/odds-collector/store";
import { checkApiStatus } from "@/lib/odds-collector/the-odds-api";

export async function GET(request: NextRequest) {
  const league = request.nextUrl.searchParams.get("league") || "serieA";

  try {
    const [stats, apiStatus] = await Promise.all([
      getCollectionStats(league),
      checkApiStatus(),
    ]);

    const snapshots = await loadSnapshots(league);
    const matchHistories = buildMatchHistory(snapshots);

    // Summary of line movements
    const movements = matchHistories
      .filter((m) => m.snapshots.length >= 2)
      .map((m) => ({
        matchId: m.matchId,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        commenceTime: m.commenceTime,
        snapshotCount: m.snapshots.length,
        opening: {
          home: m.openingHome,
          draw: m.openingDraw,
          away: m.openingAway,
        },
        closing: {
          home: m.closingHome,
          draw: m.closingDraw,
          away: m.closingAway,
        },
        movement: {
          home: m.lineMovementHome ? Math.round(m.lineMovementHome * 100) / 100 : 0,
          draw: m.lineMovementDraw ? Math.round(m.lineMovementDraw * 100) / 100 : 0,
          away: m.lineMovementAway ? Math.round(m.lineMovementAway * 100) / 100 : 0,
        },
      }));

    return NextResponse.json({
      league,
      collection: stats,
      apiStatus: {
        configured: apiStatus.hasKey,
        remaining: apiStatus.remaining,
        used: apiStatus.used,
      },
      matchHistories: movements,
      totalMatchesTracked: matchHistories.length,
      matchesWithMovement: movements.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
