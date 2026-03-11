/**
 * Paper Trade Logger — Creates PaperBet records from MI picks
 *
 * Fetches fresh odds before generating picks so bets capture
 * current market lines. Runs multiple times per day with
 * time-windowed IDs; at the last window (19 UTC), keeps only
 * the bet with the best odds per match/market (best execution).
 */

import { generatePicks } from "../mi-picks/picks-engine";
import { appendBets, loadLedger, saveLedger } from "./storage";
import { collectAndSaveOdds, getApiKey } from "../odds-collector/the-odds-api";
import { MI_LEAGUES } from "../mi-picks/league-config";
import { PAPER_CONFIG, kellyStake, type PaperBet } from "./types";

const LAST_WINDOW_HOUR = 19; // UTC — triggers best execution

export async function logPicks(
  leagues?: string[]
): Promise<{ added: number; skipped: number; superseded: number; oddsTimestamp: string }> {
  // 1. Fetch fresh odds for each league
  const oddsTimestamp = new Date().toISOString();
  const apiKey = getApiKey("cron");
  const targetLeagues = leagues
    ? MI_LEAGUES.filter(l => leagues.includes(l.id))
    : MI_LEAGUES;

  for (const league of targetLeagues) {
    try {
      await collectAndSaveOdds(league.oddsApiKey, "h2h,totals,spreads", apiKey);
    } catch {
      // If odds fetch fails for a league, continue with cached data
    }
  }

  // 2. Generate picks using the fresh odds
  const { picks } = await generatePicks(leagues);
  const betPicks = picks.filter(p => p.tedVerdict === "BET");

  const evalHour = new Date().getUTCHours();
  const newBets: PaperBet[] = [];

  for (const pick of betPicks) {
    for (const vb of pick.valueBets) {
      // Time-windowed ID: same match can be logged at different eval windows
      const id = `${pick.date}_${pick.homeTeam}_vs_${pick.awayTeam}_${vb.marketType}_${vb.selection}_T${String(evalHour).padStart(2, "0")}`
        .replace(/\s+/g, "_");

      // Apply slippage: odds degrade by ~1% (line moves against you)
      const executionOdds = Math.round(
        (1 + (vb.marketOdds - 1) * (1 - PAPER_CONFIG.slippage)) * 1000
      ) / 1000;

      // Quarter Kelly sizing based on model edge
      const stake = kellyStake(vb.modelProb, executionOdds);

      newBets.push({
        id,
        createdAt: new Date().toISOString(),
        matchDate: pick.date,
        league: pick.league,
        homeTeam: pick.homeTeam,
        awayTeam: pick.awayTeam,
        marketType: vb.marketType,
        selection: vb.selection,
        ...(vb.ahLine != null && { ahLine: vb.ahLine }),
        stake,
        modelProb: vb.modelProb,
        marketOdds: vb.marketOdds,
        executionOdds,
        edge: vb.edge,
        confidenceGrade: pick.grade,
        oddsTimestamp,
        evalWindow: evalHour,
        status: "pending",
      });
    }
  }

  const { added, skipped } = await appendBets(newBets);

  // 3. Best execution: at last window, keep only best odds per match/market
  let superseded = 0;
  if (evalHour >= LAST_WINDOW_HOUR) {
    superseded = await applyBestExecution();
  }

  return { added, skipped, superseded, oddsTimestamp };
}

/**
 * For each match/market/selection today, keep only the bet with the
 * highest marketOdds. Mark the rest as "superseded".
 */
async function applyBestExecution(): Promise<number> {
  const ledger = await loadLedger();
  const today = new Date().toISOString().split("T")[0];

  const todayPending = ledger.bets.filter(
    b => b.status === "pending" && b.matchDate >= today
  );

  // Group by base ID (strip _T{HH} suffix)
  const groups = new Map<string, PaperBet[]>();
  for (const bet of todayPending) {
    const baseId = bet.id.replace(/_T\d{2}$/, "");
    if (!groups.has(baseId)) groups.set(baseId, []);
    groups.get(baseId)!.push(bet);
  }

  let superseded = 0;
  for (const [, bets] of groups) {
    if (bets.length <= 1) continue;
    // Sort by marketOdds descending — best odds first
    bets.sort((a, b) => b.marketOdds - a.marketOdds);
    for (let i = 1; i < bets.length; i++) {
      bets[i].status = "superseded";
      superseded++;
    }
  }

  if (superseded > 0) await saveLedger(ledger);
  return superseded;
}
