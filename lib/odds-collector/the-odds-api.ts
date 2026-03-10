/**
 * The Odds API client
 *
 * Free tier: 500 requests/month, no credit card
 * Returns live odds from 59 bookmakers across 4 regions (eu,uk,us,au)
 *
 * Two endpoints:
 * 1. BULK (/sports/{key}/odds/) — ALL matches, 1 request
 *    Markets: h2h, totals, spreads (combinable = still 1 request)
 *    This is the workhorse for daily collection.
 *
 * 2. PER-EVENT (/sports/{key}/events/{id}/odds/) — 1 match, 1 request
 *    Markets: h2h, totals, spreads, btts, alternate_totals, player_goal_scorer_anytime
 *    Use selectively for deep data on specific matches.
 *
 * Budget (500 free/month):
 *   Bulk: Serie A + B, 3x + 2x/day = 5 req/day = 150/month
 *   Per-event: ~10 key matches/week × 4 = ~40/month
 *   Total: ~190/month, well within budget
 *
 * Sign up at: https://the-odds-api.com/
 * Set ODDS_API_KEY in .env.local
 */

import { normalizeTeamName } from "../team-mapping";
import { type OddsSnapshot, type BookmakerOdds, saveSnapshots } from "./store";

const BASE_URL = "https://api.the-odds-api.com/v4";
const API_KEY = process.env.ODDS_API_KEY || "";

// The Odds API sport keys
const SPORT_KEYS: Record<string, string> = {
  serieA: "soccer_italy_serie_a",
  serieB: "soccer_italy_serie_b",
  epl: "soccer_epl",
};

interface OddsAPIResponse {
  id: string;
  sport_key: string;
  sport_title: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: {
    key: string;
    title: string;
    last_update: string;
    markets: {
      key: string;
      last_update: string;
      outcomes: {
        name: string;
        price: number;
        point?: number;
        description?: string; // player name for goalscorer markets
      }[];
    }[];
  }[];
}

/**
 * Normalize team names from The Odds API to our canonical names
 */
