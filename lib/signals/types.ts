/**
 * Signal Factory — Type Definitions
 *
 * Pure function interface for bet selection signals.
 * Each signal takes match context and returns a score + bet decision.
 */

import type { MatchPrediction, MIModelParams } from "../mi-model/types";
import type { TeamHistory } from "../mi-picks/ted-filters";

// ─── Core Signal Interface ──────────────────────────────────────────────────

export interface SignalInput {
  match: MatchData;
  prediction: MatchPrediction;
  params: MIModelParams;
  teamHistory: Record<string, TeamHistory>;
  teamMatchDates: Record<string, string[]>;
  seasonMatchday: number;
  odds: MatchOdds;
}

export interface SignalOutput {
  /** Score from 0-1 indicating signal strength (0 = no signal, 1 = strong) */
  score: number;
  /** Whether this signal says to bet */
  shouldBet: boolean;
  /** Optional metadata for debugging/attribution */
  meta?: Record<string, any>;
}

export interface Signal {
  /** Unique signal identifier (kebab-case) */
  id: string;
  /** Human-readable description */
  description: string;
  /** The signal function — pure, no side effects */
  evaluate: (input: SignalInput) => SignalOutput;
  /** Default parameters (signal-specific) */
  defaultParams?: Record<string, any>;
}

// ─── Match & Odds Data ──────────────────────────────────────────────────────

export interface MatchData {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  season: string;
  league: string;
}

export interface MatchOdds {
  /** Pinnacle closing 1X2 */
  pinnacleCloseHome?: number;
  pinnacleCloseDraw?: number;
  pinnacleCloseAway?: number;
  /** Pinnacle closing AH */
  ahLine?: number | null;
  pinnacleCloseAHHome?: number;
  pinnacleCloseAHAway?: number;
  /** Pinnacle closing O/U 2.5 */
  pinnacleCloseOver25?: number;
  pinnacleCloseUnder25?: number;
}

// ─── Bet Records ────────────────────────────────────────────────────────────

export interface BetRecord {
  league: string;
  season: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  marketType: "1X2" | "AH" | "OU25";
  selection: string;
  modelProb: number;
  closingImpliedProb: number;
  clv: number;
  closingOdds: number;
  homeGoals: number;
  awayGoals: number;
  totalGoals: number;
  won: boolean;
  profit: number;
  /** Which signals were active when this bet was placed */
  activeSignals?: string[];
}

// ─── Signal Registry ────────────────────────────────────────────────────────

export interface SignalRegistryEntry {
  id: string;
  registered: string;
  hypothesis: string;
  metric: string;
  threshold: string;
  status: "pending" | "testing" | "accepted" | "rejected" | "graveyard";
  result?: string;
  deployed?: string;
  deployedIn?: string;
  /** Auto-populated by test-signal.ts */
  backtestStats?: {
    standaloneROI: number;
    standaloneCLV: number;
    standaloneN: number;
    marginalROI?: number;
    correlationWithBase?: number;
    testedAt: string;
  };
}

// ─── Alpha Decomposition ────────────────────────────────────────────────────

export interface AlphaReport {
  signalId: string;
  /** ROI when running this signal alone */
  standaloneROI: number;
  standaloneCLV: number;
  standaloneN: number;
  standaloneHitRate: number;
  /** ROI improvement when adding this signal to the base set */
  marginalROI: number;
  /** ROI reduction when removing this signal from the full set */
  leaveOneOutDelta: number;
  /** Correlation of this signal's bets with the base signal set */
  overlapWithBase: number;
}
