/**
 * Manager change detection from Fotmob
 *
 * Ted: "A new manager changes everything — tactical system, player roles,
 * pressing intensity. Historical form data becomes unreliable."
 *
 * Detects recent manager changes by comparing current season's coach
 * with previous season's in Fotmob's coachHistory. Mid-season changes
 * (multiple coaches in the same season) are also detected.
 *
 * Data source: Fotmob team API (same endpoint as injuries)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ManagerInfo {
  name: string;
  isNewThisSeason: boolean;      // different from last season's manager
  isMidSeasonChange: boolean;    // multiple coaches this season
  seasonRecord: { win: number; draw: number; loss: number } | null;
  previousManager: string | null; // who they replaced
}

// ─── Fotmob team IDs (shared with injuries.ts) ─────────────────────────────
// Re-import would create circular dep risk; keep a reference to the same IDs

const FOTMOB_TEAM_IDS: Record<string, Record<string, number>> = {
  epl: {
    "Arsenal": 9825,
    "Man City": 8456, "Manchester City": 8456,
    "Man United": 10260, "Manchester United": 10260,
    "Aston Villa": 10252,
    "Chelsea": 8455,
    "Liverpool": 8650,
    "Brentford": 9937,
    "Everton": 8668,
    "Bournemouth": 8678, "AFC Bournemouth": 8678,
    "Fulham": 9879,
    "Sunderland": 8472,
    "Newcastle": 10261, "Newcastle United": 10261,
    "Crystal Palace": 9826,
    "Brighton": 10204, "Brighton and Hove Albion": 10204,
    "Leeds": 8463, "Leeds United": 8463,
    "Tottenham": 8586, "Tottenham Hotspur": 8586,
    "Nott'm Forest": 10203, "Nottingham Forest": 10203,
    "West Ham": 8654, "West Ham United": 8654,
    "Burnley": 8191,
    "Wolves": 8602, "Wolverhampton": 8602, "Wolverhampton Wanderers": 8602,
  },
  championship: {
    "Coventry": 8669, "Coventry City": 8669,
    "Middlesbrough": 8549,
    "Millwall": 10004,
    "Ipswich": 9902, "Ipswich Town": 9902,
    "Hull": 8667, "Hull City": 8667,
    "Wrexham": 9841, "Wrexham AFC": 9841,
    "Derby": 10170, "Derby County": 10170,
    "Southampton": 8466,
    "Watford": 9817,
    "Swansea": 10003, "Swansea City": 10003,
    "Bristol City": 8427,
    "Sheffield United": 8657, "Sheffield Utd": 8657,
    "Birmingham": 8658, "Birmingham City": 8658,
    "Preston": 8411, "Preston North End": 8411,
    "Stoke": 10194, "Stoke City": 10194,
    "QPR": 10172, "Queens Park Rangers": 10172,
    "Norwich": 9850, "Norwich City": 9850,
    "Charlton": 8451, "Charlton Athletic": 8451,
    "Portsmouth": 8462,
    "Blackburn": 8655, "Blackburn Rovers": 8655,
    "Leicester": 8197, "Leicester City": 8197,
    "West Brom": 8659, "West Bromwich Albion": 8659,
    "Oxford": 8653, "Oxford United": 8653,
    "Sheffield Weds": 10163, "Sheffield Wed": 10163, "Sheffield Wednesday": 10163,
  },
  "serie-a": {
    "Inter": 8636, "Milan": 8564, "Napoli": 9875,
    "Juventus": 9885, "Atalanta": 8524, "Roma": 8686,
    "Lazio": 8543, "Fiorentina": 8535, "Bologna": 9857,
    "Como": 10171, "Torino": 9804, "Genoa": 10233,
    "Udinese": 8600, "Cagliari": 8529, "Verona": 9876,
    "Parma": 10167, "Lecce": 9888, "Sassuolo": 7943,
    "Pisa": 6479, "Cremonese": 7801,
  },
  "la-liga": {
    "Real Madrid": 8633, "Barcelona": 8634, "Ath Madrid": 8302,
    "Atletico Madrid": 8302,
    "Ath Bilbao": 9906, "Athletic Bilbao": 9906,
    "Betis": 9600, "Real Betis": 9600,
    "Sociedad": 9740, "Real Sociedad": 9740,
    "Villarreal": 10205, "Mallorca": 8329, "RCD Mallorca": 8329,
    "Celta": 10243, "Celta Vigo": 10243,
    "Osasuna": 8371, "Sevilla": 8583,
    "Getafe": 8305, "Vallecano": 9768, "Rayo Vallecano": 9768,
    "Alaves": 9682, "Deportivo Alaves": 9682,
    "Leganes": 7942, "CD Leganes": 7942,
    "Las Palmas": 7626, "UD Las Palmas": 7626,
    "Girona": 7772, "Valencia": 10267,
    "Valladolid": 8077, "Espanyol": 8558,
  },
  bundesliga: {
    "Bayern Munich": 9823, "Dortmund": 9789, "Borussia Dortmund": 9789,
    "Leverkusen": 9871, "Bayer Leverkusen": 9871,
    "RB Leipzig": 178475,
    "Ein Frankfurt": 9810, "Eintracht Frankfurt": 9810,
    "Stuttgart": 10269, "VfB Stuttgart": 10269,
    "Freiburg": 9790, "SC Freiburg": 9790,
    "Wolfsburg": 9836, "VfL Wolfsburg": 9836,
    "M'gladbach": 9788, "Borussia Monchengladbach": 9788,
    "Mainz": 9905, "Augsburg": 9791, "FC Augsburg": 9791,
    "Hoffenheim": 9553, "TSG Hoffenheim": 9553,
    "Union Berlin": 36360,
    "St Pauli": 9776, "FC St. Pauli": 9776,
    "Heidenheim": 37042,
    "Bochum": 9911, "VfL Bochum": 9911,
    "Holstein Kiel": 9869,
  },
};

const LEAGUE_ALIASES: Record<string, string> = {
  serieA: "serie-a", "serie-a": "serie-a",
  epl: "epl", premierLeague: "epl",
  championship: "championship",
  "la-liga": "la-liga", laLiga: "la-liga",
  bundesliga: "bundesliga",
};

// ─── In-memory cache ────────────────────────────────────────────────────────

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const memCache = new Map<string, { data: ManagerInfo | null; ts: number }>();

function getCached(key: string): ManagerInfo | null | undefined {
  const entry = memCache.get(key);
  if (!entry || Date.now() - entry.ts > CACHE_TTL) return undefined;
  return entry.data;
}

// ─── Fotmob coach history parser ────────────────────────────────────────────

interface FotmobCoachEntry {
  id: number;
  name: string;
  season: string;      // "2025/2026"
  leagueId: number;
  leagueName: string;
  win: number;
  draw: number;
  loss: number;
  pointsPerGame: number;
  winPercentage: number;
}

function parseManagerInfo(coachHistory: FotmobCoachEntry[]): ManagerInfo | null {
  if (!coachHistory || coachHistory.length === 0) return null;

  // Find current season entries (last season in the list)
  const lastEntry = coachHistory[coachHistory.length - 1];
  const currentSeason = lastEntry.season;

  // All entries for current season
  const currentSeasonEntries = coachHistory.filter(e => e.season === currentSeason);
  const currentCoach = currentSeasonEntries[currentSeasonEntries.length - 1];

  // Previous season entries
  const prevSeasonEntries = coachHistory.filter(e => e.season !== currentSeason);
  const lastPrevCoach = prevSeasonEntries.length > 0
    ? prevSeasonEntries[prevSeasonEntries.length - 1]
    : null;

  // Detect changes
  const isMidSeasonChange = currentSeasonEntries.length > 1;
  const isNewThisSeason = lastPrevCoach ? lastPrevCoach.name !== currentCoach.name : false;

  // Who they replaced
  let previousManager: string | null = null;
  if (isMidSeasonChange) {
    // Replaced within the season
    previousManager = currentSeasonEntries[currentSeasonEntries.length - 2].name;
  } else if (isNewThisSeason && lastPrevCoach) {
    previousManager = lastPrevCoach.name;
  }

  return {
    name: currentCoach.name,
    isNewThisSeason,
    isMidSeasonChange,
    seasonRecord: {
      win: currentCoach.win,
      draw: currentCoach.draw,
      loss: currentCoach.loss,
    },
    previousManager,
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch manager info for a single team from Fotmob.
 * Uses the same team API endpoint as injuries.
 */