function normalizeOddsApiTeam(name: string): string {
  // The Odds API uses English names — map to our canonical
  const oddsApiMap: Record<string, string> = {
    "AC Milan": "Milan",
    "AC Monza": "Monza",
    "AS Roma": "Roma",
    "Atalanta BC": "Atalanta",
    "Bologna FC 1909": "Bologna",
    "Cagliari Calcio": "Cagliari",
    "Como 1907": "Como",
    "Empoli FC": "Empoli",
    "ACF Fiorentina": "Fiorentina",
    "Frosinone Calcio": "Frosinone",
    "Genoa CFC": "Genoa",
    "Hellas Verona FC": "Verona",
    "Inter Milan": "Inter",
    "Internazionale": "Inter",
    "FC Internazionale Milano": "Inter",
    "Juventus FC": "Juventus",
    "Juventus": "Juventus",
    "SS Lazio": "Lazio",
    "Lazio": "Lazio",
    "US Lecce": "Lecce",
    "SSC Napoli": "Napoli",
    "Napoli": "Napoli",
    "Parma Calcio 1913": "Parma",
    "Torino FC": "Torino",
    "Udinese Calcio": "Udinese",
    "Udinese": "Udinese",
    "Venezia FC": "Venezia",
    "US Salernitana 1919": "Salernitana",
    "US Sassuolo Calcio": "Sassuolo",
    "Sassuolo": "Sassuolo",
    "US Cremonese": "Cremonese",
    "AC Pisa 1909": "Pisa",
    // Serie B
    "SSC Bari": "Bari",
    "Palermo FC": "Palermo",
    "Spezia Calcio": "Spezia",
    "Spezia": "Spezia",
    "Sampdoria": "Sampdoria",
    "UC Sampdoria": "Sampdoria",
    "Brescia Calcio": "Brescia",
    "Catanzaro": "Catanzaro",
    "US Catanzaro": "Catanzaro",
    "FC Südtirol": "Sudtirol",
    "Sudtirol": "Sudtirol",
    "Modena FC": "Modena",
    "Reggiana": "Reggiana",
    "AC Reggiana 1919": "Reggiana",
    "Carrarese Calcio": "Carrarese",
    "Juve Stabia": "Juve Stabia",
    "Mantova": "Mantova",
    "Cesena": "Cesena",
    "Cesena FC": "Cesena",
    "Padova": "Padova",
    "Calcio Padova": "Padova",
    "Pescara": "Pescara",
    "Delfino Pescara": "Pescara",
    "Avellino": "Avellino",
    "US Avellino": "Avellino",
    "Virtus Entella": "Virtus Entella",
    "Cittadella": "Cittadella",
    "AS Cittadella": "Cittadella",
    "Cosenza Calcio": "Cosenza",
    "Cosenza": "Cosenza",
    // EPL teams
    "Arsenal FC": "Arsenal",
    "Arsenal": "Arsenal",
    "Aston Villa FC": "Aston Villa",
    "Aston Villa": "Aston Villa",
    "AFC Bournemouth": "Bournemouth",
    "Bournemouth": "Bournemouth",
    "Brentford FC": "Brentford",
    "Brentford": "Brentford",
    "Brighton and Hove Albion": "Brighton",
    "Brighton & Hove Albion": "Brighton",
    "Brighton": "Brighton",
    "Burnley FC": "Burnley",
    "Burnley": "Burnley",
    "Chelsea FC": "Chelsea",
    "Chelsea": "Chelsea",
    "Crystal Palace FC": "Crystal Palace",
    "Crystal Palace": "Crystal Palace",
    "Everton FC": "Everton",
    "Everton": "Everton",
    "Fulham FC": "Fulham",
    "Fulham": "Fulham",
    "Ipswich Town": "Ipswich",
    "Leeds United": "Leeds",
    "Leicester City": "Leicester",
    "Liverpool FC": "Liverpool",
    "Liverpool": "Liverpool",
    "Luton Town": "Luton",
    "Manchester City FC": "Manchester City",
    "Manchester City": "Manchester City",
    "Manchester United FC": "Manchester United",
    "Manchester United": "Manchester United",
    "Newcastle United FC": "Newcastle",
    "Newcastle United": "Newcastle",
    "Nottingham Forest FC": "Nottingham Forest",
    "Nottingham Forest": "Nottingham Forest",
    "Sheffield United FC": "Sheffield United",
    "Sheffield United": "Sheffield United",
    "Southampton FC": "Southampton",
    "Southampton": "Southampton",
    "Tottenham Hotspur FC": "Tottenham",
    "Tottenham Hotspur": "Tottenham",
    "Tottenham": "Tottenham",
    "West Ham United FC": "West Ham",
    "West Ham United": "West Ham",
    "West Ham": "West Ham",
    "Wolverhampton Wanderers FC": "Wolverhampton",
    "Wolverhampton Wanderers": "Wolverhampton",
    "Wolves": "Wolverhampton",
  };
  return oddsApiMap[name] || name;
}

/**
 * Fetch current odds from The Odds API
 */
