/**
 * Odds Collection Configuration
 *
 * Controls which leagues, markets, and bookmakers to track.
 * Each market adds 1 API request per poll — budget accordingly.
 *
 * Actually available markets from The Odds API for Serie A/B:
 * - h2h: Match winner (1X2) — the core market
 * - totals: Over/Under goals (2.5 default)
 * - spreads: Asian Handicap / Point Spread
 * All three are combinable in a single API call (1 request).
 *
 * NOT available for Italian football (API returns INVALID_MARKET):
 * - btts: Both Teams to Score
 * - draw_no_bet: Match winner excl. draw
 *
 * Budget calculator (1000 total: 500/key × 2 keys):
 *   Key 1 (cron): leagues × markets × polls_per_day × 30
 *   Key 2 (adhoc): manual collection, backfill, testing
 * Example: 2 leagues × 3 markets × 2x/day × 30 = 360/month on key 1 ✓
 */

export interface CollectionConfig {
  leagues: LeagueConfig[];
  // Bookmakers to prioritize (Pinnacle = sharpest)
  priorityBooks: string[];
  // Min edge to flag as value bet (probability points)
  minEdgeForAlert: number;
}

export interface LeagueConfig {
  key: string;
  label: string;
  enabled: boolean;
  markets: MarketConfig[];
  pollsPerDay: number;
}

export interface MarketConfig {
  key: string;           // API market key
  label: string;
  enabled: boolean;
  available: boolean;    // false if API doesn't support for Italian football
  description: string;
}

export const AVAILABLE_MARKETS: MarketConfig[] = [
  {
    key: "h2h",
    label: "1X2 (Match Winner)",
    enabled: true,
    available: true,
    description: "Home/Draw/Away — the core market. Most liquid, best for CLV tracking.",
  },
  {
    key: "totals",
    label: "Over/Under Goals",
    enabled: true,
    available: true,
    description: "Over/Under 2.5 goals. High-volume market. Combinable with h2h (1 request).",
  },
  {
    key: "spreads",
    label: "Asian Handicap",
    enabled: false,
    available: true,
    description: "Point spreads. Lower margin than 1X2. Combinable with h2h (1 request).",
  },
  {
    key: "btts",
    label: "Both Teams to Score",
    enabled: false,
    available: false,
    description: "Not available for Italian football on The Odds API.",
  },
  {
    key: "draw_no_bet",
    label: "Draw No Bet",
    enabled: false,
    available: false,
    description: "Not available for Italian football on The Odds API.",
  },
];

export const DEFAULT_CONFIG: CollectionConfig = {
  leagues: [
    {
      key: "serieA",
      label: "Serie A",
      enabled: true,
      markets: AVAILABLE_MARKETS.map((m) => ({ ...m })),
      pollsPerDay: 3,
    },
    {
      key: "serieB",
      label: "Serie B",
      enabled: true,
      markets: AVAILABLE_MARKETS.map((m) => ({
        ...m,
        // Only h2h for Serie B by default (save quota)
        enabled: m.key === "h2h",
      })),
      pollsPerDay: 2,
    },
    {
      key: "epl",
      label: "Premier League",
      enabled: true,
      markets: AVAILABLE_MARKETS.map((m) => ({
        ...m,
        enabled: m.key === "h2h",
      })),
      pollsPerDay: 2,
    },
    {
      key: "championship",
      label: "Championship",
      enabled: true,
      markets: AVAILABLE_MARKETS.map((m) => ({
        ...m,
        enabled: m.key === "h2h",
      })),
      pollsPerDay: 1,
    },
    {
      key: "ucl",
      label: "Champions League",
      enabled: true,
      markets: AVAILABLE_MARKETS.map((m) => ({
        ...m,
        enabled: m.key === "h2h",
      })),
      pollsPerDay: 1,
    },
    {
      key: "laLiga",
      label: "La Liga",
      enabled: true,
      markets: AVAILABLE_MARKETS.map((m) => ({
        ...m,
        enabled: m.key === "h2h",
      })),
      pollsPerDay: 2,
    },
    {
      key: "bundesliga",
      label: "Bundesliga",
      enabled: true,
      markets: AVAILABLE_MARKETS.map((m) => ({
        ...m,
        enabled: m.key === "h2h",
      })),
      pollsPerDay: 2,
    },
  ],
  priorityBooks: [
    "pinnacle",    // Sharpest book — THE benchmark
    "betfair_ex_eu", // Exchange — true market price
    "williamhill",
    "bet365",
    "unibet_eu",
  ],
  minEdgeForAlert: 0.03, // 3% minimum edge
};

/**
 * Calculate monthly API cost for a config
 */
export function calculateMonthlyCost(config: CollectionConfig): {
  requestsPerDay: number;
  requestsPerMonth: number;
  withinFreeTier: boolean;
  breakdown: { league: string; markets: number; polls: number; daily: number }[];
} {
  const breakdown: { league: string; markets: number; polls: number; daily: number }[] = [];
  let totalDaily = 0;

  for (const league of config.leagues) {
    if (!league.enabled) continue;
    const enabledMarkets = league.markets.filter((m) => m.enabled).length;
    const daily = enabledMarkets * league.pollsPerDay;
    totalDaily += daily;
    breakdown.push({
      league: league.label,
      markets: enabledMarkets,
      polls: league.pollsPerDay,
      daily,
    });
  }

  const monthly = totalDaily * 30;
  return {
    requestsPerDay: totalDaily,
    requestsPerMonth: monthly,
    withinFreeTier: monthly <= 500,
    breakdown,
  };
}

/**
 * Get enabled markets for a league
 */
export function getEnabledMarkets(config: CollectionConfig, league: string): string[] {
  const leagueConfig = config.leagues.find((l) => l.key === league);
  if (!leagueConfig || !leagueConfig.enabled) return [];
  return leagueConfig.markets.filter((m) => m.enabled).map((m) => m.key);
}
