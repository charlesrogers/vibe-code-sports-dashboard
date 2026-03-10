/**
 * UCL R16 Blind Assessment — standalone script
 * Uses domestic league xG to run variance model on all 8 first-leg matches.
 */
import fs from "fs";

// ─── UCL R16 First Legs ─────────────────────────────────────────────────────

const MATCHES = [
  { date: "2026-03-10", home: "Galatasaray", away: "Liverpool", homeLeague: null, awayLeague: "premierLeague", homeUS: null, awayUS: "Liverpool" },
  { date: "2026-03-10", home: "Atalanta", away: "Bayern Munich", homeLeague: "serieA", awayLeague: "bundesliga", homeUS: "Atalanta", awayUS: "Bayern Munich" },
  { date: "2026-03-10", home: "Atletico Madrid", away: "Tottenham", homeLeague: "laLiga", awayLeague: "premierLeague", homeUS: "Atletico Madrid", awayUS: "Tottenham" },
  { date: "2026-03-10", home: "Newcastle", away: "Barcelona", homeLeague: "premierLeague", awayLeague: "laLiga", homeUS: "Newcastle United", awayUS: "Barcelona" },
  { date: "2026-03-11", home: "Leverkusen", away: "Arsenal", homeLeague: "bundesliga", awayLeague: "premierLeague", homeUS: "Bayer Leverkusen", awayUS: "Arsenal" },
  { date: "2026-03-11", home: "Bodo/Glimt", away: "Sporting CP", homeLeague: null, awayLeague: null, homeUS: null, awayUS: null },
  { date: "2026-03-11", home: "PSG", away: "Chelsea", homeLeague: "ligue1", awayLeague: "premierLeague", homeUS: "Paris Saint Germain", awayUS: "Chelsea" },
  { date: "2026-03-11", home: "Real Madrid", away: "Man City", homeLeague: "laLiga", awayLeague: "premierLeague", homeUS: "Real Madrid", awayUS: "Manchester City" },
];

const CACHE_FILES = {
  premierLeague: "premierLeague-2025.json",
  serieA: "serieA-2025.json",
  laLiga: "laLiga-2025.json",
  bundesliga: "bundesliga-2025.json",
  ligue1: "ligue1-2025.json",
};

// ─── Lightweight variance calculator (mirrors lib/variance/calculator.ts) ───

function aggregateMatches(history, venue) {
  const filtered = venue ? history.filter(m => m.h_a === venue) : history;
  if (filtered.length === 0) return null;
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
    team: teamName,
    matches,
    xGFor: r(xGFor), xGAgainst: r(xGAgainst), goalsFor, goalsAgainst,
    xGD: r(xGD), actualGD,
    attackVariance: r(attackVar), defenseVariance: r(defenseVar), totalVariance: r(totalVar),
    xGDPerMatch: r(xGDPerMatch), qualityTier, signal, dominantType,
    persistentDefiance, doubleVariance,
    regressionConfidence: r(confidence), regressionDirection: regressionDir,
  };
}

function r(v) { return Math.round(v * 100) / 100; }

// ─── Simplified match assessor ──────────────────────────────────────────────

function assessMatch(homeV, awayV) {
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
    pos.push(`P1: ${favV.team} strong quality (${favV.qualityTier}) but underperforming`);
  if (favV.dominantType === "defense_underperf")
    pos.push(`P2: ${favV.team} defensive underperformance — most reliable signal`);
  if (oppV.regressionDirection === "decline" && oppV.dominantType !== "attack_overperf" && oppV.dominantType !== "defense_overperf")
    pos.push(`P3: ${oppV.team} overperforming, due to regress`);
  if (oppV.dominantType === "attack_overperf")
    pos.push(`P4: ${oppV.team} fragile attack overperformance`);
  if (oppV.dominantType === "defense_overperf")
    pos.push(`P5: ${oppV.team} unsustainable defensive overperformance`);
  if (Math.abs(favV.totalVariance) >= 8)
    pos.push(`P6: ${favV.team} extreme variance gap (${Math.abs(favV.totalVariance)} goals)`);
  if (favV.regressionDirection === "improve" && favV.qualityTier === "average")
    pos.push(`P7: ${favV.team} average quality but underperforming`);
  if (oppV.doubleVariance)
    pos.push(`P9: ${oppV.team} double variance — both components fragile`);

  // Pass reasons
  const pass = [];
  if (absEdge < 0.04) pass.push("Edge below 4%");
  if (favV.signal === "neutral") pass.push("Favored side has no variance signal");
  if (favV.regressionConfidence < 0.6) pass.push("Low regression confidence");
  if (favV.qualityTier === "bad" && favV.regressionDirection === "improve")
    pass.push(`${favV.team} is genuinely bad (not unlucky)`);
  if (favV.persistentDefiance) pass.push(`${favV.team} persistent defiance`);
  if (favV.doubleVariance) pass.push(`${favV.team} has double variance — illusory stability`);

  const qualityGap = Math.abs(homeV.xGDPerMatch - awayV.xGDPerMatch);
  if (qualityGap < 0.3 && magnitude !== "strong")
    pass.push(`Draw-prone: quality gap only ${r(qualityGap)} xGD/match`);

  if (pos.length === 0 && pass.length === 0)
    pass.push("No positive variance thesis");

  const hasBet = pass.length === 0 && pos.length > 0;

  // Grade
  let grade = null;
  if (hasBet) {
    let dims = 0;
    if (pos.some(f => f.includes("P1") || f.includes("P7"))) dims++;
    if (pos.some(f => f.includes("P2") || f.includes("P6"))) dims++;
    if (pos.some(f => f.includes("P3") || f.includes("P4") || f.includes("P5") || f.includes("P9"))) dims++;
    grade = dims >= 3 ? "A" : dims >= 2 ? "B" : "C";
  }

  return {
    edgeSide, edgePct: r(edge * 100), magnitude, hasBet,
    betSide: hasBet ? edgeSide : null, grade,
    confidence: hasBet ? r(Math.min(favV.regressionConfidence, 0.95)) : 0,
    positiveFactors: pos, passReasons: pass,
  };
}

