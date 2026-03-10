/**
 * FBref/StatsBomb xG data fetcher
 *
 * FBref publishes StatsBomb xG data for free on their website — the same
 * model Ted Knutson uses professionally. This is the gold-standard free
 * xG source.
 *
 * Approach:
 *   FBref embeds stats in HTML tables with well-known IDs. We fetch the
 *   squad stats page and parse the HTML table using regex (no DOM parser
 *   dependency required).
 *
 * Caveats:
 *   - FBref uses Cloudflare protection that may block server-side requests.
 *     When blocked, this returns an empty array (never throws).
 *   - FBref rate-limits aggressively — add delays between requests.
 *   - The table structure is stable but column positions may shift between
 *     seasons. We locate columns by header text, not index.
 *
 * Supported leagues:
 *   - Premier League (comp 9)
 *   - Serie A (comp 11)
 *   - La Liga (comp 12)
 *   - Bundesliga (comp 20)
 *   - Ligue 1 (comp 13)
 */

import type { TeamXg } from "./types";

// ─── Public interface ────────────────────────────────────────────────────────

export interface XgTeamData {
  team: string;
  xGFor: number;
  xGAgainst: number;
  goalsFor: number;
  goalsAgainst: number;
  matches: number;
  xGDiff: number;
}

// ─── League config ───────────────────────────────────────────────────────────

interface FBrefLeague {
  compId: number;
  slug: string;
  name: string;
}

const FBREF_LEAGUES: Record<string, FBrefLeague> = {
  premierLeague: { compId: 9, slug: "Premier-League", name: "Premier League" },
  serieA: { compId: 11, slug: "Serie-A", name: "Serie A" },
  laLiga: { compId: 12, slug: "La-Liga", name: "La Liga" },
  bundesliga: { compId: 20, slug: "Bundesliga", name: "Bundesliga" },
  ligue1: { compId: 13, slug: "Ligue-1", name: "Ligue 1" },
};

const LEAGUE_ALIASES: Record<string, string> = {
  epl: "premierLeague",
  pl: "premierLeague",
  "premier-league": "premierLeague",
  "serie-a": "serieA",
  "la-liga": "laLiga",
  "ligue-1": "ligue1",
};

function resolveLeague(league: string): string {
  return LEAGUE_ALIASES[league.toLowerCase()] ?? league;
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.5",
  "Accept-Encoding": "gzip, deflate, br",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
};

async function fetchPage(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(
        res.status === 403
          ? "Blocked by Cloudflare challenge"
          : `FBref returned HTTP ${res.status}`
      );
    }

    const html = await res.text();

    // Detect Cloudflare challenge page
    if (
      html.includes("Just a moment...") ||
      html.includes("challenge-platform") ||
      html.includes("cf-challenge")
    ) {
      throw new Error("Blocked by Cloudflare challenge");
    }

    return html;
  } finally {
    clearTimeout(timer);
  }
}

// ─── HTML table parser ───────────────────────────────────────────────────────

/**
 * Parse an HTML table into rows of cell values.
 * Works without a DOM parser by using regex patterns specific to FBref's
 * table structure.
 */
function parseHtmlTable(
  html: string,
  tableId: string
): { headers: string[]; rows: string[][] } | null {
  // Find the table by ID
  const tableRegex = new RegExp(
    `<table[^>]*id="${tableId}"[^>]*>([\\s\\S]*?)<\\/table>`,
    "i"
  );
  const tableMatch = html.match(tableRegex);
  if (!tableMatch) {
    console.warn(`[xg-fbref] Table #${tableId} not found`);
    return null;
  }

  const tableHtml = tableMatch[1];

  // Extract header cells from the LAST thead row (FBref uses multi-row headers)
  const theadMatch = tableHtml.match(/<thead[^>]*>([\s\S]*?)<\/thead>/i);
  if (!theadMatch) return null;

  // Get all header rows
  const headerRows = Array.from(theadMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
  if (headerRows.length === 0) return null;

  // Use the last header row (it has the actual column names)
  const lastHeaderRow = headerRows[headerRows.length - 1][1];
  const headers: string[] = [];
  const headerCells = Array.from(
    lastHeaderRow.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)
  );
  for (const cell of headerCells) {
    // Strip HTML tags from header text
    const text = cell[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&[a-z]+;/g, " ")
      .trim();
    headers.push(text);
  }

  // Extract body rows
  const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return null;

  const rows: string[][] = [];
  const bodyRows = Array.from(tbodyMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));

  for (const row of bodyRows) {
    // Skip separator/spacer rows
    if (row[1].includes('class="spacer"') || row[1].includes("thead")) continue;

    const cells: string[] = [];
    const cellMatches = Array.from(
      row[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)
    );

    for (const cell of cellMatches) {
      // Extract text, handling links (team names are in <a> tags)
      let text = cell[1];
      // Get link text if present
      const linkMatch = text.match(/<a[^>]*>([^<]*)<\/a>/);
      if (linkMatch) {
        text = linkMatch[1];
      }
      text = text.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, " ").trim();
      cells.push(text);
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return { headers, rows };
}

