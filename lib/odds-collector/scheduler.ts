/**
 * Kickoff-Aware Odds Collection Scheduler
 *
 * Instead of polling at fixed intervals, this concentrates polls
 * around kickoff times where line movement actually happens.
 *
 * Polling tiers (hours before earliest kickoff in window):
 *   168-72h (7-3 days):  1x/day    — capture opening + early sharp action
 *   72-24h  (3-1 days):  2x/day    — syndicate + serious money
 *   24-6h   (match day): 3x/day    — public money, parlay flows
 *   6-2h    (pre-match): every 2h  — final news, late syndicate
 *   2-0h    (closing):   every 1h  — lineups, closing line
 *
 * Budget math (Serie A, ~4 matchdays/month, ~10 matches/matchday):
 *   Bulk endpoint = 1 request = ALL matches, so cost is per-poll not per-match.
 *   ~12 polls per matchday cycle × 4 matchdays = ~48 req/month for Serie A
 *   Same for Serie B = ~40 req/month
 *   Deep collect on key matches = ~30 req/month
 *   Total: ~120 req/month, well within 500 free tier
 */

import { getUpcomingEventIds } from "./the-odds-api";

export interface PollDecision {
  shouldPoll: boolean;
  reason: string;
  league: "serieA" | "serieB";
  hoursToKickoff: number | null;
  tier: string;
  nextPollIn: string; // human-readable
  mode: "bulk" | "deep";
  deepEventIds?: string[];
}

export interface SchedulerState {
  lastPoll: Record<string, string>; // league -> ISO timestamp of last poll
  pollCount: Record<string, number>; // "YYYY-MM" -> count
}

// How often (in hours) to poll at each tier
const POLL_INTERVALS: { maxHours: number; minHours: number; intervalHours: number; tier: string }[] = [
  { maxHours: 168, minHours: 72, intervalHours: 24, tier: "opening" },    // 7-3 days: 1x/day
  { maxHours: 72,  minHours: 24, intervalHours: 12, tier: "mid-week" },   // 3-1 day: 2x/day
  { maxHours: 24,  minHours: 6,  intervalHours: 8,  tier: "match-day" },  // 24-6h: 3x/day
  { maxHours: 6,   minHours: 2,  intervalHours: 2,  tier: "pre-match" },  // 6-2h: every 2h
  { maxHours: 2,   minHours: 0,  intervalHours: 1,  tier: "closing" },    // 2-0h: every hour
];

// Monthly budget per league
const MONTHLY_BUDGET_PER_LEAGUE = 200; // leaves 100 for deep + ad-hoc

/**
 * Determine if we should poll right now for a given league
 */
