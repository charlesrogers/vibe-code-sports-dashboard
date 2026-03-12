/**
 * Score Bets — check results for logged bets and track cumulative P/L
 *
 * Usage:
 *   npx tsx scripts/score-bets.ts                  # score all unscored bet logs
 *   npx tsx scripts/score-bets.ts 2026-03-10       # score specific date
 *   npx tsx scripts/score-bets.ts --summary        # show cumulative P/L summary
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const betLogDir = join(projectRoot, "data", "bet-log");
const cacheDir = join(projectRoot, "data", "football-data-cache");

// ─── Load match results from football-data cache ─────────────────────────────

interface MatchResult {
  homeTeam: string;
  awayTeam: string;
  date: string;
  fthg: number; // full-time home goals
  ftag: number; // full-time away goals
  result: "H" | "D" | "A";
}

function loadResults(): MatchResult[] {
  const results: MatchResult[] = [];
  const files = readdirSync(cacheDir).filter(f => f.endsWith(".json"));

  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(cacheDir, file), "utf-8"));

      // Handle both formats: { matches: [...] } and flat array [...]
      const matches = Array.isArray(raw) ? raw : (raw.matches || []);

      for (const m of matches) {
        // Format 1: Our normalized format (homeGoals/awayGoals)
        if (m.homeGoals != null && m.awayGoals != null) {
          results.push({
            homeTeam: m.homeTeam,
            awayTeam: m.awayTeam,
            date: m.date,
            fthg: m.homeGoals,
            ftag: m.awayGoals,
            result: m.result || (m.homeGoals > m.awayGoals ? "H" : m.homeGoals < m.awayGoals ? "A" : "D"),
          });
        }
        // Format 2: football-data.co.uk CSV format (FTHG/FTAG)
        else if (m.FTHG != null && m.FTAG != null) {
          results.push({
            homeTeam: m.HomeTeam,
            awayTeam: m.AwayTeam,
            date: m.Date,
            fthg: parseInt(m.FTHG),
            ftag: parseInt(m.FTAG),
            result: m.FTR,
          });
        }
      }
    } catch {}
  }
  return results;
}

/** Fetch live results from Fotmob leagues API (real-time, no delay) */
async function fetchFotmobResults(leagueIds: number[]): Promise<MatchResult[]> {
  const results: MatchResult[] = [];
  for (const lid of leagueIds) {
    try {
      const res = await fetch(
        `https://www.fotmob.com/api/leagues?id=${lid}&ccode3=USA`,
        { headers: { "User-Agent": "Mozilla/5.0" } },
      );
      if (!res.ok) continue;
      const data = await res.json();
      const allMatches = data?.fixtures?.allMatches || [];
      for (const m of allMatches) {
        if (!m.status?.finished) continue;
        const scoreStr = m.status?.scoreStr || "";
        const parts = scoreStr.split(" - ");
        if (parts.length !== 2) continue;
        const fthg = parseInt(parts[0]);
        const ftag = parseInt(parts[1]);
        if (isNaN(fthg) || isNaN(ftag)) continue;
        const date = (m.status?.utcTime || "").slice(0, 10);
        results.push({
          homeTeam: m.home?.name || "",
          awayTeam: m.away?.name || "",
          date,
          fthg,
          ftag,
          result: fthg > ftag ? "H" : fthg < ftag ? "A" : "D",
        });
      }
      console.log(`[PROGRESS] Fotmob league ${lid}: ${allMatches.filter((m: any) => m.status?.finished).length} finished matches`);
    } catch (e) {
      console.log(`[WARN] Fotmob league ${lid} fetch failed: ${e}`);
    }
  }
  return results;
}

// Fotmob league IDs for our bet leagues
const FOTMOB_LEAGUES = [47, 48, 55, 87, 54]; // EPL, Championship, Serie A, La Liga, Bundesliga

// ─── Bet grading logic ───────────────────────────────────────────────────────