// ─── Main ───────────────────────────────────────────────────────────────────

const cacheDir = "./data/understat-cache";
const leagueCache = {};

function loadLeague(league) {
  if (!league) return null;
  if (leagueCache[league]) return leagueCache[league];
  const file = CACHE_FILES[league];
  if (!file) return null;
  try {
    const data = JSON.parse(fs.readFileSync(`${cacheDir}/${file}`, "utf8"));
    leagueCache[league] = data;
    return data;
  } catch { return null; }
}

function findTeam(leagueData, name) {
  if (!leagueData || !name) return null;
  const lowerName = name.toLowerCase();

  // Format 1: Raw Understat { teams: { id: { title, history } } }
  if (leagueData.teams) {
    const entry = Object.values(leagueData.teams).find(t => t.title.toLowerCase() === lowerName);
    if (entry) return { title: entry.title, history: entry.history };
  }

  // Format 2: App cache { rawHistory: [{ team, matches }] }
  if (leagueData.rawHistory) {
    const entries = Array.isArray(leagueData.rawHistory)
      ? leagueData.rawHistory
      : Object.values(leagueData.rawHistory);
    const entry = entries.find(t => t.team.toLowerCase() === lowerName);
    if (entry) return { title: entry.team, history: entry.matches.map(m => ({
      h_a: m.h_a, xG: m.xG, xGA: m.xGA, scored: m.scored, missed: m.missed, date: m.date
    })) };
  }

  return null;
}

console.log("═══════════════════════════════════════════════════════════════");
console.log("  UCL R16 FIRST LEG — BLIND VARIANCE MODEL ASSESSMENT");
console.log("  Generated: " + new Date().toISOString());
console.log("  NOTE: Model has NO knowledge of Ted's picks");
console.log("═══════════════════════════════════════════════════════════════\n");

let totalBets = 0;

