/**
 * Threshold Optimization Sweep — EPL Historical Backtest
 *
 * Walk-forward test of variance model across 2 EPL seasons (2023-24, 2024-25).
 * Sweeps edge, confidence, draw-prone gap, persistent defiance, and minMatches
 * thresholds to find optimal parameters for ROI and bet frequency.
 */
import fs from "fs";

const BASE = new URL("../", import.meta.url).pathname;

// ─── Team name mapping: Understat → football-data.co.uk ──────────────────────
const UNDERSTAT_TO_FD = {
  "Newcastle United": "Newcastle",
  "Manchester City": "Manchester City",
  "Manchester United": "Manchester United",
  "Wolverhampton Wanderers": "Wolverhampton",
  "Nottingham Forest": "Nottingham Forest",
  "Sheffield United": "Sheffield Utd",
  "Tottenham": "Tottenham",
  "Arsenal": "Arsenal",
  "Liverpool": "Liverpool",
  "Chelsea": "Chelsea",
  "Aston Villa": "Aston Villa",
  "Brighton": "Brighton",
  "Bournemouth": "Bournemouth",
  "Brentford": "Brentford",
  "Crystal Palace": "Crystal Palace",
  "Everton": "Everton",
  "Fulham": "Fulham",
  "West Ham": "West Ham",
  "Burnley": "Burnley",
  "Luton": "Luton",
  "Southampton": "Southampton",
  "Leicester": "Leicester",
  "Ipswich": "Ipswich",
};

// Reverse mapping
const FD_TO_UNDERSTAT = {};
for (const [us, fd] of Object.entries(UNDERSTAT_TO_FD)) {
  FD_TO_UNDERSTAT[fd] = us;
}

function r(v) { return Math.round(v * 100) / 100; }

// ─── Load data ───────────────────────────────────────────────────────────────

console.log("=== LOADING DATA ===");

const SEASONS = [
  { xgFile: "premierLeague-2023.json", oddsFile: "epl-2023-24.json", label: "2023-24" },
  { xgFile: "premierLeague-2024.json", oddsFile: "epl-2024-25.json", label: "2024-25" },
];

const allMatchdays = []; // { date, homeTeam(understat), awayTeam(understat), result, pinnH, pinnA, pinnD }

for (const season of SEASONS) {
  const xgData = JSON.parse(fs.readFileSync(`${BASE}data/understat-cache/${season.xgFile}`, "utf8"));
  const oddsData = JSON.parse(fs.readFileSync(`${BASE}data/football-data-cache/${season.oddsFile}`, "utf8"));

  console.log(`  ${season.label}: ${xgData.rawHistory.length} teams xG, ${oddsData.matches.length} matches odds`);

  // Build team xG histories indexed by understat name
  const teamHistories = {};
  for (const entry of xgData.rawHistory) {
    teamHistories[entry.team] = entry.matches;
  }

  // Process each odds match
  for (const m of oddsData.matches) {
    const homeUS = FD_TO_UNDERSTAT[m.homeTeam];
    const awayUS = FD_TO_UNDERSTAT[m.awayTeam];

    if (!homeUS || !awayUS) continue;

    const pinnH = m.pinnacleCloseHome;
    const pinnA = m.pinnacleCloseAway;
    const pinnD = m.pinnacleCloseDraw;

    if (!pinnH || !pinnA) continue; // skip if no Pinnacle odds

    allMatchdays.push({
      date: m.date,
      homeTeamUS: homeUS,
      awayTeamUS: awayUS,
      homeTeamFD: m.homeTeam,
      awayTeamFD: m.awayTeam,
      result: m.result, // "H", "D", "A"
      pinnH, pinnA, pinnD,
      season: season.label,
      teamHistories,
    });
  }
}

console.log(`  Total matches loaded: ${allMatchdays.length}`);

// ─── Variance Calculator (mirrors lib/variance/calculator.ts) ────────────────

function aggregateMatchesBefore(history, venue, beforeDate, minMatches) {
  // Walk-forward: only use matches BEFORE the test date
  const cutoff = new Date(beforeDate);
  const filtered = history.filter(m => {
    const matchDate = new Date(m.date);
    if (matchDate >= cutoff) return false;
    if (venue && m.h_a !== venue) return false;
    return true;
  });

  if (filtered.length < minMatches) return null;

  const xGFor = filtered.reduce((s, m) => s + m.xG, 0);
  const xGAgainst = filtered.reduce((s, m) => s + m.xGA, 0);
  const goalsFor = filtered.reduce((s, m) => s + m.scored, 0);
  const goalsAgainst = filtered.reduce((s, m) => s + m.missed, 0);
  return { xGFor, xGAgainst, goalsFor, goalsAgainst, matches: filtered.length };
}

