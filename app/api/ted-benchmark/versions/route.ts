/**
 * List all saved model versions for the Ted benchmark.
 * GET /api/ted-benchmark/versions?league=epl&season=2024-25
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const MODEL_VERSIONS_DIR = path.join(process.cwd(), "data", "model-versions");

interface SavedVersion {
  version: string;
  league: string;
  season: string;
  savedAt: string;
  results: {
    totalBets: number;
    betHitRate: number;
    drawsOnBets: number;
    byGrade: { grade: string; bets: number; hitRate: number; roi: number | null }[];
    homePicks: { total: number; wins: number; hitRate: number };
    awayPicks: { total: number; wins: number; hitRate: number };
  };
}

export async function GET(request: NextRequest) {
  const league = request.nextUrl.searchParams.get("league") || "epl";
  const season = request.nextUrl.searchParams.get("season");

  try {
    if (!fs.existsSync(MODEL_VERSIONS_DIR)) {
      return NextResponse.json({ versions: [] });
    }

    const files = fs.readdirSync(MODEL_VERSIONS_DIR).filter((f) => f.endsWith(".json"));
    const versions: SavedVersion[] = [];

    for (const file of files) {
      // Filter by league
      if (!file.includes(`-${league}-`)) continue;
      // Filter by season if specified — match the exact season slug at end of filename
      if (season) {
        const seasonKey = season.replace(/[^a-z0-9-]/gi, "_");
        // Filename format: ted-{version}-{league}-{seasonKey}.json
        // Extract the season part after the league prefix
        const expectedSuffix = `-${league}-${seasonKey}.json`;
        if (!file.endsWith(expectedSuffix)) continue;
      }

      try {
        const data = JSON.parse(
          fs.readFileSync(path.join(MODEL_VERSIONS_DIR, file), "utf-8")
        );
        versions.push({
          version: data.version,
          league: data.league,
          season: data.season,
          savedAt: data.savedAt,
          results: {
            totalBets: data.results.totalBets,
            betHitRate: data.results.betHitRate,
            drawsOnBets: data.results.drawsOnBets,
            byGrade: data.results.byGrade,
            homePicks: data.results.homePicks,
            awayPicks: data.results.awayPicks,
          },
        });
      } catch {
        // skip malformed files
      }
    }

    // Sort by version name then savedAt
    versions.sort((a, b) => a.version.localeCompare(b.version) || a.savedAt.localeCompare(b.savedAt));

    return NextResponse.json({ versions });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
