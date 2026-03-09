/**
 * Understat xG scraper using Playwright
 *
 * Scrapes per-match xG data from Understat and aggregates into
 * venue-split (home/away) xG stats — the way Ted Knutson always uses them.
 *
 * "Knutson never uses a team's overall season xGD. He always breaks it
 *  into home and away splits."
 */

import type { TeamXg } from "./types";
import { normalizeTeamName } from "./team-mapping";

export interface VenueSplitXg {
  team: string;
  home: TeamXg;
  away: TeamXg;
  overall: TeamXg;
}

interface UnderstatMatch {
  h_a: "h" | "a";
  xG: number;
  xGA: number;
  scored: number;
  missed: number;
  date: string;
}

interface UnderstatTeam {
  id: string;
  title: string;
  history: UnderstatMatch[];
}

const LEAGUE_URLS: Record<string, string> = {
  serieA: "https://understat.com/league/Serie_A",
  serieB: "https://understat.com/league/Serie_B",
  premierLeague: "https://understat.com/league/EPL",
  laLiga: "https://understat.com/league/La_liga",
  bundesliga: "https://understat.com/league/Bundesliga",
  ligue1: "https://understat.com/league/Ligue_1",
};

function aggregateMatches(
  team: string,
  matches: UnderstatMatch[]
): TeamXg {
  const xGFor = matches.reduce((s, m) => s + m.xG, 0);
  const xGAgainst = matches.reduce((s, m) => s + m.xGA, 0);
  const goalsFor = matches.reduce((s, m) => s + m.scored, 0);
  const goalsAgainst = matches.reduce((s, m) => s + m.missed, 0);

  return {
    team,
    xGFor: Math.round(xGFor * 100) / 100,
    xGAgainst: Math.round(xGAgainst * 100) / 100,
    goalsFor,
    goalsAgainst,
    xGDiff: Math.round((xGFor - xGAgainst) * 100) / 100,
    overperformance: Math.round((goalsFor - xGFor) * 100) / 100,
    matches: matches.length,
  };
}

/**
 * Scrape Understat for per-match xG data and split by venue.
 * Requires Playwright to be installed (headless browser).
 */
export async function scrapeUnderstatVenueSplitXg(
  league: string = "serieA"
): Promise<VenueSplitXg[]> {
  const url = LEAGUE_URLS[league];
  if (!url) throw new Error(`Unsupported league for Understat: ${league}`);

  // Dynamic import — Playwright is only available at build/scrape time
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);

    const teamsData: Record<string, UnderstatTeam> | null =
      await page.evaluate(() => (window as any).teamsData);

    if (!teamsData) {
      throw new Error("Understat teamsData not found on page");
    }

    const results: VenueSplitXg[] = [];

    for (const [, team] of Object.entries(teamsData)) {
      const name = normalizeTeamName(team.title, "understat");

      const homeMatches = team.history.filter((m) => m.h_a === "h");
      const awayMatches = team.history.filter((m) => m.h_a === "a");

      results.push({
        team: name,
        home: aggregateMatches(name, homeMatches),
        away: aggregateMatches(name, awayMatches),
        overall: aggregateMatches(name, team.history),
      });
    }

    return results.sort(
      (a, b) =>
        b.overall.xGDiff - a.overall.xGDiff
    );
  } finally {
    await browser.close();
  }
}