function computeVariance(stats, teamName, venue) {
  const { xGFor, xGAgainst, goalsFor, goalsAgainst, matches } = stats;
  const xGD = xGFor - xGAgainst;
  const actualGD = goalsFor - goalsAgainst;
  const attackVar = goalsFor - xGFor;
  const defenseVar = goalsAgainst - xGAgainst;
  const totalVar = actualGD - xGD;
  const xGDPerMatch = matches > 0 ? xGD / matches : 0;

  // Venue-adjusted quality
  let adjXGD = xGDPerMatch;
  if (venue === "h") adjXGD -= 0.3;
  if (venue === "a") adjXGD += 0.2;

  const qualityTier =
    adjXGD >= 1.0 ? "elite" : adjXGD >= 0.3 ? "good" : adjXGD >= -0.3 ? "average" : adjXGD >= -0.8 ? "poor" : "bad";

  const absTotal = Math.abs(totalVar);
  let signal = "neutral";
  if (absTotal >= 5) signal = totalVar > 0 ? "strong_positive" : "strong_negative";
  else if (absTotal >= 3) signal = totalVar > 0 ? "weak_positive" : "weak_negative";

  const absAtk = Math.abs(attackVar);
  const absDef = Math.abs(defenseVar);
  let dominantType = "balanced";
  if (absAtk < 2 && absDef < 2) dominantType = "balanced";
  else if (absAtk > absDef) dominantType = attackVar > 0 ? "attack_overperf" : "attack_underperf";
  else dominantType = defenseVar > 0 ? "defense_underperf" : "defense_overperf";

  const persistentDefiance = matches >= 15 && absTotal > 5;
  const doubleVariance = attackVar > 2 && defenseVar > 2;

  // Regression confidence
  let confidence = 0.5;
  if (absTotal > 5) confidence += 0.2;
  if (absTotal > 8) confidence += 0.1;
  if (dominantType === "defense_underperf") confidence += 0.15;
  if (dominantType === "attack_overperf") confidence -= 0.1;
  if (matches >= 10) confidence += 0.1;
  if (matches < 5) confidence -= 0.15;
  if (persistentDefiance) confidence -= 0.2;
  if (qualityTier === "bad") confidence -= 0.15;
  if (qualityTier === "poor") confidence -= 0.05;
  confidence = Math.max(0, Math.min(1, confidence));

  let regressionDir = "stable";
  if (signal.includes("positive")) regressionDir = "decline";
  else if (signal.includes("negative")) regressionDir = "improve";

  return {
    team: teamName, matches,
    xGFor: r(xGFor), xGAgainst: r(xGAgainst), goalsFor, goalsAgainst,
    xGD: r(xGD), actualGD,
    attackVariance: r(attackVar), defenseVariance: r(defenseVar), totalVariance: r(totalVar),
    xGDPerMatch: r(xGDPerMatch), qualityTier, signal, dominantType,
    persistentDefiance, doubleVariance,
    regressionConfidence: r(confidence), regressionDirection: regressionDir,
  };
}

// ─── Configurable Match Assessor ─────────────────────────────────────────────

