import { NextRequest, NextResponse } from "next/server";
import { fetchAllInjuries } from "@/lib/injuries";

export async function GET(request: NextRequest) {
  const league = request.nextUrl.searchParams.get("league") || "serieA";

  try {
    const reports = await fetchAllInjuries(league);

    // Sort by severity (crisis first)
    const severityOrder = { crisis: 0, major: 1, moderate: 2, minor: 3, none: 4 };
    reports.sort(
      (a, b) =>
        (severityOrder[a.severity] ?? 5) - (severityOrder[b.severity] ?? 5)
    );

    return NextResponse.json({
      league,
      reports,
      summary: {
        teamsChecked: reports.length,
        teamsWithIssues: reports.filter((r) => r.totalOut > 0).length,
        totalUnavailable: reports.reduce((s, r) => s + r.totalOut, 0),
        crisisTeams: reports
          .filter((r) => r.severity === "crisis")
          .map((r) => r.team),
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