export async function fetchLiveOdds(
  league: "serieA" | "serieB" | "epl" = "serieA",
  markets: string = "h2h" // "h2h" for 1X2, "totals" for O/U
): Promise<OddsSnapshot[]> {
  if (!API_KEY) {
    throw new Error("ODDS_API_KEY not set. Get a free key at https://the-odds-api.com/");
  }

  const sportKey = SPORT_KEYS[league];
  if (!sportKey) throw new Error(`Unknown league: ${league}`);

  // All 4 regions = 59 bookmakers instead of 25, same 1 API request
  const url = `${BASE_URL}/sports/${sportKey}/odds/?apiKey=${API_KEY}&regions=eu,uk,us,au&markets=${markets}&oddsFormat=decimal`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`The Odds API error ${res.status}: ${text}`);
  }

  // Track remaining quota from headers
  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  console.log(`Odds API quota: ${used} used, ${remaining} remaining this month`);

  const data: OddsAPIResponse[] = await res.json();
  const now = new Date().toISOString();

  return data.map((event) => {
    const bookmakers: BookmakerOdds[] = [];
    let bestHome = 0, bestDraw = 0, bestAway = 0;
    let pinnHome: number | undefined, pinnDraw: number | undefined, pinnAway: number | undefined;

    for (const bk of event.bookmakers) {
      const h2hMarket = bk.markets.find((m) => m.key === "h2h");
      if (!h2hMarket) continue;

      const homeOutcome = h2hMarket.outcomes.find((o) => o.name === event.home_team);
      const drawOutcome = h2hMarket.outcomes.find((o) => o.name === "Draw");
      const awayOutcome = h2hMarket.outcomes.find((o) => o.name === event.away_team);

      if (!homeOutcome || !awayOutcome) continue;

      const odds: BookmakerOdds = {
        bookmaker: bk.title,
        bookmakerKey: bk.key,
        homeOdds: homeOutcome.price,
        drawOdds: drawOutcome?.price || 0,
        awayOdds: awayOutcome.price,
      };

      // Check totals market if included
      const totalsMarket = bk.markets.find((m) => m.key === "totals");
      if (totalsMarket) {
        const over = totalsMarket.outcomes.find((o) => o.name === "Over" && o.point === 2.5);
        const under = totalsMarket.outcomes.find((o) => o.name === "Under" && o.point === 2.5);
        if (over) { odds.overOdds = over.price; odds.overLine = 2.5; }
        if (under) odds.underOdds = under.price;
      }

      // Check BTTS market
      const bttsMarket = bk.markets.find((m) => m.key === "btts");
      if (bttsMarket) {
        const yes = bttsMarket.outcomes.find((o) => o.name === "Yes");
        const no = bttsMarket.outcomes.find((o) => o.name === "No");
        if (yes) odds.bttsYes = yes.price;
        if (no) odds.bttsNo = no.price;
      }

      // Check spreads market (Asian Handicap)
      const spreadsMarket = bk.markets.find((m) => m.key === "spreads");
      if (spreadsMarket) {
        const homeSpread = spreadsMarket.outcomes.find((o) => o.name === event.home_team);
        const awaySpread = spreadsMarket.outcomes.find((o) => o.name === event.away_team);
        if (homeSpread) { odds.spreadHome = homeSpread.price; odds.spreadLine = homeSpread.point; }
        if (awaySpread) odds.spreadAway = awaySpread.price;
      }

      bookmakers.push(odds);

      // Track best odds
      if (odds.homeOdds > bestHome) bestHome = odds.homeOdds;
      if (odds.drawOdds > bestDraw) bestDraw = odds.drawOdds;
      if (odds.awayOdds > bestAway) bestAway = odds.awayOdds;

      // Track Pinnacle specifically
      if (bk.key === "pinnacle") {
        pinnHome = odds.homeOdds;
        pinnDraw = odds.drawOdds;
        pinnAway = odds.awayOdds;
      }
    }

    return {
      timestamp: now,
      matchId: event.id,
      homeTeam: normalizeOddsApiTeam(event.home_team),
      awayTeam: normalizeOddsApiTeam(event.away_team),
      commenceTime: event.commence_time,
      bookmakers,
      bestHome,
      bestDraw,
      bestAway,
      pinnacleHome: pinnHome,
      pinnacleDraw: pinnDraw,
      pinnacleAway: pinnAway,
    };
  });
}

/**
 * Fetch and save odds snapshot (call this on a schedule)
 * Pass comma-separated markets: "h2h", "h2h,totals", "h2h,totals,btts"
 * Each market = 1 API request
 */
// Core markets that can be combined in one call
const CORE_MARKETS = new Set(["h2h", "totals", "spreads"]);
// Additional markets that need separate calls
const EXTRA_MARKETS = new Set(["btts", "draw_no_bet"]);