function assessMatchConfigurable(homeV, awayV, config) {
  const {
    edgeThreshold,
    confidenceThreshold,
    drawProneGap,
    persistentDefianceEnabled,
  } = config;

  const homeBenefit = (-homeV.totalVariance / 100) * homeV.regressionConfidence;
  const awayBenefit = (-awayV.totalVariance / 100) * awayV.regressionConfidence;
  const edge = homeBenefit - awayBenefit;

  let edgeSide = "neutral";
  if (edge > 0.02) edgeSide = "home";
  else if (edge < -0.02) edgeSide = "away";

  const absEdge = Math.abs(edge);
  const magnitude = absEdge >= 0.15 ? "strong" : absEdge >= 0.08 ? "moderate" : absEdge >= 0.04 ? "weak" : "none";

  const favV = edge > 0 ? homeV : awayV;
  const oppV = edge > 0 ? awayV : homeV;

  // Positive factors
  const pos = [];
  if (favV.regressionDirection === "improve" && (favV.qualityTier === "good" || favV.qualityTier === "elite"))
    pos.push("P1");
  if (favV.dominantType === "defense_underperf")
    pos.push("P2");
  if (oppV.regressionDirection === "decline" && oppV.dominantType !== "attack_overperf" && oppV.dominantType !== "defense_overperf")
    pos.push("P3");
  if (oppV.dominantType === "attack_overperf")
    pos.push("P4");
  if (oppV.dominantType === "defense_overperf")
    pos.push("P5");
  if (Math.abs(favV.totalVariance) >= 8)
    pos.push("P6");
  if (favV.regressionDirection === "improve" && favV.qualityTier === "average")
    pos.push("P7");
  if (oppV.doubleVariance)
    pos.push("P9");

  // Pass reasons
  const pass = [];

  // N1. Edge too small (configurable threshold)
  if (absEdge < edgeThreshold) pass.push("N1-edge");

  // N2. Favored side has neutral signal
  if (favV.signal === "neutral") pass.push("N2-neutral");

  // N3. Low confidence (configurable threshold)
  if (favV.regressionConfidence < confidenceThreshold) pass.push("N3-conf");

  // N4. Genuinely bad team
  if (favV.qualityTier === "bad" && favV.regressionDirection === "improve")
    pass.push("N4-bad");

  // N7. Persistent defiance (configurable)
  if (persistentDefianceEnabled && favV.persistentDefiance)
    pass.push("N7-persist");

  // N12. Double variance on favored side
  if (favV.doubleVariance)
    pass.push("N12-doublevar");

  // N10. Draw-prone matchup (configurable gap)
  const qualityGap = Math.abs(homeV.xGDPerMatch - awayV.xGDPerMatch);
  if (drawProneGap < 900 && qualityGap < drawProneGap && magnitude !== "strong")
    pass.push("N10-draw");

  // N6. Both teams chaotic
  if (Math.abs(homeV.totalVariance) > 5 && Math.abs(awayV.totalVariance) > 5 &&
      homeV.regressionDirection !== awayV.regressionDirection && absEdge < 0.08)
    pass.push("N6-chaotic");

  // N8. Favored side's good results built on fragile attack overperf
  if (favV.regressionDirection === "decline" && favV.dominantType === "attack_overperf")
    pass.push("N8-fragile");

  // N9. No positive factors
  if (pos.length === 0 && pass.length === 0)
    pass.push("N9-nothesis");

  const hasBet = pass.length === 0 && pos.length > 0;

  // Grade (v2 dimension-based)
  let grade = null;
  if (hasBet) {
    let dims = 0;
    if (pos.includes("P1") || pos.includes("P7")) dims++;
    if (pos.includes("P2") || pos.includes("P6")) dims++;
    if (pos.includes("P3") || pos.includes("P4") || pos.includes("P5") || pos.includes("P9")) dims++;
    grade = dims >= 3 ? "A" : dims >= 2 ? "B" : "C";
  }

  return {
    edgeSide, edgePct: r(edge * 100), magnitude, hasBet,
    betSide: hasBet ? edgeSide : null, grade,
    positiveFactors: pos, passReasons: pass,
  };
}

// ─── Sweep Parameters ────────────────────────────────────────────────────────

const EDGE_THRESHOLDS = [0.02, 0.03, 0.04, 0.05, 0.06];
const CONF_THRESHOLDS = [0.4, 0.5, 0.6, 0.7];
const DRAW_GAPS = [0.15, 0.2, 0.25, 0.3, 999];
const PERSIST_OPTIONS = [true, false];
const MIN_MATCHES_OPTIONS = [5, 8, 10];

const totalCombinations = EDGE_THRESHOLDS.length * CONF_THRESHOLDS.length *
  DRAW_GAPS.length * PERSIST_OPTIONS.length * MIN_MATCHES_OPTIONS.length;

console.log(`\n=== STARTING SWEEP ===`);
console.log(`  Parameter combinations: ${totalCombinations}`);
console.log(`  Matches per combination: ${allMatchdays.length}`);
console.log(`  Total evaluations: ${(totalCombinations * allMatchdays.length).toLocaleString()}\n`);

// ─── Run sweep ───────────────────────────────────────────────────────────────

const results = [];
let comboCount = 0;

