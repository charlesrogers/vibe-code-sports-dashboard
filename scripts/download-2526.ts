/**
 * One-off script to download 2025-26 season data (and any missing 2024-25)
 * from football-data.co.uk and save as cached JSON.
 *
 * Usage: npx tsx scripts/download-2526.ts
 */

import * as fs from "fs";
import * as path from "path";

interface Target {
  season: string;
  code: string;
  league: string;
  leagueFile: string;
  label: string;
}

const TARGETS: Target[] = [
  // EPL & Championship 2025-26
  { season: "2025-26", code: "2526", league: "epl",          leagueFile: "E0", label: "EPL 2025-26" },
  { season: "2025-26", code: "2526", league: "championship", leagueFile: "E1", label: "Championship 2025-26" },
  // Continental 2024-25 (download if not cached)
  { season: "2024-25", code: "2425", league: "la-liga",      leagueFile: "SP1", label: "La Liga 2024-25" },
  { season: "2024-25", code: "2425", league: "bundesliga",   leagueFile: "D1",  label: "Bundesliga 2024-25" },
  { season: "2024-25", code: "2425", league: "ligue-1",      leagueFile: "F1",  label: "Ligue 1 2024-25" },
  // Continental 2025-26
  { season: "2025-26", code: "2526", league: "la-liga",      leagueFile: "SP1", label: "La Liga 2025-26" },
  { season: "2025-26", code: "2526", league: "bundesliga",   leagueFile: "D1",  label: "Bundesliga 2025-26" },
  { season: "2025-26", code: "2526", league: "ligue-1",      leagueFile: "F1",  label: "Ligue 1 2025-26" },
  { season: "2025-26", code: "2526", league: "serie-a",      leagueFile: "I1",  label: "Serie A 2025-26" },
];

// ─── CSV Parsing (same as backfill-historical.ts) ────────────────────────────

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

// ─── Download + Parse ────────────────────────────────────────────────────────

async function downloadAndParse(cfg: Target) {
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

  const matches: any[] = [];

  for (const r of rows) {
    if (!r.HomeTeam || !r.AwayTeam || r.FTHG === "" || r.FTAG === "") continue;

    const homeTeam = r.HomeTeam;
    const awayTeam = r.AwayTeam;
    const date = parseUKDate(r.Date);

    matches.push({
      id: `uk-${cfg.league}-${cfg.season}-${date}-${homeTeam}-${awayTeam}`,
      date,
      homeTeam,
      awayTeam,
      homeGoals: parseInt(r.FTHG) || 0,
      awayGoals: parseInt(r.FTAG) || 0,
      result: (r.FTR || "D"),
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

  if (matches.length > 0) {
    const first = matches[0];
    const last = matches[matches.length - 1];
    console.log(`  [${cfg.label}] Date range: ${first.date} -> ${last.date}`);
  }

  // Print unique team names
  const teams = new Set<string>();
  for (const m of matches) {
    teams.add(m.homeTeam);
    teams.add(m.awayTeam);
  }
  console.log(`  [${cfg.label}] ${teams.size} teams: ${[...teams].sort().join(", ")}`);

  return matches;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const cacheDir = path.join(process.cwd(), "data", "football-data-cache");
  fs.mkdirSync(cacheDir, { recursive: true });

  const force = process.argv.includes("--force");
  const onlyCurrent = process.argv.includes("--current"); // only 2025-26

  console.log(`=== Downloading football-data.co.uk CSVs${force ? " (FORCE REFRESH)" : ""} ===\n`);

  let downloaded = 0;
  let skipped = 0;

  for (const cfg of TARGETS) {
    if (onlyCurrent && cfg.season !== "2025-26") { skipped++; continue; }

    const outFile = path.join(cacheDir, `${cfg.league}-${cfg.season}.json`);

    // Skip if already cached (unless --force)
    if (!force && fs.existsSync(outFile)) {
      const existing = JSON.parse(fs.readFileSync(outFile, "utf-8"));
      console.log(`[SKIP] ${cfg.label} — already cached (${existing.matchCount} matches, fetched ${existing.fetchedAt})`);
      skipped++;
      continue;
    }

    console.log(`\n--- ${cfg.label} ---`);
    try {
      const matches = await downloadAndParse(cfg);
      if (matches.length > 0) {
        const payload = {
          league: cfg.league,
          season: cfg.season,
          fetchedAt: new Date().toISOString(),
          matchCount: matches.length,
          matches,
        };
        fs.writeFileSync(outFile, JSON.stringify(payload, null, 2));
        console.log(`  Saved ${matches.length} matches -> ${outFile}`);
        downloaded++;
      } else {
        console.log(`  [${cfg.label}] No matches found — file not created`);
      }
    } catch (e: any) {
      console.error(`  ERROR: ${cfg.label}: ${e.message}`);
    }
  }

  console.log(`\n=== Done! Downloaded: ${downloaded}, Skipped (already cached): ${skipped} ===`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