export async function collectAndSaveOdds(
  league: "serieA" | "serieB" | "epl" = "serieA",
  markets: string = "h2h,totals"
): Promise<{ saved: number; marketsPolled: string[]; requestsUsed: number }> {
  const marketList = markets.split(",").map((m) => m.trim()).filter(Boolean);
  let requestsUsed = 0;
  let allSnapshots: OddsSnapshot[] = [];

  // Split into core (combinable) and extra (separate calls)
  const coreMarkets = marketList.filter((m) => CORE_MARKETS.has(m));
  const extraMarkets = marketList.filter((m) => EXTRA_MARKETS.has(m));

  // Fetch core markets in one call
  if (coreMarkets.length > 0) {
    try {
      const snapshots = await fetchLiveOdds(league, coreMarkets.join(","));
      allSnapshots = snapshots;
      requestsUsed++;
    } catch (e) {
      console.warn("Core markets fetch failed:", e);
    }
  }

  // Fetch extra markets separately (merge into existing snapshots)
  for (const extra of extraMarkets) {
    try {
      const extraSnaps = await fetchLiveOdds(league, extra);
      requestsUsed++;
      // Merge extra data into existing snapshots by matchId
      for (const snap of extraSnaps) {
        const existing = allSnapshots.find((s) => s.matchId === snap.matchId);
        if (existing) {
          // Merge bookmaker data
          for (const bk of snap.bookmakers) {
            const existingBk = existing.bookmakers.find((b) => b.bookmaker === bk.bookmaker);
            if (existingBk) {
              if (bk.bttsYes) existingBk.bttsYes = bk.bttsYes;
              if (bk.bttsNo) existingBk.bttsNo = bk.bttsNo;
              if (bk.spreadHome) existingBk.spreadHome = bk.spreadHome;
              if (bk.spreadAway) existingBk.spreadAway = bk.spreadAway;
              if (bk.spreadLine) existingBk.spreadLine = bk.spreadLine;
            } else {
              existing.bookmakers.push(bk);
            }
          }
        } else {
          allSnapshots.push(snap);
        }
      }
    } catch (e) {
      console.warn(`Extra market ${extra} fetch failed:`, e);
    }
  }

  if (allSnapshots.length > 0) {
    await saveSnapshots(league, allSnapshots);
  }

  return {
    saved: allSnapshots.length,
    marketsPolled: marketList,
    requestsUsed,
  };
}

// Extended markets only available on per-event endpoint
const EVENT_MARKETS = "h2h,totals,spreads,btts,alternate_totals,player_goal_scorer_anytime";

/**
 * Fetch deep odds for a single event (per-event endpoint)
 * Returns btts, alternate totals, goalscorer props — not available on bulk endpoint
 * Costs 1 API request per event
 */
