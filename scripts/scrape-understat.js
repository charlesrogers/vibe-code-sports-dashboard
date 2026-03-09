/**
 * CLI script to scrape Understat venue-split xG data and save as JSON cache.
 *
 * Run manually or via cron: node scripts/scrape-understat.js [league]
 * Default league: serieA
 *
 * Output: data/xg-venue-split/{league}.json
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const LEAGUE_URLS = {
  serieA: 'https://understat.com/league/Serie_A',
  serieB: 'https://understat.com/league/Serie_B',
  premierLeague: 'https://understat.com/league/EPL',
  laLiga: 'https://understat.com/league/La_liga',
  bundesliga: 'https://understat.com/league/Bundesliga',
  ligue1: 'https://understat.com/league/Ligue_1',
};

// Simple team name normalization (maps Understat names to our canonical names)
const TEAM_MAP = {
  'AC Milan': 'Milan',
  'Hellas Verona': 'Verona',
  'Parma Calcio 1913': 'Parma',
};

function normalizeName(name) {
  return TEAM_MAP[name] || name;
}

async function scrapeLeague(league) {
  const url = LEAGUE_URLS[league];
  if (!url) throw new Error(`Unknown league: ${league}`);

  console.log(`Scraping ${league} from ${url}...`);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);

    const teamsData = await page.evaluate(() => window.teamsData);
    if (!teamsData) throw new Error('teamsData not found');

    const results = [];

    for (const [, team] of Object.entries(teamsData)) {
      const name = normalizeName(team.title);
      const homeMatches = team.history.filter(m => m.h_a === 'h');
      const awayMatches = team.history.filter(m => m.h_a === 'a');

      const agg = (matches) => ({
        xGFor: Math.round(matches.reduce((s, m) => s + m.xG, 0) * 100) / 100,
        xGAgainst: Math.round(matches.reduce((s, m) => s + m.xGA, 0) * 100) / 100,
        goalsFor: matches.reduce((s, m) => s + m.scored, 0),
        goalsAgainst: matches.reduce((s, m) => s + m.missed, 0),
        matches: matches.length,
      });

      const home = agg(homeMatches);
      const away = agg(awayMatches);
      const overall = agg(team.history);

      results.push({
        team: name,
        home: { ...home, xGDiff: Math.round((home.xGFor - home.xGAgainst) * 100) / 100 },
        away: { ...away, xGDiff: Math.round((away.xGFor - away.xGAgainst) * 100) / 100 },
        overall: { ...overall, xGDiff: Math.round((overall.xGFor - overall.xGAgainst) * 100) / 100 },
      });
    }

    results.sort((a, b) => b.overall.xGDiff - a.overall.xGDiff);

    // Save to data directory
    const outDir = path.join(__dirname, '..', 'data', 'xg-venue-split');
    fs.mkdirSync(outDir, { recursive: true });

    const output = {
      league,
      scrapedAt: new Date().toISOString(),
      teams: results,
    };

    const outPath = path.join(outDir, `${league}.json`);
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
    console.log(`Saved ${results.length} teams to ${outPath}`);

    // Print summary
    for (const t of results) {
      const hxGD = t.home.xGDiff;
      const axGD = t.away.xGDiff;
      const hVar = (t.home.goalsFor - t.home.goalsAgainst) - hxGD;
      const aVar = (t.away.goalsFor - t.away.goalsAgainst) - axGD;
      console.log(`  ${t.team.padEnd(16)} Home xGD: ${hxGD > 0 ? '+' : ''}${hxGD.toFixed(1).padStart(6)}  var: ${hVar > 0 ? '+' : ''}${hVar.toFixed(1).padStart(5)}  |  Away xGD: ${axGD > 0 ? '+' : ''}${axGD.toFixed(1).padStart(6)}  var: ${aVar > 0 ? '+' : ''}${aVar.toFixed(1).padStart(5)}`);
    }

    return output;
  } finally {
    await browser.close();
  }
}

const league = process.argv[2] || 'serieA';
scrapeLeague(league).catch(e => {
  console.error('Scrape failed:', e.message);
  process.exit(1);
});