// ─── Main fetch function ─────────────────────────────────────────────────────

/**
 * Fetch team-level xG data from FBref (StatsBomb model).
 *
 * FBref's squad stats page has two relevant tables:
 *   - "stats_{compId}_squads_standard" or "stats_squads_standard_for" — team attacking stats (xG for)
 *   - "stats_{compId}_squads_standard_against" or similar — team defensive stats (xG against)
 *
 * However, the main table often contains both in a single "for" and "against" pair.
 * The simplest approach: use the squad shooting stats page which has xG per team.
 *
 * @param league - League key or alias
 * @param season - Season string (e.g., "2024-2025"). If omitted, uses current season.
 * @returns Array of XgTeamData sorted by xGDiff descending.
 *          Returns empty array on failure (never throws).
 */
export async function fetchXgFromFBref(
  league: string = "premierLeague",
  season?: string
): Promise<XgTeamData[]> {
  const resolved = resolveLeague(league);
  const config = FBREF_LEAGUES[resolved];

  if (!config) {
    console.warn(
      `[xg-fbref] Unknown league "${league}". Available: ${Object.keys(FBREF_LEAGUES).join(", ")}`
    );
    return [];
  }

  try {
    // Build URL — current season uses /comps/{id}/stats/{slug}-Stats
    // Historical seasons use /comps/{id}/{season}/stats/...
    let url: string;
    if (season) {
      url = `https://fbref.com/en/comps/${config.compId}/${season}/stats/${season}-${config.slug}-Stats`;
    } else {
      url = `https://fbref.com/en/comps/${config.compId}/stats/${config.slug}-Stats`;
    }

    console.log(`[xg-fbref] Fetching ${config.name} stats from: ${url}`);

    const html = await fetchPage(url);
    console.log(
      `[xg-fbref] Got ${(html.length / 1024).toFixed(0)}KB of HTML`
    );

    // FBref uses table IDs like "stats_squads_standard_for" for the "for" table
    // and "stats_squads_standard_against" for the "against" table.
    // Try several known table ID patterns.
    const forTableIds = [
      "stats_squads_standard_for",
      `stats_${config.compId}_squads_standard_for`,
      "stats_squads_shooting_for",
    ];
    const againstTableIds = [
      "stats_squads_standard_against",
      `stats_${config.compId}_squads_standard_against`,
      "stats_squads_shooting_against",
    ];

    let forTable: ReturnType<typeof parseHtmlTable> = null;
    let againstTable: ReturnType<typeof parseHtmlTable> = null;

    for (const id of forTableIds) {
      forTable = parseHtmlTable(html, id);
      if (forTable) {
        console.log(
          `[xg-fbref] Found "for" table: #${id} (${forTable.rows.length} rows, columns: ${forTable.headers.join(", ")})`
        );
        break;
      }
    }

    for (const id of againstTableIds) {
      againstTable = parseHtmlTable(html, id);
      if (againstTable) {
        console.log(
          `[xg-fbref] Found "against" table: #${id} (${againstTable.rows.length} rows)`
        );
        break;
      }
    }

    if (!forTable) {
      // Try to find any table with xG columns as fallback
      console.warn("[xg-fbref] Could not find standard stats tables");

      // Log available table IDs for debugging
      const tableIds = Array.from(html.matchAll(/id="(stats_[^"]+)"/g)).map(
        (m) => m[1]
      );
      if (tableIds.length > 0) {
        console.log(
          `[xg-fbref] Available stat tables: ${tableIds.join(", ")}`
        );
      }
      return [];
    }

    // Find column indices
    const findCol = (headers: string[], ...names: string[]): number => {
      for (const name of names) {
        const idx = headers.findIndex(
          (h) => h.toLowerCase() === name.toLowerCase()
        );
        if (idx !== -1) return idx;
      }
      return -1;
    };

    const teamCol = findCol(forTable.headers, "Squad", "Team");
    const mpCol = findCol(forTable.headers, "MP", "Matches");
    const glsCol = findCol(forTable.headers, "Gls", "Goals");
    const xgCol = findCol(forTable.headers, "xG");

    if (teamCol === -1 || xgCol === -1) {
      console.warn(
        `[xg-fbref] Missing required columns. Headers: ${forTable.headers.join(", ")}`
      );
      return [];
    }

    console.log(
      `[xg-fbref] Column mapping: team=${teamCol}, mp=${mpCol}, gls=${glsCol}, xg=${xgCol}`
    );

    // Build xGA lookup from "against" table
    const xgaMap = new Map<string, { xGA: number; ga: number }>();
    if (againstTable) {
      const aTeamCol = findCol(againstTable.headers, "Squad", "Team");
      const aGlsCol = findCol(againstTable.headers, "Gls", "Goals");
      const aXgCol = findCol(againstTable.headers, "xG");

      if (aTeamCol !== -1 && aXgCol !== -1) {
        for (const row of againstTable.rows) {
          const team = row[aTeamCol];
          const xGA = parseFloat(row[aXgCol]) || 0;
          const ga = aGlsCol !== -1 ? parseInt(row[aGlsCol]) || 0 : 0;
          if (team) xgaMap.set(team, { xGA, ga });
        }
      }
    }

    // Build results
    const results: XgTeamData[] = [];

    for (const row of forTable.rows) {
      const team = row[teamCol];
      if (!team) continue;

      const matches = mpCol !== -1 ? parseInt(row[mpCol]) || 0 : 0;
      const goalsFor = glsCol !== -1 ? parseInt(row[glsCol]) || 0 : 0;
      const xGFor = parseFloat(row[xgCol]) || 0;

      const against = xgaMap.get(team);
      const xGAgainst = against?.xGA ?? 0;
      const goalsAgainst = against?.ga ?? 0;

      results.push({
        team,
        xGFor: Math.round(xGFor * 100) / 100,
        xGAgainst: Math.round(xGAgainst * 100) / 100,
        goalsFor,
        goalsAgainst,
        matches,
        xGDiff: Math.round((xGFor - xGAgainst) * 100) / 100,
      });
    }

    console.log(
      `[xg-fbref] Successfully parsed ${results.length} teams for ${config.name}`
    );

    return results.sort((a, b) => b.xGDiff - a.xGDiff);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Cloudflare")) {
      console.warn(
        `[xg-fbref] Blocked by Cloudflare for ${config.name}. ` +
          "FBref requires browser-based access; server-side fetching may be intermittently blocked."
      );
    } else {
      console.error(`[xg-fbref] Failed to fetch ${config.name} xG:`, err);
    }
    return [];
  }
}

// ─── Convenience: convert to TeamXg ──────────────────────────────────────────

/**
 * Fetch FBref xG data and return it in the app's standard TeamXg format.
 */
export async function fetchTeamXgFromFBref(
  league: string = "premierLeague",
  season?: string
): Promise<TeamXg[]> {
  const data = await fetchXgFromFBref(league, season);
  return data.map((d) => ({
    team: d.team,
    xGFor: d.xGFor,
    xGAgainst: d.xGAgainst,
    goalsFor: d.goalsFor,
    goalsAgainst: d.goalsAgainst,
    xGDiff: d.xGDiff,
    overperformance: Math.round((d.goalsFor - d.xGFor) * 100) / 100,
    matches: d.matches,
  }));
}

// ─── List available leagues ──────────────────────────────────────────────────

export function getAvailableFBrefLeagues(): string[] {
  return Object.keys(FBREF_LEAGUES);
}
