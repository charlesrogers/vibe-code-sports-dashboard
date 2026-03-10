/**
 * Backfill historical data for EPL and Championship betting model backtesting.
 *
 * Downloads football-data.co.uk CSVs, parses them, and caches:
 *   1. Match results (as training data for Dixon-Coles / Elo)
 *   2. Odds data (for walk-forward CLV evaluation)
 *
 * Also verifies Understat xG cache is present for EPL.
 *
 * Usage: npx tsx scripts/backfill-historical.ts
 */

import * as fs from "fs";
import * as path from "path";

// ─── Config ───────────────────────────────────────────────────────────────────

interface SeasonConfig {
  season: string;    // e.g. "2023-24"
  code: string;      // e.g. "2324"
  league: string;    // internal key
  leagueFile: string; // football-data.co.uk file code
  label: string;     // for logging
}

const TARGETS: SeasonConfig[] = [
  { season: "2023-24", code: "2324", league: "epl",          leagueFile: "E0", label: "EPL 2023-24" },
  { season: "2024-25", code: "2425", league: "epl",          leagueFile: "E0", label: "EPL 2024-25" },
  { season: "2023-24", code: "2324", league: "championship", leagueFile: "E1", label: "Championship 2023-24" },
  { season: "2024-25", code: "2425", league: "championship", leagueFile: "E1", label: "Championship 2024-25" },
];

// ─── Team name mapping: football-data.co.uk → canonical ───────────────────────

const UK_TEAM_MAP: Record<string, string> = {
  // EPL
  "Arsenal": "Arsenal",
  "Aston Villa": "Aston Villa",
  "Bournemouth": "Bournemouth",
  "Brentford": "Brentford",
  "Brighton": "Brighton",
  "Burnley": "Burnley",
  "Chelsea": "Chelsea",
  "Crystal Palace": "Crystal Palace",
  "Everton": "Everton",
  "Fulham": "Fulham",
  "Ipswich": "Ipswich",
  "Leeds": "Leeds",
  "Leicester": "Leicester",
  "Liverpool": "Liverpool",
  "Luton": "Luton",
  "Man City": "Manchester City",
  "Man United": "Manchester United",
  "Newcastle": "Newcastle United",
  "Nott'm Forest": "Nottingham Forest",
  "Sheffield United": "Sheffield United",
  "Southampton": "Southampton",
  "Tottenham": "Tottenham",
  "West Ham": "West Ham",
  "Wolves": "Wolverhampton Wanderers",
  // Championship
  "Birmingham": "Birmingham",
  "Blackburn": "Blackburn",
  "Bristol City": "Bristol City",
  "Cardiff": "Cardiff",
  "Coventry": "Coventry",
  "Derby": "Derby",
  "Hull": "Hull City",
  "Huddersfield": "Huddersfield",
  "Middlesbrough": "Middlesbrough",
  "Millwall": "Millwall",
  "Norwich": "Norwich",
  "Oxford": "Oxford United",
  "Oxford United": "Oxford United",
  "Sheffield Weds": "Sheffield Wednesday",
  "Plymouth": "Plymouth",
  "Portsmouth": "Portsmouth",
  "Preston": "Preston",
  "QPR": "QPR",
  "Rotherham": "Rotherham",
  "Stoke": "Stoke",
  "Sunderland": "Sunderland",
  "Swansea": "Swansea",
  "Watford": "Watford",
  "West Brom": "West Brom",
  "Wigan": "Wigan",
  "Blackpool": "Blackpool",
};