for (const edgeThreshold of EDGE_THRESHOLDS) {
  for (const confidenceThreshold of CONF_THRESHOLDS) {
    for (const drawProneGap of DRAW_GAPS) {
      for (const persistentDefianceEnabled of PERSIST_OPTIONS) {
        for (const minMatches of MIN_MATCHES_OPTIONS) {
          comboCount++;

          if (comboCount % 50 === 0 || comboCount === 1) {
            console.log(`  Processing combo ${comboCount}/${totalCombinations} — edge=${edgeThreshold} conf=${confidenceThreshold} gap=${drawProneGap === 999 ? 'OFF' : drawProneGap} persist=${persistentDefianceEnabled} minM=${minMatches}`);
          }

          const config = { edgeThreshold, confidenceThreshold, drawProneGap, persistentDefianceEnabled };

          let totalBets = 0;
          let totalWins = 0;
          let totalProfit = 0;
          let totalEdge = 0;
          let matchesEvaluated = 0;
          let matchesSkipped = 0;
          const grades = { A: 0, B: 0, C: 0 };

          for (const matchday of allMatchdays) {
            const homeHistory = matchday.teamHistories[matchday.homeTeamUS];
            const awayHistory = matchday.teamHistories[matchday.awayTeamUS];

            if (!homeHistory || !awayHistory) {
              matchesSkipped++;
              continue;
            }

            // Walk-forward: aggregate only matches before this date
            const homeStats = aggregateMatchesBefore(homeHistory, "h", matchday.date, minMatches);
            const awayStats = aggregateMatchesBefore(awayHistory, "a", matchday.date, minMatches);

            if (!homeStats || !awayStats) {
              matchesSkipped++;
              continue;
            }

            matchesEvaluated++;

            const homeV = computeVariance(homeStats, matchday.homeTeamUS, "h");
            const awayV = computeVariance(awayStats, matchday.awayTeamUS, "a");
            const assessment = assessMatchConfigurable(homeV, awayV, config);

            if (assessment.hasBet) {
              totalBets++;
              if (assessment.grade) grades[assessment.grade]++;
              totalEdge += Math.abs(assessment.edgePct);

              // Calculate profit
              if (assessment.betSide === "home") {
                if (matchday.result === "H") {
                  totalWins++;
                  totalProfit += matchday.pinnH - 1;
                } else {
                  totalProfit -= 1;
                }
              } else if (assessment.betSide === "away") {
                if (matchday.result === "A") {
                  totalWins++;
                  totalProfit += matchday.pinnA - 1;
                } else {
                  totalProfit -= 1;
                }
              }
            }
          }

          const betsPerMatch = matchesEvaluated > 0 ? totalBets / matchesEvaluated : 0;
          const winRate = totalBets > 0 ? totalWins / totalBets : 0;
          const roi = totalBets > 0 ? totalProfit / totalBets : 0;
          const avgEdge = totalBets > 0 ? totalEdge / totalBets : 0;

          results.push({
            edgeThreshold,
            confidenceThreshold,
            drawProneGap,
            persistentDefianceEnabled,
            minMatches,
            totalBets,
            matchesEvaluated,
            matchesSkipped,
            betsPerMatch,
            winRate,
            roi,
            totalProfit,
            avgEdge,
            grades,
            totalWins,
          });
        }
      }
    }
  }
}

console.log(`\n  Sweep complete! ${comboCount} combinations evaluated.\n`);

// ─── Sort by ROI and display ─────────────────────────────────────────────────

// Filter out combos with fewer than 10 bets (not meaningful)
const meaningful = results.filter(r => r.totalBets >= 10);
meaningful.sort((a, b) => b.roi - a.roi);

console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════════════");
console.log("  THRESHOLD SWEEP RESULTS — TOP 30 BY ROI (min 10 bets)");
console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════════════");
console.log("");
console.log(`  Total matches per season: ~380  |  Seasons: 2  |  Max evaluable: ${allMatchdays.length}`);
console.log(`  Current defaults: edge=0.04, conf=0.6, drawGap=0.3, persist=true, minM=10`);
console.log("");

const header = "Rank | Edge  | Conf | DrawGap | Persist | MinM | Bets | B/Match | Wins | Win%  | ROI%    | Profit | AvgEdge | Grades(A/B/C)";
console.log(header);
console.log("-".repeat(header.length));

