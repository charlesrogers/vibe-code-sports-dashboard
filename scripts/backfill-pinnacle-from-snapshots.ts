/**
 * Backfill Pinnacle odds into football-data-cache from odds-snapshots.
 *
 * For each league's 2025-26 cache file, finds matches missing Pinnacle odds
 * and patches them from the last pre-kickoff odds snapshot.
 *
 * Usage: npx tsx scripts/backfill-pinnacle-from-snapshots.ts
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = process.cwd();
const CACHE_DIR = join(DATA_DIR, "data", "football-data-cache");
const SNAPSHOT_DIR = join(DATA_DIR, "data", "odds-snapshots");

// Map from odds-snapshot league keys to football-data-cache file prefixes
const LEAGUE_MAP: Record<string, string> = {
  epl: "epl",
  laLiga: "la-liga",
  bundesliga: "bundesliga",
  serieA: "serie-a",
  serieB: "serie-b",
};

// Team name normalization: snapshot names (The Odds API / Fotmob style) → football-data-cache names
// The cache uses short UK-style names; snapshots use full canonical names
const SNAPSHOT_TO_CACHE: Record<string, string> = {
  // EPL
  "Manchester City": "Man City",
  "Manchester United": "Man United",
  "Newcastle United": "Newcastle",
  "Nottingham Forest": "Nott'm Forest",
  "Wolverhampton Wanderers": "Wolverhampton",
  "Wolverhampton": "Wolves",
  "West Ham United": "West Ham",
  "Ipswich Town": "Ipswich",
  "Leicester City": "Leicester",
  "Brighton and Hove Albion": "Brighton",
  "Luton Town": "Luton",
  // La Liga
  "Atletico Madrid": "Ath Madrid",
  "Athletic Club": "Ath Bilbao",
  "Athletic Bilbao": "Ath Bilbao",
  "Real Betis": "Betis",
  "Real Sociedad": "Sociedad",
  "Celta Vigo": "Celta",
  "Rayo Vallecano": "Vallecano",
  "Deportivo Alaves": "Alaves",
  "Real Valladolid": "Valladolid",
  "CD Leganes": "Leganes",
  "UD Las Palmas": "Las Palmas",
  // Bundesliga
  "Borussia Dortmund": "Dortmund",
  "Bayer Leverkusen": "Leverkusen",
  "Eintracht Frankfurt": "Ein Frankfurt",
  "VfB Stuttgart": "Stuttgart",
  "SC Freiburg": "Freiburg",
  "VfL Wolfsburg": "Wolfsburg",
  "Borussia Monchengladbach": "M'gladbach",
  "Borussia Mönchengladbach": "M'gladbach",
  "Mainz 05": "Mainz",
  "FC Augsburg": "Augsburg",
  "TSG Hoffenheim": "Hoffenheim",
  "FC St. Pauli": "St Pauli",
  "VfL Bochum": "Bochum",
  "Werder Bremen": "Werder Bremen",
  "Bayern Munich": "Bayern Munich",
  // Serie A
  "FC Internazionale Milano": "Inter",
  "AC Milan": "Milan",
  "SSC Napoli": "Napoli",
  "SS Lazio": "Lazio",
  "AS Roma": "Roma",
  "ACF Fiorentina": "Fiorentina",
  "Atalanta BC": "Atalanta",
  "Torino FC": "Torino",
  "Bologna FC 1909": "Bologna",
  "Udinese Calcio": "Udinese",
  "Genoa CFC": "Genoa",
  "Cagliari Calcio": "Cagliari",
  "Empoli FC": "Empoli",
  "Como 1907": "Como",
  "Parma Calcio 1913": "Parma",
  "US Lecce": "Lecce",
  "Hellas Verona FC": "Verona",
  "Hellas Verona": "Verona",
  "Venezia FC": "Venezia",
  "AC Monza": "Monza",
  "US Sassuolo Calcio": "Sassuolo",
  "Juventus FC": "Juventus",
};

interface OddsSnapshot {
  timestamp: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: {
    bookmaker: string;
    bookmakerKey?: string;
    homeOdds: number;
    drawOdds: number;
    awayOdds: number;
    spreadHome?: number;
    spreadAway?: number;
    spreadLine?: number;
  }[];
  bestHome: number;
  bestDraw: number;
  bestAway: number;
  pinnacleHome?: number;
  pinnacleDraw?: number;
  pinnacleAway?: number;
}

interface CacheMatch {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  pinnacleHome?: number;
  pinnacleDraw?: number;
  pinnacleAway?: number;
  pinnacleCloseHome?: number;
  pinnacleCloseDraw?: number;
  pinnacleCloseAway?: number;
  ahLine?: number;
  pinnacleAHHome?: number;
  pinnacleAHAway?: number;
  ahCloseLine?: number;
  pinnacleCloseAHHome?: number;
  pinnacleCloseAHAway?: number;
  [key: string]: unknown;
}

interface CacheFile {
  league: string;
  season: string;
  fetchedAt: string;
  matchCount: number;
  matches: CacheMatch[];
}

function normalizeName(name: string): string {
  return SNAPSHOT_TO_CACHE[name] || name;
}

function loadSnapshots(snapshotLeague: string): OddsSnapshot[] {
  const all: OddsSnapshot[] = [];
  if (!existsSync(SNAPSHOT_DIR)) return all;

  const files = readdirSync(SNAPSHOT_DIR).filter(
    (f) => f.startsWith(`${snapshotLeague}-`) && f.endsWith(".json")
  );

  for (const file of files) {
    try {
      const data: OddsSnapshot[] = JSON.parse(
        readFileSync(join(SNAPSHOT_DIR, file), "utf-8")
      );
      all.push(...data);
    } catch {
      console.warn(`  Warning: could not parse ${file}`);
    }
  }

  return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// Group snapshots by match (matchId) and take last pre-kickoff snapshot
function buildClosingOdds(snapshots: OddsSnapshot[]): Map<string, OddsSnapshot> {
  // Group by matchId
  const byMatch = new Map<string, OddsSnapshot[]>();
  for (const snap of snapshots) {
    const key = snap.matchId;
    if (!byMatch.has(key)) byMatch.set(key, []);
    byMatch.get(key)!.push(snap);
  }

  const closing = new Map<string, OddsSnapshot>();
  for (const [matchId, snaps] of byMatch) {
    // Sort by timestamp ascending
    snaps.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const kickoff = snaps[0].commenceTime;

    // Take last snapshot before kickoff
    const preKickoff = snaps.filter((s) => s.timestamp < kickoff);
    const best = preKickoff.length > 0 ? preKickoff[preKickoff.length - 1] : snaps[snaps.length - 1];

    // Build a key from normalized team names for matching
    const homeNorm = normalizeName(best.homeTeam).toLowerCase();
    const awayNorm = normalizeName(best.awayTeam).toLowerCase();
    const dateKey = best.commenceTime.slice(0, 10); // YYYY-MM-DD
    const matchKey = `${dateKey}|${homeNorm}|${awayNorm}`;

    closing.set(matchKey, best);
  }

  return closing;
}

function matchCacheToSnapshot(
  match: CacheMatch,
  closingMap: Map<string, OddsSnapshot>
): OddsSnapshot | undefined {
  const homeNorm = match.homeTeam.toLowerCase();
  const awayNorm = match.awayTeam.toLowerCase();
  const dateKey = match.date; // YYYY-MM-DD

  // Try exact date match
  const key = `${dateKey}|${homeNorm}|${awayNorm}`;
  if (closingMap.has(key)) return closingMap.get(key);

  // Try ±1 day (kickoff might be just after midnight UTC vs local date)
  const d = new Date(dateKey + "T12:00:00Z");
  for (const offset of [-1, 1]) {
    const alt = new Date(d.getTime() + offset * 86400000);
    const altKey = `${alt.toISOString().slice(0, 10)}|${homeNorm}|${awayNorm}`;
    if (closingMap.has(altKey)) return closingMap.get(altKey);
  }

  return undefined;
}

function main() {
  let totalPatched = 0;
  let totalMissing = 0;
  let totalMatched = 0;

  for (const [snapshotLeague, cachePrefix] of Object.entries(LEAGUE_MAP)) {
    const cacheFile = join(CACHE_DIR, `${cachePrefix}-2025-26.json`);
    if (!existsSync(cacheFile)) {
      console.log(`Skipping ${snapshotLeague}: no cache file ${cachePrefix}-2025-26.json`);
      continue;
    }

    console.log(`\n=== ${snapshotLeague} (${cachePrefix}-2025-26.json) ===`);

    const cache: CacheFile = JSON.parse(readFileSync(cacheFile, "utf-8"));
    const snapshots = loadSnapshots(snapshotLeague);
    console.log(`  Loaded ${snapshots.length} snapshots from ${snapshotLeague}-*.json`);

    if (snapshots.length === 0) {
      console.log("  No snapshots found, skipping.");
      continue;
    }

    const closingMap = buildClosingOdds(snapshots);
    console.log(`  Built closing odds for ${closingMap.size} unique matches`);

    // Find matches missing Pinnacle
    const missing = cache.matches.filter(
      (m) => !(m.pinnacleHome && m.pinnacleHome > 0)
    );
    console.log(`  Matches missing Pinnacle: ${missing.length} / ${cache.matches.length}`);
    totalMissing += missing.length;

    let patched = 0;
    for (const match of missing) {
      const snap = matchCacheToSnapshot(match, closingMap);
      if (!snap) continue;

      totalMatched++;

      // Extract 1X2 odds
      const pH = snap.pinnacleHome;
      const pD = snap.pinnacleDraw;
      const pA = snap.pinnacleAway;

      if (!pH || pH <= 0) continue;

      // Patch 1X2
      match.pinnacleHome = pH;
      match.pinnacleDraw = pD || 0;
      match.pinnacleAway = pA || 0;

      // Use as closing proxy (last pre-kickoff snapshot ≈ closing)
      match.pinnacleCloseHome = pH;
      match.pinnacleCloseDraw = pD || 0;
      match.pinnacleCloseAway = pA || 0;

      // Extract AH from Pinnacle bookmaker entry
      const pinnacleBook = snap.bookmakers.find((b) => b.bookmaker === "Pinnacle");
      if (pinnacleBook && pinnacleBook.spreadHome && pinnacleBook.spreadLine !== undefined) {
        match.ahLine = pinnacleBook.spreadLine;
        match.pinnacleAHHome = pinnacleBook.spreadHome;
        match.pinnacleAHAway = pinnacleBook.spreadAway || 0;

        // Closing AH proxy
        match.ahCloseLine = pinnacleBook.spreadLine;
        match.pinnacleCloseAHHome = pinnacleBook.spreadHome;
        match.pinnacleCloseAHAway = pinnacleBook.spreadAway || 0;
      }

      patched++;
      if (patched <= 5) {
        console.log(
          `    Patched: ${match.date} ${match.homeTeam} v ${match.awayTeam} → P(${pH}/${pD}/${pA})` +
          (pinnacleBook?.spreadLine !== undefined ? ` AH(${pinnacleBook.spreadLine})` : "")
        );
      }
    }

    if (patched > 5) {
      console.log(`    ... and ${patched - 5} more`);
    }

    console.log(`  Patched: ${patched} / ${missing.length} missing`);
    totalPatched += patched;

    if (patched > 0) {
      writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
      console.log(`  Wrote updated cache to ${cachePrefix}-2025-26.json`);
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Total missing Pinnacle: ${totalMissing}`);
  console.log(`Total matched to snapshots: ${totalMatched}`);
  console.log(`Total patched: ${totalPatched}`);
}

main();
