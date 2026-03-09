/**
 * Odds Snapshot Store
 *
 * Stores timestamped odds snapshots in a JSON file on disk.
 * Each snapshot captures odds from multiple bookmakers at a point in time.
 * Over time this builds our own line movement database.
 *
 * With 500 free API calls/month from The Odds API:
 * - Poll 3x/day = ~6 calls/day (Serie A + B, h2h + totals)
 * - ~180 calls/month, well within free tier
 * - Each call returns ALL upcoming matches for that league
 *
 * Storage: JSON file per league per month, ~50KB each
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data", "odds-snapshots");

export interface BookmakerOdds {
  bookmaker: string;
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
  overOdds?: number;  // over 2.5
  underOdds?: number; // under 2.5
}

export interface OddsSnapshot {
  timestamp: string;     // ISO datetime
  matchId: string;       // unique match identifier
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;  // match start time
  bookmakers: BookmakerOdds[];
  // Derived: best available odds
  bestHome: number;
  bestDraw: number;
  bestAway: number;
  pinnacleHome?: number;
  pinnacleDraw?: number;
  pinnacleAway?: number;
}

export interface MatchOddsHistory {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  snapshots: {
    timestamp: string;
    bestHome: number;
    bestDraw: number;
    bestAway: number;
    pinnacleHome?: number;
    pinnacleDraw?: number;
    pinnacleAway?: number;
    bookmakerCount: number;
  }[];
  // Derived
  openingHome?: number;
  openingDraw?: number;
  openingAway?: number;
  closingHome?: number;
  closingDraw?: number;
  closingAway?: number;
  lineMovementHome?: number;  // closing - opening
  lineMovementDraw?: number;
  lineMovementAway?: number;
}

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getFilePath(league: string, yearMonth: string): string {
  return join(DATA_DIR, `${league}-${yearMonth}.json`);
}

/**
 * Save a batch of odds snapshots
 */
export function saveSnapshots(league: string, snapshots: OddsSnapshot[]): void {
  ensureDir();
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const filePath = getFilePath(league, yearMonth);

  let existing: OddsSnapshot[] = [];
  if (existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      existing = [];
    }
  }

  existing.push(...snapshots);
  writeFileSync(filePath, JSON.stringify(existing, null, 2));
}

/**
 * Load all snapshots for a league in a date range
 */
export function loadSnapshots(
  league: string,
  fromDate?: string,
  toDate?: string
): OddsSnapshot[] {
  ensureDir();
  const all: OddsSnapshot[] = [];

  // Scan all files for this league
  const { readdirSync } = require("fs");
  const files = readdirSync(DATA_DIR) as string[];

  for (const file of files) {
    if (!file.startsWith(`${league}-`) || !file.endsWith(".json")) continue;

    try {
      const data: OddsSnapshot[] = JSON.parse(
        readFileSync(join(DATA_DIR, file), "utf-8")
      );
      for (const snap of data) {
        if (fromDate && snap.timestamp < fromDate) continue;
        if (toDate && snap.timestamp > toDate) continue;
        all.push(snap);
      }
    } catch {
      continue;
    }
  }

  return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

/**
 * Build line movement history for each match from snapshots
 */
export function buildMatchHistory(snapshots: OddsSnapshot[]): MatchOddsHistory[] {
  const byMatch = new Map<string, OddsSnapshot[]>();

  for (const snap of snapshots) {
    if (!byMatch.has(snap.matchId)) byMatch.set(snap.matchId, []);
    byMatch.get(snap.matchId)!.push(snap);
  }

  const histories: MatchOddsHistory[] = [];

  for (const [matchId, snaps] of byMatch) {
    const sorted = snaps.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    histories.push({
      matchId,
      homeTeam: first.homeTeam,
      awayTeam: first.awayTeam,
      commenceTime: first.commenceTime,
      snapshots: sorted.map((s) => ({
        timestamp: s.timestamp,
        bestHome: s.bestHome,
        bestDraw: s.bestDraw,
        bestAway: s.bestAway,
        pinnacleHome: s.pinnacleHome,
        pinnacleDraw: s.pinnacleDraw,
        pinnacleAway: s.pinnacleAway,
        bookmakerCount: s.bookmakers.length,
      })),
      openingHome: first.bestHome,
      openingDraw: first.bestDraw,
      openingAway: first.bestAway,
      closingHome: last.bestHome,
      closingDraw: last.bestDraw,
      closingAway: last.bestAway,
      lineMovementHome: last.bestHome - first.bestHome,
      lineMovementDraw: last.bestDraw - first.bestDraw,
      lineMovementAway: last.bestAway - first.bestAway,
    });
  }

  return histories.sort((a, b) => a.commenceTime.localeCompare(b.commenceTime));
}

/**
 * Get stats about our odds collection
 */
export function getCollectionStats(league: string): {
  totalSnapshots: number;
  uniqueMatches: number;
  dateRange: { from: string; to: string } | null;
  avgSnapshotsPerMatch: number;
} {
  const all = loadSnapshots(league);
  if (all.length === 0) {
    return { totalSnapshots: 0, uniqueMatches: 0, dateRange: null, avgSnapshotsPerMatch: 0 };
  }

  const matches = new Set(all.map((s) => s.matchId));
  return {
    totalSnapshots: all.length,
    uniqueMatches: matches.size,
    dateRange: {
      from: all[0].timestamp,
      to: all[all.length - 1].timestamp,
    },
    avgSnapshotsPerMatch: Math.round(all.length / matches.size * 10) / 10,
  };
}
