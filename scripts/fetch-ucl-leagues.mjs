import fs from 'fs';

async function fetchAndCache(league, slug, season) {
  console.log(`Fetching ${league} (${slug}) season ${season}...`);
  const url = `https://understat.com/getLeagueData/${slug}/${season}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'X-Requested-With': 'XMLHttpRequest' }
  });
  if (res.status !== 200) { console.error(`${league}: HTTP ${res.status}`); return; }
  const data = await res.json();
  const teamCount = Object.keys(data.teams || {}).length;
  console.log(`${league}: got ${teamCount} teams`);

  const path = `./data/understat-cache/${league}-${season}.json`;
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
  console.log(`Saved: ${path}`);
}

await fetchAndCache('laLiga', 'La_liga', '2025');
await fetchAndCache('bundesliga', 'Bundesliga', '2025');
await fetchAndCache('ligue1', 'Ligue_1', '2025');
console.log('Done!');