const topN = Math.min(30, meaningful.length);
for (let i = 0; i < topN; i++) {
  const s = meaningful[i];
  const gapStr = s.drawProneGap >= 900 ? " OFF " : s.drawProneGap.toFixed(2);
  const persistStr = s.persistentDefianceEnabled ? " yes " : " no  ";

  console.log(
    `${String(i + 1).padStart(4)} | ${s.edgeThreshold.toFixed(2)}  | ${s.confidenceThreshold.toFixed(1)}  | ${gapStr}   | ${persistStr}  | ${String(s.minMatches).padStart(4)} | ${String(s.totalBets).padStart(4)} | ${s.betsPerMatch.toFixed(3).padStart(7)} | ${String(s.totalWins).padStart(4)} | ${(s.winRate * 100).toFixed(1).padStart(5)}% | ${(s.roi * 100).toFixed(1).padStart(6)}% | ${s.totalProfit.toFixed(1).padStart(6)} | ${s.avgEdge.toFixed(1).padStart(7)}% | ${s.grades.A}/${s.grades.B}/${s.grades.C}`
  );
}

// ─── Show current defaults for comparison ────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════════════════════════════════════════════════");
console.log("  CURRENT DEFAULTS PERFORMANCE");
console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════════════\n");

const current = results.find(r =>
  r.edgeThreshold === 0.04 &&
  r.confidenceThreshold === 0.6 &&
  r.drawProneGap === 0.3 &&
  r.persistentDefianceEnabled === true &&
  r.minMatches === 10
);

if (current) {
  console.log(`  Bets: ${current.totalBets} | B/Match: ${current.betsPerMatch.toFixed(3)} | Win%: ${(current.winRate * 100).toFixed(1)}% | ROI: ${(current.roi * 100).toFixed(1)}% | Profit: ${current.totalProfit.toFixed(1)} | Avg Edge: ${current.avgEdge.toFixed(1)}%`);
  console.log(`  Matches evaluated: ${current.matchesEvaluated} | Skipped (insufficient data): ${current.matchesSkipped}`);
  console.log(`  Grades: A=${current.grades.A} B=${current.grades.B} C=${current.grades.C}`);
} else {
  console.log("  (Current defaults not found in sweep — check parameter values)");
}

// ─── Bottom 10 (worst ROI) ──────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════════════════════════════════════════════════");
console.log("  WORST 10 BY ROI (min 10 bets)");
console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════════════\n");

console.log(header);
console.log("-".repeat(header.length));

const bottomN = Math.min(10, meaningful.length);
for (let i = meaningful.length - bottomN; i < meaningful.length; i++) {
  const s = meaningful[i];
  const gapStr = s.drawProneGap >= 900 ? " OFF " : s.drawProneGap.toFixed(2);
  const persistStr = s.persistentDefianceEnabled ? " yes " : " no  ";
  const rank = i + 1;

  console.log(
    `${String(rank).padStart(4)} | ${s.edgeThreshold.toFixed(2)}  | ${s.confidenceThreshold.toFixed(1)}  | ${gapStr}   | ${persistStr}  | ${String(s.minMatches).padStart(4)} | ${String(s.totalBets).padStart(4)} | ${s.betsPerMatch.toFixed(3).padStart(7)} | ${String(s.totalWins).padStart(4)} | ${(s.winRate * 100).toFixed(1).padStart(5)}% | ${(s.roi * 100).toFixed(1).padStart(6)}% | ${s.totalProfit.toFixed(1).padStart(6)} | ${s.avgEdge.toFixed(1).padStart(7)}% | ${s.grades.A}/${s.grades.B}/${s.grades.C}`
  );
}

// ─── Pass reason frequency analysis ─────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════════════════════════════════════════════════");
console.log("  PASS REASON FREQUENCY (current defaults: edge=0.04, conf=0.6, gap=0.3, persist=true, minM=10)");
console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════════════\n");

// Re-run with current defaults to collect pass reasons
const passReasonCounts = {};
let assessedCount = 0;
let betCount = 0;

for (const matchday of allMatchdays) {
  const homeHistory = matchday.teamHistories[matchday.homeTeamUS];
  const awayHistory = matchday.teamHistories[matchday.awayTeamUS];
  if (!homeHistory || !awayHistory) continue;

  const homeStats = aggregateMatchesBefore(homeHistory, "h", matchday.date, 10);
  const awayStats = aggregateMatchesBefore(awayHistory, "a", matchday.date, 10);
  if (!homeStats || !awayStats) continue;

  assessedCount++;
  const homeV = computeVariance(homeStats, matchday.homeTeamUS, "h");
  const awayV = computeVariance(awayStats, matchday.awayTeamUS, "a");
  const a = assessMatchConfigurable(homeV, awayV, {
    edgeThreshold: 0.04,
    confidenceThreshold: 0.6,
    drawProneGap: 0.3,
    persistentDefianceEnabled: true,
  });

  if (a.hasBet) {
    betCount++;
  } else {
    for (const reason of a.passReasons) {
      passReasonCounts[reason] = (passReasonCounts[reason] || 0) + 1;
    }
  }
}

