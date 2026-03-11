import { NextRequest, NextResponse } from "next/server";
import { collectAndSaveOdds, collectDeepOdds, getUpcomingEventIds, getApiKey } from "@/lib/odds-collector/the-odds-api";
import { shouldPollNow } from "@/lib/odds-collector/scheduler";
import { loadSchedulerState, recordPoll } from "@/lib/odds-collector/scheduler-state";

// This endpoint is called frequently (every 30min via Vercel cron or external cron).
// The SCHEDULER decides whether to actually poll based on kickoff proximity.
// This way we concentrate polls around match times, not waste them on idle days.

export async function GET(request: NextRequest) {
  // Optional: verify cron secret to prevent unauthorized triggers
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const state = await loadSchedulerState();
  const cronKey = getApiKey("adhoc"); // Key 2 — Key 1 reserved for paper-trade logger
  const results: Record<string, unknown> = { timestamp: new Date().toISOString(), apiKey: "key2 (dashboard)", actions: [] };
  const actions: unknown[] = [];

  for (const league of ["serieA", "serieB", "epl", "laLiga", "bundesliga"] as const) {
    try {
      // Get upcoming kickoff times
      const events = await getUpcomingEventIds(league);
      const kickoffs = events.map((e) => e.commence);

      const monthKey = new Date().toISOString().slice(0, 7);
      const monthlyCount = state.pollCount[monthKey] || 0;

      // Ask scheduler if we should poll
      const decision = shouldPollNow(league, kickoffs, state.lastPoll[league] || null, monthlyCount);

      if (!decision.shouldPoll) {
        actions.push({
          league,
          action: "skip",
          reason: decision.reason,
          tier: decision.tier,
          hoursToKickoff: decision.hoursToKickoff,
          nextPollIn: decision.nextPollIn,
        });
        continue;
      }

      // Execute the poll
      let requestsUsed = 0;
      let matchesCollected = 0;
      let deepEvents = 0;

      if (decision.mode === "deep") {
        // Deep: bulk + per-event for soonest matches
        const now = new Date().toISOString();
        const soonest = events
          .filter((e) => e.commence > now)
          .sort((a, b) => a.commence.localeCompare(b.commence))
          .slice(0, 3)
          .map((e) => e.id);

        const result = await collectDeepOdds(league, soonest, cronKey);
        requestsUsed = result.requestsUsed;
        matchesCollected = result.saved;
        deepEvents = result.deepEvents;
      } else {
        // Bulk: h2h + totals + spreads, all matches, 1 request
        const result = await collectAndSaveOdds(league, "h2h,totals,spreads", cronKey);
        requestsUsed = result.requestsUsed;
        matchesCollected = result.saved;
      }

      // Record the poll
      await recordPoll(league, requestsUsed);

      actions.push({
        league,
        action: "collected",
        mode: decision.mode,
        tier: decision.tier,
        hoursToKickoff: decision.hoursToKickoff,
        matchesCollected,
        deepEvents,
        requestsUsed,
      });
    } catch (e: any) {
      actions.push({ league, action: "error", error: e.message });
    }
  }

  results.actions = actions;

  // Include budget summary
  const updatedState = await loadSchedulerState();
  const monthKey = new Date().toISOString().slice(0, 7);
  results.budget = {
    monthlyUsed: updatedState.pollCount[monthKey] || 0,
    monthlyLimit: 500,
    remaining: 500 - (updatedState.pollCount[monthKey] || 0),
    note: "Key 2 quota (dashboard). Key 1 reserved for paper-trade logger.",
  };

  return NextResponse.json(results);
}