for (const m of MATCHES) {
  console.log(`\n───────────────────────────────────────────────────────────────`);
  console.log(`  ${m.home} vs ${m.away}  (${m.date})`);
  console.log(`───────────────────────────────────────────────────────────────`);

  if (!m.homeLeague && !m.awayLeague) {
    console.log("  STATUS: INSUFFICIENT DATA");
    console.log("  No Understat data for either team's domestic league\n");
    continue;
  }

  const homeLeagueData = loadLeague(m.homeLeague);
  const awayLeagueData = loadLeague(m.awayLeague);

  const homeTeamData = findTeam(homeLeagueData, m.homeUS);
  const awayTeamData = findTeam(awayLeagueData, m.awayUS);

  if (!homeTeamData && !awayTeamData) {
    console.log("  STATUS: INSUFFICIENT DATA (teams not found in cache)\n");
    continue;
  }

  // Get venue-split stats
  const homeStats = homeTeamData ? aggregateMatches(homeTeamData.history, "h") : null;
  const awayStats = awayTeamData ? aggregateMatches(awayTeamData.history, "a") : null;

  // Full-season stats
  const homeFullStats = homeTeamData ? aggregateMatches(homeTeamData.history, null) : null;
  const awayFullStats = awayTeamData ? aggregateMatches(awayTeamData.history, null) : null;

  if (!homeStats && !m.homeLeague) {
    // Partial: no home data (e.g., Galatasaray)
    if (awayStats) {
      const awayV = computeVariance(awayStats, m.away, "a");
      const awayFullV = awayFullStats ? computeVariance(awayFullStats, m.away, null) : null;
      console.log(`  STATUS: PARTIAL — No data for ${m.home}`);
      console.log(`\n  ${m.away} (away, ${m.awayLeague}):`);
      console.log(`    Quality: ${awayV.qualityTier} | xGD/match: ${awayV.xGDPerMatch}`);
      console.log(`    Variance: ${awayV.totalVariance} | Signal: ${awayV.signal}`);
      console.log(`    Dominant: ${awayV.dominantType} | Regression: ${awayV.regressionDirection}`);
      console.log(`    Confidence: ${awayV.regressionConfidence}`);
      if (awayFullV) console.log(`    Full season: ${awayFullV.matches}m, xGD/m: ${awayFullV.xGDPerMatch}, quality: ${awayFullV.qualityTier}`);
      console.log(`\n  VERDICT: Cannot assess without both teams' data`);
    }
    continue;
  }

  if (!homeStats || !awayStats) {
    console.log(`  STATUS: INSUFFICIENT DATA (home=${!!homeStats}, away=${!!awayStats})\n`);
    continue;
  }

  const homeV = computeVariance(homeStats, m.home, "h");
  const awayV = computeVariance(awayStats, m.away, "a");
  const assessment = assessMatch(homeV, awayV);

  const homeFullV = homeFullStats ? computeVariance(homeFullStats, m.home, null) : null;
  const awayFullV = awayFullStats ? computeVariance(awayFullStats, m.away, null) : null;

  console.log(`\n  ${m.home} (home, ${m.homeLeague}):`);
  console.log(`    Matches: ${homeV.matches} | xG: ${homeV.xGFor} | xGA: ${homeV.xGAgainst}`);
  console.log(`    Goals: ${homeV.goalsFor} | Conceded: ${homeV.goalsAgainst}`);
  console.log(`    xGD: ${homeV.xGD} | Actual GD: ${homeV.actualGD} | Variance: ${homeV.totalVariance}`);
  console.log(`    Quality: ${homeV.qualityTier} | xGD/m: ${homeV.xGDPerMatch}`);
  console.log(`    Atk var: ${homeV.attackVariance} | Def var: ${homeV.defenseVariance} | Dominant: ${homeV.dominantType}`);
  console.log(`    Signal: ${homeV.signal} | Regression: ${homeV.regressionDirection} | Conf: ${homeV.regressionConfidence}`);
  if (homeV.doubleVariance) console.log(`    ** DOUBLE VARIANCE **`);
  if (homeFullV) console.log(`    Full season: ${homeFullV.matches}m, xGD/m: ${homeFullV.xGDPerMatch}, quality: ${homeFullV.qualityTier}`);

  console.log(`\n  ${m.away} (away, ${m.awayLeague}):`);
  console.log(`    Matches: ${awayV.matches} | xG: ${awayV.xGFor} | xGA: ${awayV.xGAgainst}`);
  console.log(`    Goals: ${awayV.goalsFor} | Conceded: ${awayV.goalsAgainst}`);
  console.log(`    xGD: ${awayV.xGD} | Actual GD: ${awayV.actualGD} | Variance: ${awayV.totalVariance}`);
  console.log(`    Quality: ${awayV.qualityTier} | xGD/m: ${awayV.xGDPerMatch}`);
  console.log(`    Atk var: ${awayV.attackVariance} | Def var: ${awayV.defenseVariance} | Dominant: ${awayV.dominantType}`);
  console.log(`    Signal: ${awayV.signal} | Regression: ${awayV.regressionDirection} | Conf: ${awayV.regressionConfidence}`);
  if (awayV.doubleVariance) console.log(`    ** DOUBLE VARIANCE **`);
  if (awayFullV) console.log(`    Full season: ${awayFullV.matches}m, xGD/m: ${awayFullV.xGDPerMatch}, quality: ${awayFullV.qualityTier}`);

  console.log(`\n  ─── ASSESSMENT ───`);
  console.log(`    Edge: ${assessment.edgePct}% → ${assessment.edgeSide} (${assessment.magnitude})`);

  if (assessment.hasBet) {
    totalBets++;
    console.log(`    *** BET: ${assessment.betSide.toUpperCase()} — Grade ${assessment.grade} — Confidence ${assessment.confidence} ***`);
  } else {
    console.log(`    NO BET`);
  }

  if (assessment.positiveFactors.length > 0) {
    console.log(`    Positive factors:`);
    assessment.positiveFactors.forEach(f => console.log(`      + ${f}`));
  }
  if (assessment.passReasons.length > 0) {
    console.log(`    Pass reasons:`);
    assessment.passReasons.forEach(f => console.log(`      - ${f}`));
  }
}

console.log(`\n═══════════════════════════════════════════════════════════════`);
console.log(`  SUMMARY: ${totalBets} bets recommended out of ${MATCHES.length} matches`);
console.log(`═══════════════════════════════════════════════════════════════\n`);
