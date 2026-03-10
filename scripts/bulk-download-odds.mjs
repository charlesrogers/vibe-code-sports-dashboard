#!/usr/bin/env node
/**
 * Bulk download historical match data with odds from football-data.co.uk
 * Covers 18 leagues x 5 seasons = 90 files
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

const BASE_URL = 'https://www.football-data.co.uk/mmz4281';
const CACHE_DIR = join(import.meta.dirname, '..', 'data', 'football-data-cache');

const SEASONS = [
  { code: '2425', label: '2024-25' },
  { code: '2324', label: '2023-24' },
  { code: '2223', label: '2022-23' },
  { code: '2122', label: '2021-22' },
  { code: '2021', label: '2020-21' },
];

const DIVISIONS = [
  { code: 'E0', name: 'epl', country: 'uk' },
  { code: 'E1', name: 'championship', country: 'uk' },
  { code: 'E2', name: 'league-one', country: 'uk' },
  { code: 'E3', name: 'league-two', country: 'uk' },
  { code: 'SC0', name: 'scottish-prem', country: 'uk' },
  { code: 'I1', name: 'serie-a', country: 'it' },
  { code: 'I2', name: 'serie-b', country: 'it' },
  { code: 'SP1', name: 'la-liga', country: 'es' },
  { code: 'SP2', name: 'segunda', country: 'es' },
  { code: 'D1', name: 'bundesliga', country: 'de' },
  { code: 'D2', name: 'bundesliga-2', country: 'de' },
  { code: 'F1', name: 'ligue-1', country: 'fr' },
  { code: 'F2', name: 'ligue-2', country: 'fr' },
  { code: 'N1', name: 'eredivisie', country: 'nl' },
  { code: 'B1', name: 'belgian-pro', country: 'be' },
  { code: 'P1', name: 'portuguese-liga', country: 'pt' },
  { code: 'T1', name: 'turkish-super', country: 'tr' },
  { code: 'G1', name: 'greek-super', country: 'gr' },
];

// Team name normalization map for consistency
const TEAM_NAME_MAP = {
  // English
  "Man United": "Manchester United",
  "Man City": "Manchester City",
  "Nott'm Forest": "Nottingham Forest",
  "Nottingham": "Nottingham Forest",
  "Sheffield United": "Sheffield Utd",
  "Sheffield Weds": "Sheffield Wed",
  "Tottenham": "Tottenham",
  "Spurs": "Tottenham",
  "Wolves": "Wolverhampton",
  "West Ham": "West Ham",
  "Newcastle": "Newcastle",
  "QPR": "QPR",
  "Stoke": "Stoke",
  "Swansea": "Swansea",
  "West Brom": "West Brom",
  // Italian
  "Inter": "Inter Milan",
  "AC Milan": "AC Milan",
  "Verona": "Hellas Verona",
  // Spanish
  "Ath Madrid": "Atletico Madrid",
  "Ath Bilbao": "Athletic Bilbao",
  "Betis": "Real Betis",
  "Sociedad": "Real Sociedad",
  "La Coruna": "Deportivo La Coruna",
  // German
  "Dortmund": "Borussia Dortmund",
  "M'gladbach": "Monchengladbach",
  "Bayern Munich": "Bayern Munich",
  "Leverkusen": "Bayer Leverkusen",
  // French
  "Paris SG": "Paris Saint-Germain",
  "St Etienne": "Saint-Etienne",
};

function normalizeTeamName(name) {
  if (!name) return name;
  const trimmed = name.trim();
  return TEAM_NAME_MAP[trimmed] || trimmed;
}

function parseCSV(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];

  // Handle BOM
  let headerLine = lines[0];
  if (headerLine.charCodeAt(0) === 0xFEFF) {
    headerLine = headerLine.slice(1);
  }

  const headers = headerLine.split(',').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current.trim());

    if (values.length < 5) continue; // skip junk rows

    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] || '';
    }
    rows.push(row);
  }
  return rows;
}

function parseDate(dateStr) {
  if (!dateStr) return null;
  // football-data.co.uk uses DD/MM/YYYY or DD/MM/YY
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  let [d, m, y] = parts;
  if (y.length === 2) {
    y = parseInt(y) > 50 ? '19' + y : '20' + y;
  }
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function safeFloat(val) {
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

function safeInt(val) {
  const n = parseInt(val, 10);
  return isNaN(n) ? null : n;
}

function transformRow(row, league, season, country) {
  const date = parseDate(row.Date);
  const homeTeam = normalizeTeamName(row.HomeTeam || row.HT);
  const awayTeam = normalizeTeamName(row.AwayTeam || row.AT);
  const homeGoals = safeInt(row.FTHG);
  const awayGoals = safeInt(row.FTAG);
  const result = row.FTR || null;

  if (!date || !homeTeam || !awayTeam || homeGoals === null || awayGoals === null) {
    return null;
  }

  const match = {
    id: `${country}-${league}-${season}-${date}-${homeTeam}-${awayTeam}`.replace(/\s+/g, ' '),
    date,
    homeTeam,
    awayTeam,
    homeGoals,
    awayGoals,
    result,
    season,
    league,
    // Half-time
    htHomeGoals: safeInt(row.HTHG),
    htAwayGoals: safeInt(row.HTAG),
    // Match stats
    homeShots: safeInt(row.HS),
    awayShots: safeInt(row.AS),
    homeShotsOnTarget: safeInt(row.HST),
    awayShotsOnTarget: safeInt(row.AST),
    homeCorners: safeInt(row.HC),
    awayCorners: safeInt(row.AC),
    homeFouls: safeInt(row.HF),
    awayFouls: safeInt(row.AF),
    homeYellow: safeInt(row.HY),
    awayYellow: safeInt(row.AY),
    homeRed: safeInt(row.HR),
    awayRed: safeInt(row.AR),
    // Bet365 odds
    b365Home: safeFloat(row.B365H),
    b365Draw: safeFloat(row.B365D),
    b365Away: safeFloat(row.B365A),
    // Pinnacle odds
    pinnacleHome: safeFloat(row.PSH),
    pinnacleDraw: safeFloat(row.PSD),
    pinnacleAway: safeFloat(row.PSA),
    // Max odds
    maxHome: safeFloat(row.MaxH || row['BbMxH']),
    maxDraw: safeFloat(row.MaxD || row['BbMxD']),
    maxAway: safeFloat(row.MaxA || row['BbMxA']),
    // Average odds
    avgHome: safeFloat(row.AvgH || row['BbAvH']),
    avgDraw: safeFloat(row.AvgD || row['BbAvD']),
    avgAway: safeFloat(row.AvgA || row['BbAvA']),
    // Over/Under 2.5
    b365Over25: safeFloat(row['B365>2.5'] || row['BbMx>2.5']),
    b365Under25: safeFloat(row['B365<2.5'] || row['BbMx<2.5']),
    pinnacleOver25: safeFloat(row['P>2.5']),
    pinnacleUnder25: safeFloat(row['P<2.5']),
    avgOver25: safeFloat(row['Avg>2.5'] || row['BbAv>2.5']),
    avgUnder25: safeFloat(row['Avg<2.5'] || row['BbAv<2.5']),
  };

  return match;
}

async function downloadFile(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    if (resp.status === 404) return null;
    throw new Error(`HTTP ${resp.status} for ${url}`);
  }
  return await resp.text();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('=== Football-Data.co.uk Bulk Downloader ===\n');

  // Ensure cache dir exists
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`Cache directory: ${CACHE_DIR}\n`);

  const totalCombinations = DIVISIONS.length * SEASONS.length;
  console.log(`Will attempt ${totalCombinations} downloads (${DIVISIONS.length} leagues x ${SEASONS.length} seasons)\n`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let totalMatches = 0;
  const failures = [];
  let index = 0;

  for (const div of DIVISIONS) {
    for (const season of SEASONS) {
      index++;
      const filename = `${div.name}-${season.label}.json`;
      const filepath = join(CACHE_DIR, filename);

      // Check if already exists
      if (existsSync(filepath)) {
        console.log(`[${index}/${totalCombinations}] SKIP (exists): ${filename}`);
        skipped++;
        continue;
      }

      const url = `${BASE_URL}/${season.code}/${div.code}.csv`;
      console.log(`[${index}/${totalCombinations}] Downloading: ${div.name} ${season.label} ...`);

      try {
        const csvText = await downloadFile(url);
        if (csvText === null) {
          console.log(`  -> 404 Not Found (skipping)`);
          failures.push({ league: div.name, season: season.label, reason: '404' });
          failed++;
          continue;
        }

        const rows = parseCSV(csvText);
        if (rows.length === 0) {
          console.log(`  -> Empty CSV (skipping)`);
          failures.push({ league: div.name, season: season.label, reason: 'empty' });
          failed++;
          continue;
        }

        const matches = rows
          .map(r => transformRow(r, div.name, season.label, div.country))
          .filter(Boolean);

        const output = {
          league: div.name,
          season: season.label,
          fetchedAt: new Date().toISOString(),
          matchCount: matches.length,
          matches,
        };

        writeFileSync(filepath, JSON.stringify(output, null, 2));
        console.log(`  -> Saved ${matches.length} matches to ${filename}`);
        downloaded++;
        totalMatches += matches.length;

        // Small delay to be polite
        await sleep(300);
      } catch (err) {
        console.log(`  -> ERROR: ${err.message}`);
        failures.push({ league: div.name, season: season.label, reason: err.message });
        failed++;
      }
    }
  }

  // Summary
  console.log('\n========== SUMMARY ==========');
  console.log(`Total attempted: ${totalCombinations}`);
  console.log(`Downloaded:      ${downloaded}`);
  console.log(`Skipped (exist): ${skipped}`);
  console.log(`Failed/404:      ${failed}`);
  console.log(`Total matches:   ${totalMatches}`);

  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  - ${f.league} ${f.season}: ${f.reason}`);
    }
  }

  console.log('\nDone!');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