// Normalize team names for fuzzy matching
function normalize(name: string): string {
  return name.toLowerCase()
    .replace(/\bfc\b/g, "")
    .replace(/\bcity\b/g, "")
    .replace(/\btown\b/g, "")
    .replace(/\bunited\b/g, "")
    .replace(/\brovers\b/g, "")
    .replace(/\bcounty\b/g, "")
    .replace(/\bwednesday\b/g, "wed")
    .replace(/\balbion\b/g, "")
    .replace(/\bpark rangers\b/g, "")
    .replace(/\bnorth end\b/g, "")
    .replace(/\bsaint[- ]germain\b/g, "")
    .replace(/\bathletic\b/g, "")
    .replace(/\bwanderers\b/g, "")
    .replace(/[^a-z]/g, "")
    .trim();
}

/** Parse "11 Mar" or "14 Mar" into month number for date matching */
function parseShortDate(dateStr: string): { day: number; month: number } | null {
  const months: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  const m = dateStr.match(/^(\d+)\s+(\w+)$/);
  if (!m) return null;
  const month = months[m[2].toLowerCase()];
  if (!month) return null;
  return { day: parseInt(m[1]), month };
}

function findMatch(bet: any, results: MatchResult[]): MatchResult | null {
  const parts = bet.match.split(" v ");
  if (parts.length !== 2) return null;
  const homeN = normalize(parts[0]);
  const awayN = normalize(parts[1]);

  // Parse bet date for filtering (optional — helps narrow results)
  const betDate = parseShortDate(bet.date);

  return results.find(r => {
    const rh = normalize(r.homeTeam);
    const ra = normalize(r.awayTeam);
    const teamMatch = (rh.includes(homeN) || homeN.includes(rh)) &&
                      (ra.includes(awayN) || awayN.includes(ra));
    if (!teamMatch) return false;

    // If we have date info, verify month/day match (handles "11 Mar" vs "2026-03-11")
    if (betDate && r.date.includes("-")) {
      const parts = r.date.split("-");
      const rMonth = parseInt(parts[1]);
      const rDay = parseInt(parts[2]);
      if (rMonth !== betDate.month || rDay !== betDate.day) return false;
    }

    return true;
  }) ?? null;
}

type BetOutcome = "win" | "loss" | "half_win" | "half_loss" | "push" | "pending";

