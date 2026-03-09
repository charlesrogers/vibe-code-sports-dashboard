/**
 * Loads venue-split xG data from the scraped Understat cache.
 *
 * Data is scraped by scripts/scrape-understat.js and saved to
 * data/xg-venue-split/{league}.json
 *
 * Ted: "Knutson never uses a team's overall season xGD.
 *       He always breaks it into home and away splits."
 */

import fs from "fs";
import path from "path";
import type { TeamXg } from "./types";
import type { VenueSplitXg } from "./understat";

export type { VenueSplitXg };

interface CachedData {
  league: string;
  scrapedAt: string;
  teams: {
    team: string;
    home: {
      xGFor: number;
      xGAgainst: number;
      goalsFor: number;
      goalsAgainst: number;
      matches: number;
      xGDiff: number;
    };
    away: {
      xGFor: number;
      xGAgainst: number;
      goalsFor: number;
      goalsAgainst: number;
      matches: number;
      xGDiff: number;
    };
    overall: {
      xGFor: number;
      xGAgainst: number;
      goalsFor: number;
      goalsAgainst: number;
      matches: number;
      xGDiff: number;
    };
  }[];
}

function toTeamXg(
  team: string,
  data: CachedData["teams"][0]["home"]
): TeamXg {
  return {
    team,
    xGFor: data.xGFor,
    xGAgainst: data.xGAgainst,
    goalsFor: data.goalsFor,
    goalsAgainst: data.goalsAgainst,
    xGDiff: data.xGDiff,
    overperformance:
      Math.round((data.goalsFor - data.xGFor) * 100) / 100,
    matches: data.matches,
  };
}

export function loadVenueSplitXg(
  league: string = "serieA"
): { teams: VenueSplitXg[]; scrapedAt: string } | null {
  const filePath = path.join(
    process.cwd(),
    "data",
    "xg-venue-split",
    `${league}.json`
  );

  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const cached: CachedData = JSON.parse(raw);

  const teams: VenueSplitXg[] = cached.teams.map((t) => ({
    team: t.team,
    home: toTeamXg(t.team, t.home),
    away: toTeamXg(t.team, t.away),
    overall: toTeamXg(t.team, t.overall),
  }));

  return { teams, scrapedAt: cached.scrapedAt };
}

/**
 * For a given fixture, return the correct venue-specific xG:
 * - Home team gets their HOME xG stats
 * - Away team gets their AWAY xG stats
 */
export function getVenueXgForFixture(
  homeTeam: string,
  awayTeam: string,
  venueSplits: VenueSplitXg[]
): { homeXg: TeamXg | null; awayXg: TeamXg | null } {
  const homeData = venueSplits.find((t) => t.team === homeTeam);
  const awayData = venueSplits.find((t) => t.team === awayTeam);

  return {
    homeXg: homeData ? homeData.home : null,
    awayXg: awayData ? awayData.away : null,
  };
}