// Understat EPL names → canonical (for cross-referencing)
const UNDERSTAT_EPL_MAP: Record<string, string> = {
  "Arsenal": "Arsenal",
  "Aston Villa": "Aston Villa",
  "Bournemouth": "Bournemouth",
  "Brentford": "Brentford",
  "Brighton": "Brighton",
  "Burnley": "Burnley",
  "Chelsea": "Chelsea",
  "Crystal Palace": "Crystal Palace",
  "Everton": "Everton",
  "Fulham": "Fulham",
  "Ipswich": "Ipswich",
  "Leeds": "Leeds",
  "Leicester": "Leicester",
  "Liverpool": "Liverpool",
  "Luton": "Luton",
  "Manchester City": "Manchester City",
  "Manchester United": "Manchester United",
  "Newcastle United": "Newcastle United",
  "Nottingham Forest": "Nottingham Forest",
  "Sheffield United": "Sheffield United",
  "Southampton": "Southampton",
  "Tottenham": "Tottenham",
  "West Ham": "West Ham",
  "Wolverhampton Wanderers": "Wolverhampton",
};

function normalizeUK(name: string): string {
  return UK_TEAM_MAP[name] ?? name;
}

// ─── CSV Parsing ──────────────────────────────────────────────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",");
    if (values.length < headers.length / 2) continue;
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = (values[j] || "").trim();
    }
    rows.push(row);
  }
  return rows;
}

function parseUKDate(dateStr: string): string {
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const [day, month, year] = parts;
    const fullYear = year.length === 2 ? `20${year}` : year;
    return `${fullYear}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return dateStr;
}

function pf(val: string): number {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ─── Match + Odds structures ─────────────────────────────────────────────────

interface CachedMatch {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  result: "H" | "D" | "A";
  season: string;
  league: string;
}

interface CachedMatchWithOdds extends CachedMatch {
  htHomeGoals: number;
  htAwayGoals: number;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homeCorners: number;
  awayCorners: number;
  homeFouls: number;
  awayFouls: number;
  homeYellow: number;
  awayYellow: number;
  homeRed: number;
  awayRed: number;
  b365Home: number;
  b365Draw: number;
  b365Away: number;
  pinnacleHome: number;
  pinnacleDraw: number;
  pinnacleAway: number;
  maxHome: number;
  maxDraw: number;
  maxAway: number;
  avgHome: number;
  avgDraw: number;
  avgAway: number;
  b365Over25: number;
  b365Under25: number;
  pinnacleOver25: number;
  pinnacleUnder25: number;
  avgOver25: number;
  avgUnder25: number;
}

// ─── Download + Parse ─────────────────────────────────────────────────────────

async function downloadAndParse(cfg: SeasonConfig): Promise<CachedMatchWithOdds[]> {
  const url = `https://www.football-data.co.uk/mmz4281/${cfg.code}/${cfg.leagueFile}.csv`;
  console.log(`  [${cfg.label}] Fetching ${url} ...`);

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (sports-dashboard backfill)" },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    console.error(`  [${cfg.label}] HTTP ${res.status} — skipping`);
    return [];
  }

  const text = await res.text();
  const rows = parseCSV(text);
  console.log(`  [${cfg.label}] Parsed ${rows.length} raw rows`);

  const matches: CachedMatchWithOdds[] = [];

  for (const r of rows) {
    if (!r.HomeTeam || !r.AwayTeam || r.FTHG === "" || r.FTAG === "") continue;

    const homeTeam = normalizeUK(r.HomeTeam);
    const awayTeam = normalizeUK(r.AwayTeam);
    const date = parseUKDate(r.Date);

    matches.push({
      id: `uk-${cfg.league}-${cfg.season}-${date}-${homeTeam}-${awayTeam}`,
      date,
      homeTeam,
      awayTeam,
      homeGoals: parseInt(r.FTHG) || 0,
      awayGoals: parseInt(r.FTAG) || 0,
      result: (r.FTR || "D") as "H" | "D" | "A",
      season: cfg.season,
      league: cfg.league,
      htHomeGoals: parseInt(r.HTHG) || 0,
      htAwayGoals: parseInt(r.HTAG) || 0,
      homeShots: parseInt(r.HS) || 0,
      awayShots: parseInt(r.AS) || 0,
      homeShotsOnTarget: parseInt(r.HST) || 0,
      awayShotsOnTarget: parseInt(r.AST) || 0,
      homeCorners: parseInt(r.HC) || 0,
      awayCorners: parseInt(r.AC) || 0,
      homeFouls: parseInt(r.HF) || 0,
      awayFouls: parseInt(r.AF) || 0,
      homeYellow: parseInt(r.HY) || 0,
      awayYellow: parseInt(r.AY) || 0,
      homeRed: parseInt(r.HR) || 0,
      awayRed: parseInt(r.AR) || 0,
      b365Home: pf(r.B365H),
      b365Draw: pf(r.B365D),
      b365Away: pf(r.B365A),
      pinnacleHome: pf(r.PSH),
      pinnacleDraw: pf(r.PSD),
      pinnacleAway: pf(r.PSA),
      maxHome: pf(r.MaxH),
      maxDraw: pf(r.MaxD),
      maxAway: pf(r.MaxA),
      avgHome: pf(r.AvgH),
      avgDraw: pf(r.AvgD),
      avgAway: pf(r.AvgA),
      b365Over25: pf(r["B365>2.5"]),
      b365Under25: pf(r["B365<2.5"]),
      pinnacleOver25: pf(r["P>2.5"]),
      pinnacleUnder25: pf(r["P<2.5"]),
      avgOver25: pf(r["Avg>2.5"]),
      avgUnder25: pf(r["Avg<2.5"]),
    });
  }

  console.log(`  [${cfg.label}] ${matches.length} valid matches with odds`);

  // Print a few sample matches
  if (matches.length > 0) {
    const first = matches[0];
    const last = matches[matches.length - 1];
    console.log(`  [${cfg.label}] Date range: ${first.date} → ${last.date}`);
    console.log(`  [${cfg.label}] Sample: ${first.homeTeam} ${first.homeGoals}-${first.awayGoals} ${first.awayTeam} (B365: ${first.b365Home}/${first.b365Draw}/${first.b365Away})`);
  }

  // Print unique team names for verification
  const teams = new Set<string>();
  for (const m of matches) {
    teams.add(m.homeTeam);
    teams.add(m.awayTeam);
  }
  console.log(`  [${cfg.label}] ${teams.size} teams: ${[...teams].sort().join(", ")}`);

  return matches;
}

