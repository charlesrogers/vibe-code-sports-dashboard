import { TeamXg } from "./types";
import { normalizeTeamName } from "./team-mapping";

// Understat embeds JSON data in script tags as:
// var teamsData = JSON.parse('\x7B...\x7D')
// We fetch the HTML, extract the JSON, and parse it.

function decodeUnderstatString(encoded: string): string {
  // Understat uses hex escapes like \x22 for " and \x27 for '
  return encoded.replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

export async function fetchTeamXg(season: number = 2024): Promise<TeamXg[]> {
  try {
    const url = `https://understat.com/league/Serie_A/${season}`;
    const res = await fetch(url, {
      next: { revalidate: 21600 }, // 6 hours
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    if (!res.ok) throw new Error(`Understat returned ${res.status}`);

    const html = await res.text();

    // Extract teamsData JSON from script tags
    const teamsMatch = html.match(/var\s+teamsData\s*=\s*JSON\.parse\('(.+?)'\)/);
    if (!teamsMatch) throw new Error("Could not find teamsData in Understat HTML");

    const decoded = decodeUnderstatString(teamsMatch[1]);
    const teamsData = JSON.parse(decoded);

    const results: TeamXg[] = [];

    for (const teamId of Object.keys(teamsData)) {
      const team = teamsData[teamId];
      const history: any[] = team.history || [];

      let xGFor = 0, xGAgainst = 0, goalsFor = 0, goalsAgainst = 0;
      for (const match of history) {
        xGFor += parseFloat(match.xG || 0);
        xGAgainst += parseFloat(match.xGA || 0);
        goalsFor += parseInt(match.scored || 0);
        goalsAgainst += parseInt(match.missed || 0);
      }

      const name = normalizeTeamName(team.title, "understat");

      results.push({
        team: name,
        xGFor: Math.round(xGFor * 100) / 100,
        xGAgainst: Math.round(xGAgainst * 100) / 100,
        goalsFor,
        goalsAgainst,
        xGDiff: Math.round((xGFor - xGAgainst) * 100) / 100,
        overperformance: Math.round((goalsFor - xGFor) * 100) / 100,
        matches: history.length,
      });
    }

    return results.sort((a, b) => b.xGDiff - a.xGDiff);
  } catch (e) {
    console.warn("Understat fetch failed:", e);
    return [];
  }
}
