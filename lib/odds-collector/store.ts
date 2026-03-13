/**
 * Odds Snapshot Store
 *
 * Stores timestamped odds snapshots. Uses file-based storage locally
 * and Vercel Blob in production (see storage.ts for adapter).
 */

import { getStorage } from "./storage";

export interface BookmakerOdds {
  bookmaker: string;
  bookmakerKey?: string;
  homeOdds: number;
  drawOdds: number;
  awayOdds: number;
  overOdds?: number;   // over 2.5
  underOdds?: number;  // under 2.5
  overLine?: number;   // e.g. 2.5
  bttsYes?: number;    // both teams to score yes
  bttsNo?: number;     // both teams to score no
  spreadHome?: number; // asian handicap home odds
  spreadAway?: number; // asian handicap away odds
  spreadLine?: number; // e.g. -0.5
  altTotals?: { line: number; over: number; under?: number }[];
  goalscorers?: { player: string; odds: number }[];
}

export interface OddsSnapshot {
  timestamp: string;
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: BookmakerOdds[];
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
  openingHome?: number;
  openingDraw?: number;
  openingAway?: number;
  closingHome?: number;
  closingDraw?: number;
  closingAway?: number;
  lineMovementHome?: number;
  lineMovementDraw?: number;
  lineMovementAway?: number;
}

/**
 * Save a batch of odds snapshots
 */
export async function saveSnapshots(league: string, snapshots: OddsSnapshot[]): Promise<void> {
  await getStorage().saveSnapshots(league, snapshots);
}

/**
 * Save latest live odds for a league (used by picks engine)
 */
export async function saveLiveOdds(league: string, matches: OddsSnapshot[]): Promise<void> {
  await getStorage().saveLiveOdds(league, matches);
}

/**
 * Load latest live odds for a league
 */
export async function loadLiveOdds(league: string): Promise<OddsSnapshot[]> {
  return getStorage().loadLiveOdds(league);
}

/**
 * Load all snapshots for a league in a date range
 */
export async function loadSnapshots(
  league: string,
  fromDate?: string,
  toDate?: string
): Promise<OddsSnapshot[]> {
  return getStorage().loadSnapshots(league, fromDate, toDate);
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
export async function getCollectionStats(league: string): Promise<{
  totalSnapshots: number;
  uniqueMatches: number;
  dateRange: { from: string; to: string } | null;
  avgSnapshotsPerMatch: number;
}> {
  const all = await loadSnapshots(league);
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