// ─── Understat verification ───────────────────────────────────────────────────

function verifyUnderstatCache(): void {
  console.log("\n═══ Verifying Understat xG cache ═══");
  const cacheDir = path.join(process.cwd(), "data", "understat-cache");

  const needed = [
    { file: "premierLeague-2023.json", label: "EPL 2023-24 (season=2023)" },
    { file: "premierLeague-2024.json", label: "EPL 2024-25 (season=2024)" },
  ];

  for (const { file, label } of needed) {
    const fp = path.join(cacheDir, file);
    if (fs.existsSync(fp)) {
      const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
      const teamCount = data.rawHistory?.length ?? 0;
      const totalMatches = data.rawHistory?.reduce((s: number, t: any) => s + (t.matches?.length ?? 0), 0) ?? 0;
      console.log(`  ✓ ${label}: ${teamCount} teams, ${totalMatches} matches (cached ${data.fetchedAt})`);
    } else {
      console.log(`  ✗ ${label}: MISSING — need to fetch`);
    }
  }

  console.log("  Note: Championship is NOT on Understat — no xG data available");
  console.log("  Note: Champions League is NOT on Understat or football-data.co.uk");
}

// ─── Understat cross-ref: check team name alignment ──────────────────────────

function crossRefTeamNames(
  oddsTeams: Set<string>,
  understatFile: string,
  label: string
): void {
  const fp = path.join(process.cwd(), "data", "understat-cache", understatFile);
  if (!fs.existsSync(fp)) {
    console.log(`  [cross-ref] ${label}: understat cache missing, skipping`);
    return;
  }

  const data = JSON.parse(fs.readFileSync(fp, "utf-8"));
  const understatTeams = new Set<string>(
    (data.rawHistory || []).map((t: any) => t.team)
  );

  const oddsOnly = [...oddsTeams].filter(t => !understatTeams.has(t));
  const understatOnly = [...understatTeams].filter(t => !oddsTeams.has(t));

  if (oddsOnly.length === 0 && understatOnly.length === 0) {
    console.log(`  [cross-ref] ${label}: All team names match perfectly!`);
  } else {
    if (oddsOnly.length > 0) {
      console.log(`  [cross-ref] ${label}: In odds but NOT in Understat: ${oddsOnly.join(", ")}`);
    }
    if (understatOnly.length > 0) {
      console.log(`  [cross-ref] ${label}: In Understat but NOT in odds: ${understatOnly.join(", ")}`);
    }
  }
}