function gradeBet(selection: string, match: MatchResult): { outcome: BetOutcome; profit: number; pinnacleOdds: number } & Record<string, any> {
  const hg = match.fthg;
  const ag = match.ftag;
  const diff = hg - ag; // positive = home won

  // Parse selection
  const sel = selection.trim();

  // Over/Under
  const ouMatch = sel.match(/^(Over|Under)\s+(\d+\.?\d*)$/i);
  if (ouMatch) {
    const overUnder = ouMatch[1].toLowerCase();
    const line = parseFloat(ouMatch[2]);
    const totalGoals = hg + ag;

    if (overUnder === "over") {
      if (totalGoals > line) return { outcome: "win", profit: 0, pinnacleOdds: 0 };
      if (totalGoals < line) return { outcome: "loss", profit: -1, pinnacleOdds: 0 };
      return { outcome: "push", profit: 0, pinnacleOdds: 0 };
    } else {
      if (totalGoals < line) return { outcome: "win", profit: 0, pinnacleOdds: 0 };
      if (totalGoals > line) return { outcome: "loss", profit: -1, pinnacleOdds: 0 };
      return { outcome: "push", profit: 0, pinnacleOdds: 0 };
    }
  }

  // Draw
  if (sel === "Draw") {
    return diff === 0
      ? { outcome: "win", profit: 0, pinnacleOdds: 0 }
      : { outcome: "loss", profit: -1, pinnacleOdds: 0 };
  }

  // ML (moneyline)
  const mlMatch = sel.match(/^(.+)\s+ML$/);
  if (mlMatch) {
    const team = mlMatch[1].trim();
    const isHome = normalize(team).length > 0 &&
      (normalize(match.homeTeam).includes(normalize(team)) || normalize(team).includes(normalize(match.homeTeam)));
    if (isHome) {
      return diff > 0 ? { outcome: "win", profit: 0, pinnacleOdds: 0 } : { outcome: "loss", profit: -1, pinnacleOdds: 0 };
    } else {
      return diff < 0 ? { outcome: "win", profit: 0, pinnacleOdds: 0 } : { outcome: "loss", profit: -1, pinnacleOdds: 0 };
    }
  }

  // Asian Handicap: "Team +0.5", "Team -1.5", "Team -0.75", etc.
  const ahMatch = sel.match(/^(.+)\s+([+-]?\d+\.?\d*)$/);
  if (ahMatch) {
    const team = ahMatch[1].trim();
    const line = parseFloat(ahMatch[2]);
    const isHome = normalize(team).length > 0 &&
      (normalize(match.homeTeam).includes(normalize(team)) || normalize(team).includes(normalize(match.homeTeam)));

    // Adjusted diff from the bet team's perspective
    const teamDiff = isHome ? diff : -diff;
    const adjusted = teamDiff + line;

    // Handle quarter lines (-0.75, -0.25, +0.25, +0.75)
    const isQuarterLine = Math.abs(line % 0.5) === 0.25;

    if (isQuarterLine) {
      // Split into two half-bets
      const line1 = line - 0.25;
      const line2 = line + 0.25;
      const adj1 = teamDiff + line1;
      const adj2 = teamDiff + line2;

      let p1: BetOutcome = adj1 > 0 ? "win" : adj1 < 0 ? "loss" : "push";
      let p2: BetOutcome = adj2 > 0 ? "win" : adj2 < 0 ? "loss" : "push";

      if (p1 === "win" && p2 === "win") return { outcome: "win", profit: 0, pinnacleOdds: 0 };
      if (p1 === "loss" && p2 === "loss") return { outcome: "loss", profit: -1, pinnacleOdds: 0 };
      if (p1 === "win" && p2 === "push") return { outcome: "half_win", profit: 0, pinnacleOdds: 0 };
      if (p1 === "push" && p2 === "loss") return { outcome: "half_loss", profit: -0.5, pinnacleOdds: 0 };
      if (p1 === "win" && p2 === "loss") return { outcome: "half_win", profit: 0, pinnacleOdds: 0 };
      if (p1 === "loss" && p2 === "win") return { outcome: "half_loss", profit: -0.5, pinnacleOdds: 0 };
      return { outcome: "push", profit: 0, pinnacleOdds: 0 };
    }

    // Standard line
    if (adjusted > 0) return { outcome: "win", profit: 0, pinnacleOdds: 0 };
    if (adjusted < 0) return { outcome: "loss", profit: -1, pinnacleOdds: 0 };
    return { outcome: "push", profit: 0, pinnacleOdds: 0 };
  }

  return { outcome: "pending", profit: 0, pinnacleOdds: 0 };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const showSummary = args.includes("--summary");
  const specificDate = args.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const useFotmob = !args.includes("--no-fotmob");

  if (!existsSync(betLogDir)) {
    console.log("No bet-log directory found.");
    return;
  }

  const results = loadResults();
  console.log(`[PROGRESS] Loaded ${results.length} match results from cache`);

  // Fetch live results from Fotmob (fills gaps where football-data lags)
  if (useFotmob) {
    console.log(`[PROGRESS] Fetching live results from Fotmob...`);
    const fotmobResults = await fetchFotmobResults(FOTMOB_LEAGUES);
    // Merge: Fotmob results fill in anything not in the cache
    const existingKeys = new Set(results.map(r => `${r.date}_${normalize(r.homeTeam)}_${normalize(r.awayTeam)}`));
    let added = 0;
    for (const fr of fotmobResults) {
      const key = `${fr.date}_${normalize(fr.homeTeam)}_${normalize(fr.awayTeam)}`;
      if (!existingKeys.has(key)) {
        results.push(fr);
        existingKeys.add(key);
        added++;
      }
    }
    console.log(`[PROGRESS] Fotmob added ${added} new results (total: ${results.length})`);
  }
  console.log();

  const logFiles = readdirSync(betLogDir)
    .filter(f => f.endsWith(".json"))
    .sort();

  if (logFiles.length === 0) {
    console.log("No bet logs found.");
    return;
  }

  let totalBets = 0, totalWins = 0, totalLosses = 0, totalPush = 0, totalPending = 0;
  let totalProfit = 0;
  let totalHalfWin = 0, totalHalfLoss = 0;

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  BET RESULTS — MI Bivariate Poisson + Variance");
  console.log("═══════════════════════════════════════════════════════════════\n");

  for (const file of logFiles) {
    const date = file.replace(".json", "");
    if (specificDate && date !== specificDate) continue;

    const log = JSON.parse(readFileSync(join(betLogDir, file), "utf-8"));
    const bets = log.bets || [];

    if (bets.length === 0) continue;

    console.log(`  ─── ${date} (${bets.length} bets) ─────────────────────────────────`);

    let dayProfit = 0;
    let scored = false;

    for (const bet of bets) {
      const matchResult = findMatch(bet, results);
      totalBets++;

      if (!matchResult) {
        totalPending++;
        const status = "⏳ pending";
        console.log(`    ${bet.selection.padEnd(30)} ${bet.match.padEnd(35)} ${status}  @ ${bet.pinnacleOdds}`);
        continue;
      }

      scored = true;
      const grade = gradeBet(bet.selection, matchResult);
      const odds = bet.pinnacleOdds;

      let profit = 0;
      let symbol = "";
      switch (grade.outcome) {
        case "win":
          profit = odds - 1;
          totalWins++;
          symbol = "✅";
          break;
        case "loss":
          profit = -1;
          totalLosses++;
          symbol = "❌";
          break;
        case "half_win":
          profit = (odds - 1) / 2;
          totalHalfWin++;
          symbol = "🟡W";
          break;
        case "half_loss":
          profit = -0.5;
          totalHalfLoss++;
          symbol = "🟡L";
          break;
        case "push":
          profit = 0;
          totalPush++;
          symbol = "🔄";
          break;
        default:
          totalPending++;
          symbol = "⏳";
      }

      dayProfit += profit;
      totalProfit += profit;

      const score = `${matchResult.fthg}-${matchResult.ftag}`;
      const profitStr = profit >= 0 ? `+${profit.toFixed(2)}u` : `${profit.toFixed(2)}u`;
      console.log(`    ${symbol} ${bet.selection.padEnd(28)} ${bet.match.padEnd(35)} ${score.padEnd(5)} ${profitStr.padStart(8)}  @ ${odds}`);

      // Save result back to bet
      bet.result = {
        score: `${matchResult.fthg}-${matchResult.ftag}`,
        outcome: grade.outcome,
        profit: Math.round(profit * 100) / 100,
      };
    }

    if (scored) {
      const dayStr = dayProfit >= 0 ? `+${dayProfit.toFixed(2)}u` : `${dayProfit.toFixed(2)}u`;
      console.log(`    ${"".padEnd(78)} Day: ${dayStr}`);

      // Save scored results back
      writeFileSync(join(betLogDir, file), JSON.stringify(log, null, 2));
    }
    console.log();
  }

  // Summary
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  CUMULATIVE SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Total bets:    ${totalBets}`);
  console.log(`  Wins:          ${totalWins}`);
  console.log(`  Losses:        ${totalLosses}`);
  console.log(`  Half wins:     ${totalHalfWin}`);
  console.log(`  Half losses:   ${totalHalfLoss}`);
  console.log(`  Pushes:        ${totalPush}`);
  console.log(`  Pending:       ${totalPending}`);
  const winRate = totalWins + totalLosses + totalHalfWin + totalHalfLoss > 0
    ? ((totalWins + totalHalfWin * 0.5) / (totalWins + totalLosses + totalHalfWin + totalHalfLoss) * 100).toFixed(1)
    : "N/A";
  console.log(`  Win rate:      ${winRate}%`);
  const profitStr = totalProfit >= 0 ? `+${totalProfit.toFixed(2)}u` : `${totalProfit.toFixed(2)}u`;
  console.log(`  Total P/L:     ${profitStr}`);
  if (totalBets - totalPending > 0) {
    const roi = (totalProfit / (totalBets - totalPending) * 100).toFixed(1);
    console.log(`  ROI:           ${roi}%`);
  }
  console.log();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
