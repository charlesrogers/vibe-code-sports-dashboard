/**
 * Solve Latest MI Model Ratings
 *
 * Runs the MI-BP solver for all 4 leagues using current + previous season data.
 * Warm-starts from the most recent solver-cache snapshot if available.
 * Writes results to data/mi-params/latest/{league}.json for the API to read.
 *
 * Usage:
 *   npx tsx scripts/solve-latest.ts                   # all leagues
 *   npx tsx scripts/solve-latest.ts --leagues=epl      # single league
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { prepareMarketMatches } from "../lib/mi-model/data-prep";
import { solveRatings } from "../lib/mi-model/solver";
import type { MISolverConfig, MIModelParams } from "../lib/mi-model/types";
import { DEFAULT_SOLVER_CONFIG } from "../lib/mi-model/types";
import { MI_LEAGUES } from "../lib/mi-picks/league-config";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const dataDir = join(projectRoot, "data/football-data-cache");
const solverCacheDir = join(projectRoot, "data", "backtest", "solver-cache");
const outputDir = join(projectRoot, "data", "mi-params", "latest");

// ─── CLI args ────────────────────────────────────────────────────────────────

const leagueFilter = process.argv.find(a => a.startsWith("--leagues="))?.split("=")[1]?.split(",") ?? null;

const activeLeagues = leagueFilter
  ? MI_LEAGUES.filter(l => leagueFilter.includes(l.id))
  : MI_LEAGUES;

// ─── Warm-start: find most recent solver-cache snapshot ─────────────────────

function findLatestCacheSnapshot(leagueId: string): MIModelParams | null {
  if (!existsSync(solverCacheDir)) return null;
  const prefix = `${leagueId}_`;
  const files = readdirSync(solverCacheDir)
    .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
    .sort()
    .reverse();
  if (files.length === 0) return null;
  try {
    return JSON.parse(readFileSync(join(solverCacheDir, files[0]), "utf-8")) as MIModelParams;
  } catch {
    return null;
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

mkdirSync(outputDir, { recursive: true });

console.log("═══════════════════════════════════════════════════════════════════════");
console.log("  SOLVE LATEST — MI Model Ratings for Live Picks");
console.log("═══════════════════════════════════════════════════════════════════════\n");
console.log(`  Leagues: ${activeLeagues.map(l => l.id).join(", ")}`);
console.log(`  Output: ${outputDir}\n`);

const startTime = Date.now();

for (const league of activeLeagues) {
  const leagueStart = Date.now();
  console.log(`\n  ─── ${league.label} (${league.id}) ──────────────────────────────────\n`);

  // Load current + previous season data
  const rawMatches: any[] = [];
  for (const season of [league.currentSeason, league.previousSeason]) {
    const fp = join(dataDir, `${league.id}-${season}.json`);
    if (!existsSync(fp)) {
      console.log(`  [skip] No data file for ${league.id}-${season}`);
      continue;
    }
    try {
      const data = JSON.parse(readFileSync(fp, "utf-8"));
      console.log(`  Loaded ${data.matches?.length || 0} matches from ${season}`);
      rawMatches.push(...(data.matches || []));
    } catch (e) {
      console.log(`  [error] Failed to load ${fp}: ${e}`);
    }
  }

  if (rawMatches.length === 0) {
    console.log(`  [skip] No matches found for ${league.id}`);
    continue;
  }

  // Prepare market matches
  const trainData = {
    league: league.id,
    season: league.currentSeason,
    fetchedAt: new Date().toISOString(),
    matchCount: rawMatches.length,
    matches: rawMatches,
  };

  const prepared = prepareMarketMatches(trainData, {
    useClosing: true,
    requirePinnacle: true,
    referenceDate: new Date().toISOString().split("T")[0],
  });

  console.log(`  Prepared ${prepared.length} market matches (from ${rawMatches.length} raw)`);

  if (prepared.length < 50) {
    console.log(`  [skip] Too few matches (${prepared.length} < 50)`);
    continue;
  }

  // Warm-start from most recent solver-cache snapshot
  const prevParams = findLatestCacheSnapshot(league.id);
  let solveConfig: MISolverConfig;

  if (prevParams) {
    console.log(`  Warm-starting from cached snapshot (${Object.keys(prevParams.teams).length} teams)`);
    solveConfig = {
      ...DEFAULT_SOLVER_CONFIG,
      maxIterations: 80,   // fewer iterations needed with warm-start
      gridSteps: 20,
      printEvery: 10,
      initialRatings: Object.fromEntries(
        Object.entries(prevParams.teams).map(([t, r]) => [t, { attack: r.attack, defense: r.defense }])
      ),
      initialHomeAdvantage: prevParams.homeAdvantage,
      initialCorrelation: prevParams.correlation,
      initialAvgGoalRate: prevParams.avgGoalRate,
    };
  } else {
    console.log(`  Cold start (no cached snapshot found)`);
    solveConfig = {
      ...DEFAULT_SOLVER_CONFIG,
      maxIterations: 200,
      gridSteps: 40,
      printEvery: 20,
    };
  }

  // Solve
  const params = solveRatings(prepared, league.id, league.currentSeason, solveConfig);

  // Write output
  const outPath = join(outputDir, `${league.id}.json`);
  writeFileSync(outPath, JSON.stringify(params, null, 2));

  const elapsed = ((Date.now() - leagueStart) / 1000).toFixed(1);
  console.log(`\n  [done] ${league.id}: ${Object.keys(params.teams).length} teams, loss=${params.convergenceInfo.finalLoss.toFixed(6)}, ${elapsed}s`);
  console.log(`  Saved to ${outPath}`);
}

const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\n═══════════════════════════════════════════════════════════════════════`);
console.log(`  All done in ${totalElapsed}s`);
console.log(`═══════════════════════════════════════════════════════════════════════\n`);