export function shouldPollNow(
  league: "serieA" | "serieB",
  upcomingKickoffs: string[], // ISO timestamps of upcoming match kickoffs
  lastPollTime: string | null, // ISO timestamp of last poll for this league
  monthlyPollCount: number = 0
): PollDecision {
  const now = new Date();
  const noPoll: PollDecision = {
    shouldPoll: false,
    reason: "",
    league,
    hoursToKickoff: null,
    tier: "none",
    nextPollIn: "",
    mode: "bulk",
  };

  // Budget check
  if (monthlyPollCount >= MONTHLY_BUDGET_PER_LEAGUE) {
    return { ...noPoll, reason: `Monthly budget exhausted (${monthlyPollCount}/${MONTHLY_BUDGET_PER_LEAGUE})` };
  }

  // Find hours until the EARLIEST upcoming kickoff
  const futureKickoffs = upcomingKickoffs
    .map((k) => new Date(k))
    .filter((k) => k > now)
    .sort((a, b) => a.getTime() - b.getTime());

  if (futureKickoffs.length === 0) {
    return { ...noPoll, reason: "No upcoming matches found" };
  }

  const nextKickoff = futureKickoffs[0];
  const hoursToKickoff = (nextKickoff.getTime() - now.getTime()) / (1000 * 60 * 60);

  // If next match is more than 7 days away, no need to poll
  if (hoursToKickoff > 168) {
    return {
      ...noPoll,
      hoursToKickoff: Math.round(hoursToKickoff),
      reason: `Next match in ${Math.round(hoursToKickoff / 24)} days — too far out`,
      nextPollIn: `${Math.round(hoursToKickoff - 168)} hours`,
    };
  }

  // Find which tier we're in
  const tier = POLL_INTERVALS.find(
    (t) => hoursToKickoff <= t.maxHours && hoursToKickoff > t.minHours
  );

  if (!tier) {
    // Match is about to start or already started
    return { ...noPoll, hoursToKickoff: Math.round(hoursToKickoff * 10) / 10, reason: "Match starting/started" };
  }

  // Check if enough time has passed since last poll
  if (lastPollTime) {
    const lastPoll = new Date(lastPollTime);
    const hoursSinceLastPoll = (now.getTime() - lastPoll.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastPoll < tier.intervalHours * 0.8) {
      // Allow 20% tolerance (e.g., 23h is close enough to 24h)
      const waitHours = Math.round((tier.intervalHours - hoursSinceLastPoll) * 10) / 10;
      return {
        ...noPoll,
        hoursToKickoff: Math.round(hoursToKickoff * 10) / 10,
        tier: tier.tier,
        reason: `Last poll ${Math.round(hoursSinceLastPoll * 10) / 10}h ago, interval is ${tier.intervalHours}h`,
        nextPollIn: `${waitHours} hours`,
      };
    }
  }

  // Should we do deep collection? Only in pre-match/closing tiers for the soonest matches
  const isDeepTier = tier.tier === "pre-match" || tier.tier === "closing";

  // Find matches kicking off within 6 hours (candidates for deep)
  const soonMatches = futureKickoffs
    .filter((k) => (k.getTime() - now.getTime()) / (1000 * 60 * 60) <= 6);

  return {
    shouldPoll: true,
    reason: `${tier.tier} tier: ${Math.round(hoursToKickoff * 10) / 10}h to kickoff`,
    league,
    hoursToKickoff: Math.round(hoursToKickoff * 10) / 10,
    tier: tier.tier,
    nextPollIn: `${tier.intervalHours} hours`,
    mode: isDeepTier && soonMatches.length <= 5 ? "deep" : "bulk",
  };
}

/**
 * Get full schedule decision for both leagues
 */
export async function getScheduleDecisions(
  state: SchedulerState
): Promise<{ serieA: PollDecision; serieB: PollDecision; budgetUsed: number; budgetRemaining: number }> {
  const monthKey = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const budgetUsed = state.pollCount[monthKey] || 0;

  // Fetch upcoming events for both leagues
  const [serieAEvents, serieBEvents] = await Promise.all([
    getUpcomingEventIds("serieA").catch(() => []),
    getUpcomingEventIds("serieB").catch(() => []),
  ]);

  const serieADecision = shouldPollNow(
    "serieA",
    serieAEvents.map((e) => e.commence),
    state.lastPoll.serieA || null,
    budgetUsed
  );

  const serieBDecision = shouldPollNow(
    "serieB",
    serieBEvents.map((e) => e.commence),
    state.lastPoll.serieB || null,
    budgetUsed
  );

  return {
    serieA: serieADecision,
    serieB: serieBDecision,
    budgetUsed,
    budgetRemaining: 500 - budgetUsed,
  };
}

/**
 * Format a schedule summary for display
 */
export function formatScheduleSummary(
  kickoffs: string[],
  lastPoll: string | null
): { upcoming: { match: string; hoursOut: number; tier: string }[]; nextPollDue: string } {
  const now = new Date();
  const upcoming = kickoffs
    .map((k) => {
      const dt = new Date(k);
      const hours = (dt.getTime() - now.getTime()) / (1000 * 60 * 60);
      const tier = POLL_INTERVALS.find((t) => hours <= t.maxHours && hours > t.minHours);
      return { match: k, hoursOut: Math.round(hours * 10) / 10, tier: tier?.tier || (hours > 168 ? "too-far" : "live") };
    })
    .filter((m) => m.hoursOut > 0)
    .sort((a, b) => a.hoursOut - b.hoursOut);

  // When is next poll due?
  const decision = shouldPollNow("serieA", kickoffs, lastPoll);
  return {
    upcoming,
    nextPollDue: decision.shouldPoll ? "now" : decision.nextPollIn || "unknown",
  };
}
