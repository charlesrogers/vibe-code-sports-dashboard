#!/usr/bin/env node

/**
 * Bulk download historical xG data from Understat.
 * Skips files that already exist in the cache.
 * Adds a 2-second delay between requests to avoid rate limiting.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, '..', 'data', 'understat-cache');
const META_PATH = path.join(CACHE_DIR, '_meta.json');

const LEAGUES = [
  { slug: 'EPL', key: 'premierLeague' },
  { slug: 'Serie_A', key: 'serieA' },
  { slug: 'La_liga', key: 'laLiga' },
  { slug: 'Bundesliga', key: 'bundesliga' },
  { slug: 'Ligue_1', key: 'ligue1' },
];

const SEASONS = [2020, 2021, 2022, 2023, 2024, 2025];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'X-Requested-With': 'XMLHttpRequest',
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('=== Understat Bulk xG Download ===');
  console.log(`Cache dir: ${CACHE_DIR}`);
  console.log(`Leagues: ${LEAGUES.map(l => l.key).join(', ')}`);
  console.log(`Seasons: ${SEASONS.join(', ')}`);
  console.log('');

  // Ensure cache dir exists
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // Load existing meta
  let meta = {};
  if (fs.existsSync(META_PATH)) {
    try {
      meta = JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
    } catch {
      meta = {};
    }
  }
  if (!meta.lastPull) meta.lastPull = {};

  // Build list of downloads needed
  const tasks = [];
  for (const league of LEAGUES) {
    for (const season of SEASONS) {
      const filename = `${league.key}-${season}.json`;
      const filepath = path.join(CACHE_DIR, filename);
      if (fs.existsSync(filepath)) {
        console.log(`[SKIP] ${filename} — already cached`);
      } else {
        tasks.push({ league, season, filename, filepath });
      }
    }
  }

  console.log('');
  console.log(`Total to download: ${tasks.length} files`);
  console.log(`Total already cached: ${LEAGUES.length * SEASONS.length - tasks.length} files`);
  console.log('');

  if (tasks.length === 0) {
    console.log('Nothing to download. All files are cached!');
    return;
  }

  // Download each
  let fetched = 0;
  let failed = 0;
  const failures = [];
  const teamCounts = {};

  for (let i = 0; i < tasks.length; i++) {
    const { league, season, filename, filepath } = tasks[i];
    const url = `https://understat.com/getLeagueData/${league.slug}/${season}`;

    console.log(`[${i + 1}/${tasks.length}] Fetching ${filename}...`);
    console.log(`  URL: ${url}`);

    try {
      const res = await fetch(url, { headers: HEADERS });
      console.log(`  Status: ${res.status}`);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }

      const text = await res.text();
      console.log(`  Response size: ${(text.length / 1024).toFixed(1)} KB`);

      // Validate it's JSON
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response (${text.length} bytes, starts with: ${text.slice(0, 100)})`);
      }

      // Count teams
      const teamCount = data.teams ? Object.keys(data.teams).length : 0;
      console.log(`  Teams: ${teamCount}`);
      teamCounts[filename] = teamCount;

      // Save full response
      fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
      console.log(`  Saved: ${filepath}`);

      // Update meta
      meta.lastPull[`${league.key}-${season}`] = new Date().toISOString();
      fetched++;
    } catch (err) {
      console.error(`  FAILED: ${err.message}`);
      failures.push({ filename, error: err.message });
      failed++;
    }

    // Delay between requests (skip after last)
    if (i < tasks.length - 1) {
      console.log('  Waiting 2s...');
      await sleep(2000);
    }

    console.log('');
  }

  // Save meta
  fs.writeFileSync(META_PATH, JSON.stringify(meta, null, 2));
  console.log(`Updated _meta.json`);

  // Summary
  console.log('');
  console.log('========== SUMMARY ==========');
  console.log(`Leagues covered: ${LEAGUES.map(l => l.key).join(', ')}`);
  console.log(`Seasons covered: ${SEASONS.join(', ')}`);
  console.log(`Files fetched: ${fetched}`);
  console.log(`Files failed: ${failed}`);
  console.log(`Files already cached: ${LEAGUES.length * SEASONS.length - tasks.length}`);
  console.log(`Total files in cache: ${fetched + (LEAGUES.length * SEASONS.length - tasks.length)}`);

  if (Object.keys(teamCounts).length > 0) {
    const totalTeams = Object.values(teamCounts).reduce((a, b) => a + b, 0);
    console.log(`Total team-seasons downloaded: ${totalTeams}`);
  }

  if (failures.length > 0) {
    console.log('');
    console.log('FAILURES:');
    for (const f of failures) {
      console.log(`  ${f.filename}: ${f.error}`);
    }
  }

  console.log('');
  console.log('Done!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