const sortedReasons = Object.entries(passReasonCounts).sort((a, b) => b[1] - a[1]);
console.log(`  Assessed: ${assessedCount} | Bets: ${betCount} | Passes: ${assessedCount - betCount}\n`);

const REASON_LABELS = {
  "N1-edge": "Edge below threshold",
  "N2-neutral": "Favored side neutral signal",
  "N3-conf": "Low regression confidence",
  "N4-bad": "Genuinely bad team",
  "N6-chaotic": "Both teams chaotic",
  "N7-persist": "Persistent defiance",
  "N8-fragile": "Fragile attack overperf",
  "N9-nothesis": "No positive thesis",
  "N10-draw": "Draw-prone matchup",
  "N12-doublevar": "Double variance (illusory)",
};

for (const [reason, count] of sortedReasons) {
  const label = REASON_LABELS[reason] || reason;
  const pct = ((count / (assessedCount - betCount)) * 100).toFixed(1);
  console.log(`  ${label.padEnd(35)} ${String(count).padStart(4)} (${pct}% of passes)`);
}

// ─── Summary insights ────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════════════════════════════════════════════════════════════");
console.log("  KEY INSIGHTS");
console.log("═══════════════════════════════════════════════════════════════════════════════════════════════════════════\n");

if (meaningful.length > 0) {
  const best = meaningful[0];
  const bestGapStr = best.drawProneGap >= 900 ? "OFF" : best.drawProneGap.toFixed(2);
  console.log(`  Best ROI combo: edge=${best.edgeThreshold}, conf=${best.confidenceThreshold}, gap=${bestGapStr}, persist=${best.persistentDefianceEnabled}, minM=${best.minMatches}`);
  console.log(`    -> ${best.totalBets} bets, ${(best.winRate * 100).toFixed(1)}% win rate, ${(best.roi * 100).toFixed(1)}% ROI, ${best.betsPerMatch.toFixed(3)} bets/match`);

  // Find best combo with bets/match >= 0.10
  const frequentBets = meaningful.filter(r => r.betsPerMatch >= 0.10);
  if (frequentBets.length > 0) {
    const bestFreq = frequentBets[0]; // already sorted by ROI
    const freqGapStr = bestFreq.drawProneGap >= 900 ? "OFF" : bestFreq.drawProneGap.toFixed(2);
    console.log(`\n  Best ROI with >= 0.10 bets/match: edge=${bestFreq.edgeThreshold}, conf=${bestFreq.confidenceThreshold}, gap=${freqGapStr}, persist=${bestFreq.persistentDefianceEnabled}, minM=${bestFreq.minMatches}`);
    console.log(`    -> ${bestFreq.totalBets} bets, ${(bestFreq.winRate * 100).toFixed(1)}% win rate, ${(bestFreq.roi * 100).toFixed(1)}% ROI, ${bestFreq.betsPerMatch.toFixed(3)} bets/match`);
  }

  // Ted comparison target
  const tedTarget = meaningful.filter(r => r.betsPerMatch >= 0.20);
  if (tedTarget.length > 0) {
    const bestTed = tedTarget[0];
    const tedGapStr = bestTed.drawProneGap >= 900 ? "OFF" : bestTed.drawProneGap.toFixed(2);
    console.log(`\n  Best ROI with >= 0.20 bets/match (Ted range): edge=${bestTed.edgeThreshold}, conf=${bestTed.confidenceThreshold}, gap=${tedGapStr}, persist=${bestTed.persistentDefianceEnabled}, minM=${bestTed.minMatches}`);
    console.log(`    -> ${bestTed.totalBets} bets, ${(bestTed.winRate * 100).toFixed(1)}% win rate, ${(bestTed.roi * 100).toFixed(1)}% ROI, ${bestTed.betsPerMatch.toFixed(3)} bets/match`);
  }
}

console.log("\n  Done.\n");
