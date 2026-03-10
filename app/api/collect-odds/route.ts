import { NextRequest, NextResponse } from "next/server";
import { collectAndSaveOdds, collectDeepOdds, getUpcomingEventIds, checkApiStatus, getApiKey, checkAllKeysStatus } from "@/lib/odds-collector/the-odds-api";
import { calculateMonthlyCost, DEFAULT_CONFIG, AVAILABLE_MARKETS } from "@/lib/odds-collector/config";

// GET: Check API status + available markets + budget calculator + upcoming events
export async function GET(request: NextRequest) {
  const includeEvents = request.nextUrl.searchParams.get("events") === "true";
  const league = (request.nextUrl.searchParams.get("league") || "serieA") as "serieA" | "serieB";

  try {
    const status = await checkApiStatus();
    const allKeysStatus = await checkAllKeysStatus();
    const budget = calculateMonthlyCost(DEFAULT_CONFIG);

    const response: Record<string, unknown> = {
      status: status.hasKey ? "configured" : "no_api_key",
      ...status,
      keys: {
        key1_cron: allKeysStatus.key1,
        key2_adhoc: allKeysStatus.key2,
        totalRemaining: allKeysStatus.totalRemaining,
      },
      availableMarkets: AVAILABLE_MARKETS.map((m) => ({
        key: m.key,
        label: m.label,
        description: m.description,
        available: m.available,
      })),
      endpoints: {
        bulk: {
          description: "All matches in 1 request",
          markets: ["h2h", "totals", "spreads"],
          cost: "1 request",
        },
        perEvent: {
          description: "Single match deep data",
          markets: ["h2h", "totals", "spreads", "btts", "alternate_totals", "player_goal_scorer_anytime"],
          cost: "1 request per match",
        },
      },
      budget,
      setup: !status.hasKey
        ? "Get a free API key at https://the-odds-api.com/ and add ODDS_API_KEY to .env.local"
        : undefined,
    };

    if (includeEvents && status.hasKey) {
      response.upcomingEvents = await getUpcomingEventIds(league);
    }

    return NextResponse.json(response);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST: Trigger odds collection
// Params:
//   ?league=serieA — which league
//   ?mode=bulk — bulk collection (default): h2h+totals+spreads, all matches, 1 request
//   ?mode=deep — bulk + per-event for selected matches (btts, alt totals, goalscorers)
//   ?events=id1,id2 — specific event IDs for deep mode (if empty, deep collects next 3 soonest)
//   ?markets=h2h,totals — (legacy) market selection for bulk mode
export async function POST(request: NextRequest) {
  const league = (request.nextUrl.searchParams.get("league") || "serieA") as "serieA" | "serieB";
  const mode = request.nextUrl.searchParams.get("mode") || "bulk";
  // Manual/ad-hoc collection uses key 2 to preserve key 1 quota for cron
  const adhocKey = getApiKey("adhoc");

  try {
    if (mode === "deep") {
      // Deep mode: bulk + per-event for selected or soonest matches
      let eventIds = (request.nextUrl.searchParams.get("events") || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      // If no events specified, pick the next 3 soonest matches
      if (eventIds.length === 0) {
        const upcoming = await getUpcomingEventIds(league);
        const now = new Date().toISOString();
        const soonest = upcoming
          .filter((e) => e.commence > now)
          .sort((a, b) => a.commence.localeCompare(b.commence))
          .slice(0, 3);
        eventIds = soonest.map((e) => e.id);
      }

      const result = await collectDeepOdds(league, eventIds, adhocKey);
      return NextResponse.json({
        success: true,
        mode: "deep",
        league,
        apiKey: "key2 (adhoc)",
        matchesCollected: result.saved,
        deepEventsCollected: result.deepEvents,
        requestsUsed: result.requestsUsed,
        eventIds,
        timestamp: new Date().toISOString(),
      });
    }

    // Bulk mode (default): h2h + totals + spreads, all matches, 1 request
    const markets = request.nextUrl.searchParams.get("markets") || "h2h,totals,spreads";
    const result = await collectAndSaveOdds(league, markets, adhocKey);
    return NextResponse.json({
      success: true,
      mode: "bulk",
      league,
      apiKey: "key2 (adhoc)",
      markets: result.marketsPolled,
      matchesCollected: result.saved,
      requestsUsed: result.requestsUsed,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