async function fetchTeamManager(
  teamName: string,
  fotmobId: number,
): Promise<ManagerInfo | null> {
  const cacheKey = `mgr-${fotmobId}`;
  const cached = getCached(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(
      `https://www.fotmob.com/api/teams?id=${fotmobId}&ccode3=USA`,
      { headers: { "User-Agent": "Mozilla/5.0" } },
    );
    if (!res.ok) return null;

    const data = await res.json();
    const coachHistory: FotmobCoachEntry[] = data?.history?.coachHistory || [];
    const info = parseManagerInfo(coachHistory);

    memCache.set(cacheKey, { data: info, ts: Date.now() });
    return info;
  } catch (e) {
    console.error(`[manager] Failed to fetch for ${teamName}:`, e);
    return null;
  }
}

/**
 * Batch-fetch manager info for a list of teams.
 * Rate-limited with 500ms between batches.
 */
export async function fetchManagersForTeams(
  teams: string[],
  league: string,
): Promise<Map<string, ManagerInfo | null>> {
  const leagueKey = LEAGUE_ALIASES[league] ?? league;
  const teamIds = FOTMOB_TEAM_IDS[leagueKey];
  const results = new Map<string, ManagerInfo | null>();
  if (!teamIds) return results;

  const toFetch: { name: string; id: number }[] = [];
  for (const team of teams) {
    let id = teamIds[team];
    if (!id) {
      const firstWord = team.split(" ")[0].toLowerCase();
      for (const [name, fid] of Object.entries(teamIds)) {
        if (name.toLowerCase().startsWith(firstWord)) { id = fid; break; }
      }
    }
    if (id) toFetch.push({ name: team, id });
  }

  // Fetch in batches of 5
  for (let i = 0; i < toFetch.length; i += 5) {
    const batch = toFetch.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(({ name, id }) => fetchTeamManager(name, id).then(info => ({ name, info }))),
    );
    for (const { name, info } of batchResults) {
      results.set(name, info);
    }
    if (i + 5 < toFetch.length) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  return results;
}