export async function fetchEventOdds(
  league: "serieA" | "serieB" | "epl",
  eventId: string
): Promise<OddsSnapshot | null> {
  if (!API_KEY) throw new Error("ODDS_API_KEY not set");

  const sportKey = SPORT_KEYS[league];
  if (!sportKey) throw new Error(`Unknown league: ${league}`);

  const url = `${BASE_URL}/sports/${sportKey}/events/${eventId}/odds/?apiKey=${API_KEY}&regions=eu,uk,us,au&markets=${EVENT_MARKETS}&oddsFormat=decimal`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    console.warn(`Event odds error ${res.status}: ${text}`);
    return null;
  }

  const remaining = res.headers.get("x-requests-remaining");
  const used = res.headers.get("x-requests-used");
  console.log(`Odds API quota: ${used} used, ${remaining} remaining (event ${eventId})`);

  const event: OddsAPIResponse = await res.json();
  const now = new Date().toISOString();

  const bookmakers: BookmakerOdds[] = [];
  let bestHome = 0, bestDraw = 0, bestAway = 0;
  let pinnHome: number | undefined, pinnDraw: number | undefined, pinnAway: number | undefined;

  for (const bk of event.bookmakers) {
    const h2hMarket = bk.markets.find((m) => m.key === "h2h");
    if (!h2hMarket) continue;

    const homeOutcome = h2hMarket.outcomes.find((o) => o.name === event.home_team);
    const drawOutcome = h2hMarket.outcomes.find((o) => o.name === "Draw");
    const awayOutcome = h2hMarket.outcomes.find((o) => o.name === event.away_team);
    if (!homeOutcome || !awayOutcome) continue;

    const odds: BookmakerOdds = {
      bookmaker: bk.title,
      bookmakerKey: bk.key,
      homeOdds: homeOutcome.price,
      drawOdds: drawOutcome?.price || 0,
      awayOdds: awayOutcome.price,
    };

    // Totals
    const totalsMarket = bk.markets.find((m) => m.key === "totals");
    if (totalsMarket) {
      const over = totalsMarket.outcomes.find((o) => o.name === "Over" && o.point === 2.5);
      const under = totalsMarket.outcomes.find((o) => o.name === "Under" && o.point === 2.5);
      if (over) { odds.overOdds = over.price; odds.overLine = 2.5; }
      if (under) odds.underOdds = under.price;
    }

    // BTTS (available on per-event!)
    const bttsMarket = bk.markets.find((m) => m.key === "btts");
    if (bttsMarket) {
      const yes = bttsMarket.outcomes.find((o) => o.name === "Yes");
      const no = bttsMarket.outcomes.find((o) => o.name === "No");
      if (yes) odds.bttsYes = yes.price;
      if (no) odds.bttsNo = no.price;
    }

    // Spreads
    const spreadsMarket = bk.markets.find((m) => m.key === "spreads");
    if (spreadsMarket) {
      const homeSpread = spreadsMarket.outcomes.find((o) => o.name === event.home_team);
      const awaySpread = spreadsMarket.outcomes.find((o) => o.name === event.away_team);
      if (homeSpread) { odds.spreadHome = homeSpread.price; odds.spreadLine = homeSpread.point; }
      if (awaySpread) odds.spreadAway = awaySpread.price;
    }

    // Alternate totals (O/U at multiple lines)
    const altTotals = bk.markets.find((m) => m.key === "alternate_totals");
    if (altTotals) {
      odds.altTotals = [];
      const lines = new Map<number, { over: number; under?: number }>();
      for (const o of altTotals.outcomes) {
        if (o.point == null) continue;
        const existing = lines.get(o.point) || { over: 0 };
        if (o.name === "Over") existing.over = o.price;
        if (o.name === "Under") existing.under = o.price;
        lines.set(o.point, existing);
      }
      for (const [line, prices] of lines) {
        odds.altTotals.push({ line, over: prices.over, under: prices.under });
      }
      odds.altTotals.sort((a, b) => a.line - b.line);
    }

    // Player goalscorer props
    const goalscorer = bk.markets.find((m) => m.key === "player_goal_scorer_anytime");
    if (goalscorer) {
      odds.goalscorers = goalscorer.outcomes
        .filter((o) => o.price > 0)
        .map((o) => ({ player: o.description || o.name, odds: o.price }))
        .sort((a, b) => a.odds - b.odds);
    }

    bookmakers.push(odds);
    if (odds.homeOdds > bestHome) bestHome = odds.homeOdds;
    if (odds.drawOdds > bestDraw) bestDraw = odds.drawOdds;
    if (odds.awayOdds > bestAway) bestAway = odds.awayOdds;
    if (bk.key === "pinnacle") {
      pinnHome = odds.homeOdds;
      pinnDraw = odds.drawOdds;
      pinnAway = odds.awayOdds;
    }
  }

  return {
    timestamp: now,
    matchId: event.id,
    homeTeam: normalizeOddsApiTeam(event.home_team),
    awayTeam: normalizeOddsApiTeam(event.away_team),
    commenceTime: event.commence_time,
    bookmakers,
    bestHome,
    bestDraw,
    bestAway,
    pinnacleHome: pinnHome,
    pinnacleDraw: pinnDraw,
    pinnacleAway: pinnAway,
  };
}

