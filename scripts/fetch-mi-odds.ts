/**
 * Fetch live odds for the 4 MI leagues (EPL, La Liga, Bundesliga, Serie A)
 * Uses API Key 2 (adhoc). Saves to data/live-odds/{oddsApiKey}-live-{date}.json
 */

import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

// Load .env.local
const envPath = join(import.meta.dirname || __dirname, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

import { fetchLiveOdds, getApiKey } from "../lib/odds-collector/the-odds-api";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const outDir = join(projectRoot, "data", "live-odds");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const LEAGUES = ["epl", "laLiga", "bundesliga", "serieA"];

async function main() {
  console.log("Fetching live odds for MI leagues...\n");

  const apiKey = getApiKey("adhoc");
  if (!apiKey) {
    console.error("No API key! Set THE_ODDS_API_KEY_2 in .env.local");
    process.exit(1);
  }

  const today = new Date().toISOString().split("T")[0];

  for (const league of LEAGUES) {
    console.log(`  ${league}...`);
    try {
      const snapshots = await fetchLiveOdds(league, "h2h,totals,spreads", apiKey);
      const outPath = join(outDir, `${league}-live-${today}.json`);
      writeFileSync(outPath, JSON.stringify(snapshots, null, 2));
      console.log(`    ${snapshots.length} matches → ${outPath}`);
    } catch (e: any) {
      console.log(`    Error: ${e.message}`);
    }
  }

  console.log("\nDone!");
}

main().catch(console.error);
