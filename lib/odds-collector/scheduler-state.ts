/**
 * Persistent state for the odds collection scheduler.
 * Uses storage adapter (file locally, Vercel Blob in production).
 */

import type { SchedulerState } from "./scheduler";
import { getStorage } from "./storage";

export async function loadSchedulerState(): Promise<SchedulerState> {
  return getStorage().loadSchedulerState();
}

export async function saveSchedulerState(state: SchedulerState): Promise<void> {
  await getStorage().saveSchedulerState(state);
}

export async function recordPoll(league: string, requestsUsed: number): Promise<SchedulerState> {
  const state = await loadSchedulerState();
  const now = new Date().toISOString();
  const monthKey = now.slice(0, 7); // "YYYY-MM"

  state.lastPoll[league] = now;
  state.pollCount[monthKey] = (state.pollCount[monthKey] || 0) + requestsUsed;

  await saveSchedulerState(state);
  return state;
}
