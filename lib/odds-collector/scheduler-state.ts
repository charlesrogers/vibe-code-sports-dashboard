/**
 * Persistent state for the odds collection scheduler.
 * Tracks when we last polled each league and monthly request counts.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { SchedulerState } from "./scheduler";

const DATA_DIR = join(process.cwd(), "data", "odds-snapshots");
const STATE_FILE = join(DATA_DIR, "_scheduler-state.json");

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

export function loadSchedulerState(): SchedulerState {
  ensureDir();
  if (!existsSync(STATE_FILE)) {
    return { lastPoll: {}, pollCount: {} };
  }
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return { lastPoll: {}, pollCount: {} };
  }
}

export function saveSchedulerState(state: SchedulerState): void {
  ensureDir();
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function recordPoll(league: string, requestsUsed: number): SchedulerState {
  const state = loadSchedulerState();
  const now = new Date().toISOString();
  const monthKey = now.slice(0, 7); // "YYYY-MM"

  state.lastPoll[league] = now;
  state.pollCount[monthKey] = (state.pollCount[monthKey] || 0) + requestsUsed;

  saveSchedulerState(state);
  return state;
}
