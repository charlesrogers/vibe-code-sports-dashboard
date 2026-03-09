/**
 * Injury and suspension data from Fotmob
 *
 * Ted: "Injuries are the second most discussed topic. But Knutson never
 *  bets on injuries alone — they amplify or kill an xG-based thesis."
 *
 * Fetches per-team injury/suspension data from Fotmob's public team API.
 */

import { normalizeTeamName } from "./team-mapping";

export interface PlayerUnavailability {
  name: string;
  type: "injury" | "suspension" | "other";
  expectedReturn: string; // e.g. "Late March 2026", "Doubtful", "Out for season"
  isKeyPlayer: boolean; // based on market value or performance
  marketValue: number | null;
  seasonGoals: number;
  seasonAssists: number;
}

export interface TeamInjuryReport {
  team: string;
  fotmobId: number;
  unavailable: PlayerUnavailability[];
  injuredCount: number;
  suspendedCount: number;
  totalOut: number;
  severity: "none" | "minor" | "moderate" | "major" | "crisis";
  summary: string;
}

// Fotmob team IDs for Serie A teams
const SERIE_A_TEAM_IDS: Record<string, number> = {
  Inter: 8636,
  Milan: 8564,
  Napoli: 9875,
  Juventus: 9885,
  Atalanta: 8524,
  Roma: 8686,
  Lazio: 8543,
  Fiorentina: 8535,
  Bologna: 9857,
  Como: 10171,
  Torino: 9804,
  Genoa: 10233,
  Udinese: 8600,
  Cagliari: 8529,
  Verona: 9876,
  Parma: 10167,
  Lecce: 9888,
  Sassuolo: 7943,
  Pisa: 6479,
  Cremonese: 7801,
};

// Market value threshold for "key player" (in euros)
const KEY_PLAYER_VALUE_THRESHOLD = 15_000_000;

function classifySeverity(
  totalOut: number,
  keyPlayersOut: number
): TeamInjuryReport["severity"] {
  // Ted's framework:
  // "4-5 injured players is notable. 7-8+ is a major factor."
  // "Two first-choice center-backs missing is worse than six squad players."
  if (totalOut === 0) return "none";
  if (keyPlayersOut >= 3 || totalOut >= 7) return "crisis";
  if (keyPlayersOut >= 2 || totalOut >= 5) return "major";
  if (keyPlayersOut >= 1 || totalOut >= 3) return "moderate";
  return "minor";
}

function buildSummary(report: {
  team: string;
  totalOut: number;
  injuredCount: number;
  suspendedCount: number;
  severity: string;
  unavailable: PlayerUnavailability[];
}): string {
  if (report.totalOut === 0) return `${report.team} have a clean bill of health.`;

  const parts: string[] = [];
  parts.push(`${report.team}: ${report.totalOut} players unavailable`);

  if (report.injuredCount > 0 && report.suspendedCount > 0) {
    parts.push(`(${report.injuredCount} injured, ${report.suspendedCount} suspended)`);
  }

  const keyPlayers = report.unavailable.filter((p) => p.isKeyPlayer);
  if (keyPlayers.length > 0) {
    const names = keyPlayers.map((p) => p.name).join(", ");
    parts.push(`— key absences: ${names}`);
  }

  return parts.join(" ");
}

async function fetchTeamInjuries(
  teamName: string,
  fotmobId: number
): Promise<TeamInjuryReport> {
  try {
    const res = await fetch(
      `https://www.fotmob.com/api/teams?id=${fotmobId}&ccode3=USA`,
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        next: { revalidate: 3600 }, // 1 hour cache
      }
    );

    if (!res.ok) {
      return {
        team: teamName,
        fotmobId,
        unavailable: [],
        injuredCount: 0,
        suspendedCount: 0,
        totalOut: 0,
        severity: "none",
        summary: `Could not fetch injury data (HTTP ${res.status})`,
      };
    }

    const data = await res.json();

    const unavailable: PlayerUnavailability[] = [];

    // Method 1: Squad injury field (more comprehensive)
    const squad = data?.squad?.squad || [];
    for (const section of squad) {
      for (const player of section?.members || []) {
        const injury = player?.injury;
        if (injury) {
          unavailable.push({
            name: player.name || "Unknown",
            type: "injury",
            expectedReturn: injury.expectedReturn || "Unknown",
            isKeyPlayer: (player.marketValue || 0) >= KEY_PLAYER_VALUE_THRESHOLD,
            marketValue: player.marketValue || null,
            seasonGoals: player.seasonGoals || 0,
            seasonAssists: player.seasonAssists || 0,
          });
        }
      }
    }

    // Method 2: Unavailable list (includes suspensions)
    const unavailList =
      data?.overview?.lastLineupStats?.unavailable || [];
    for (const u of unavailList) {
      const unavailType = u?.unavailability?.type || "other";
      // Only add if not already in the injury list
      const alreadyListed = unavailable.some((p) => p.name === u.name);
      if (!alreadyListed) {
        unavailable.push({
          name: u.name || "Unknown",
          type: unavailType === "suspension" ? "suspension" : unavailType === "injury" ? "injury" : "other",
          expectedReturn: u?.unavailability?.expectedReturn || "Unknown",
          isKeyPlayer: (u.marketValue || 0) >= KEY_PLAYER_VALUE_THRESHOLD,
          marketValue: u.marketValue || null,
          seasonGoals: u?.performance?.seasonGoals || 0,
          seasonAssists: u?.performance?.seasonAssists || 0,
        });
      } else if (unavailType === "suspension") {
        // Update type if it was listed as injury but is actually suspended
        const existing = unavailable.find((p) => p.name === u.name);
        if (existing) existing.type = "suspension";
      }
    }

    const injuredCount = unavailable.filter((p) => p.type === "injury").length;
    const suspendedCount = unavailable.filter(
      (p) => p.type === "suspension"
    ).length;
    const totalOut = unavailable.length;
    const keyPlayersOut = unavailable.filter((p) => p.isKeyPlayer).length;

    const severity = classifySeverity(totalOut, keyPlayersOut);

    const report: TeamInjuryReport = {
      team: teamName,
      fotmobId,
      unavailable,
      injuredCount,
      suspendedCount,
      totalOut,
      severity,
      summary: "",
    };
    report.summary = buildSummary(report);

    return report;
  } catch (e) {
    return {
      team: teamName,
      fotmobId,
      unavailable: [],
      injuredCount: 0,
      suspendedCount: 0,
      totalOut: 0,
      severity: "none",
      summary: `Error fetching injuries: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * Fetch injury reports for all teams in a league.
 * Rate-limited to avoid hammering Fotmob.
 */
export async function fetchAllInjuries(
  league: string = "serieA"
): Promise<TeamInjuryReport[]> {
  if (league !== "serieA") {
    // Only Serie A team IDs are mapped for now
    return [];
  }

  const entries = Object.entries(SERIE_A_TEAM_IDS);

  // Fetch in batches of 5 to be polite
  const results: TeamInjuryReport[] = [];
  for (let i = 0; i < entries.length; i += 5) {
    const batch = entries.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(([name, id]) => fetchTeamInjuries(name, id))
    );
    results.push(...batchResults);

    // Small delay between batches
    if (i + 5 < entries.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return results;
}

/**
 * Get injury report for a specific team.
 */
export async function fetchTeamInjuryReport(
  team: string,
  league: string = "serieA"
): Promise<TeamInjuryReport | null> {
  if (league !== "serieA") return null;

  const id = SERIE_A_TEAM_IDS[team];
  if (!id) return null;

  return fetchTeamInjuries(team, id);
}