/**
 * Deep collect: bulk all matches + per-event for selected matches
 * eventIds: specific match IDs to get deep data for (btts, alt totals, goalscorers)
 * If empty, only does the bulk collection
 */
export async function collectDeepOdds(
  league: "serieA" | "serieB" | "epl" = "serieA",
  eventIds: string[] = []
): Promise<{ saved: number; deepEvents: number; requestsUsed: number }> {
  let requestsUsed = 0;

  // 1. Bulk fetch all matches (h2h + totals + spreads) — 1 request
  let allSnapshots: OddsSnapshot[] = [];
  try {
    allSnapshots = await fetchLiveOdds(league, "h2h,totals,spreads");
    requestsUsed++;
  } catch (e) {
    console.warn("Bulk fetch failed:", e);
  }

  // 2. Per-event deep fetch for selected matches — 1 request each
  let deepCount = 0;
  for (const eventId of eventIds) {
    try {
      const deepSnap = await fetchEventOdds(league, eventId);
      requestsUsed++;
      if (!deepSnap) continue;
      deepCount++;

      // Merge deep data into bulk snapshot
      const existing = allSnapshots.find((s) => s.matchId === eventId);
      if (existing) {
        for (const bk of deepSnap.bookmakers) {
          const existingBk = existing.bookmakers.find(
            (b) => b.bookmakerKey === bk.bookmakerKey || b.bookmaker === bk.bookmaker
          );
          if (existingBk) {
            if (bk.bttsYes) existingBk.bttsYes = bk.bttsYes;
            if (bk.bttsNo) existingBk.bttsNo = bk.bttsNo;
            if (bk.altTotals?.length) existingBk.altTotals = bk.altTotals;
            if (bk.goalscorers?.length) existingBk.goalscorers = bk.goalscorers;
          } else {
            existing.bookmakers.push(bk);
          }
        }
      } else {
        allSnapshots.push(deepSnap);
      }
    } catch (e) {
      console.warn(`Deep fetch for ${eventId} failed:`, e);
    }
  }

  if (allSnapshots.length > 0) {
    await saveSnapshots(league, allSnapshots);
  }

  return { saved: allSnapshots.length, deepEvents: deepCount, requestsUsed };
}

/**
 * Get event IDs for upcoming matches (for selective deep collection)
 */
export async function getUpcomingEventIds(
  league: "serieA" | "serieB" | "epl" = "serieA"
): Promise<{ id: string; home: string; away: string; commence: string }[]> {
  if (!API_KEY) return [];
  const sportKey = SPORT_KEYS[league];
  if (!sportKey) return [];

  // Events endpoint is free (no quota cost)
  const url = `${BASE_URL}/sports/${sportKey}/events/?apiKey=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data: OddsAPIResponse[] = await res.json();
  return data.map((ev) => ({
    id: ev.id,
    home: normalizeOddsApiTeam(ev.home_team),
    away: normalizeOddsApiTeam(ev.away_team),
    commence: ev.commence_time,
  }));
}

/**
 * Check API key status and remaining quota
 */
export async function checkApiStatus(): Promise<{
  hasKey: boolean;
  remaining?: number;
  used?: number;
}> {
  if (!API_KEY) return { hasKey: false };

  try {
    // Use a cheap endpoint to check quota
    const res = await fetch(
      `${BASE_URL}/sports/?apiKey=${API_KEY}`
    );
    return {
      hasKey: true,
      remaining: parseInt(res.headers.get("x-requests-remaining") || "0"),
      used: parseInt(res.headers.get("x-requests-used") || "0"),
    };
  } catch {
    return { hasKey: true };
  }
}