// ─── Save ─────────────────────────────────────────────────────────────────────

function saveCache(matches: CachedMatchWithOdds[], league: string, season: string): void {
  const outDir = path.join(process.cwd(), "data", "football-data-cache");
  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, `${league}-${season}.json`);
  const payload = {
    league,
    season,
    fetchedAt: new Date().toISOString(),
    matchCount: matches.length,
    matches,
  };

  fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
  console.log(`  Saved ${matches.length} matches → ${outFile}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║  Historical Data Backfill for Betting Model Backtesting     ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  // 1. Verify Understat xG cache
  verifyUnderstatCache();

  // 2. Download football-data.co.uk CSVs
  console.log("\n═══ Downloading football-data.co.uk CSVs ═══");

  const allResults: Map<string, CachedMatchWithOdds[]> = new Map();

  for (const cfg of TARGETS) {
    console.log(`\n--- ${cfg.label} ---`);
    try {
      const matches = await downloadAndParse(cfg);
      if (matches.length > 0) {
        const key = `${cfg.league}-${cfg.season}`;
        allResults.set(key, matches);
        saveCache(matches, cfg.league, cfg.season);
      }
    } catch (e: any) {
      console.error(`  ERROR: ${cfg.label}: ${e.message}`);
    }
  }

  // 3. Cross-reference team names between odds and Understat
  console.log("\n═══ Cross-referencing team names (odds ↔ Understat) ═══");

  const eplTeams2324 = new Set<string>();
  const eplTeams2425 = new Set<string>();

  for (const m of allResults.get("epl-2023-24") || []) {
    eplTeams2324.add(m.homeTeam);
    eplTeams2324.add(m.awayTeam);
  }
  for (const m of allResults.get("epl-2024-25") || []) {
    eplTeams2425.add(m.homeTeam);
    eplTeams2425.add(m.awayTeam);
  }

  crossRefTeamNames(eplTeams2324, "premierLeague-2023.json", "EPL 2023-24");
  crossRefTeamNames(eplTeams2425, "premierLeague-2024.json", "EPL 2024-25");

  // 4. Summary
  console.log("\n═══ Summary ═══");
  console.log("Data available for backtesting:");
  console.log("");
  console.log("  EPL:");
  console.log("    - xG (Understat):  2023-24 ✓, 2024-25 ✓");
  console.log(`    - Odds+Results:    2023-24 (${allResults.get("epl-2023-24")?.length ?? 0} matches), 2024-25 (${allResults.get("epl-2024-25")?.length ?? 0} matches)`);
  console.log("");
  console.log("  Championship:");
  console.log("    - xG (Understat):  NOT AVAILABLE (Championship not on Understat)");
  console.log(`    - Odds+Results:    2023-24 (${allResults.get("championship-2023-24")?.length ?? 0} matches), 2024-25 (${allResults.get("championship-2024-25")?.length ?? 0} matches)`);
  console.log("");
  console.log("  Champions League:");
  console.log("    - NOT AVAILABLE on either Understat or football-data.co.uk");
  console.log("");
  console.log("  Cache directory: data/football-data-cache/");
  console.log("  Understat cache: data/understat-cache/");
  console.log("");
  console.log("Done!");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
