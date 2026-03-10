/**
 * Championship Blind Assessment — standalone script
 * Uses Fotmob aggregate xG + home/away goal splits to run variance model
 * on upcoming Championship matches.
 *
 * Data source: Fotmob league 48 (Championship 2025/26)
 * No per-match xG available — we use season aggregates + venue goal splits.
 */

// ─── Championship team xG data (from Fotmob, fetched 2026-03-10) ────────────
// Format: { team, xGFor, xGAgainst, goalsFor, goalsAgainst, matches,
//           homeGF, homeGA, homeMP, awayGF, awayGA, awayMP }

const TEAMS = {
  "Ipswich Town":          { xGFor: 58.85, xGAgainst: 32.18, goalsFor: 61, goalsAgainst: 35, matches: 35, homeGF: 35, homeGA: 13, homeMP: 19, awayGF: 26, awayGA: 22, awayMP: 16 },
  "Coventry City":         { xGFor: 65.74, xGAgainst: 38.92, goalsFor: 74, goalsAgainst: 38, matches: 36, homeGF: 36, homeGA: 13, homeMP: 17, awayGF: 38, awayGA: 25, awayMP: 19 },
  "Middlesbrough":         { xGFor: 48.99, xGAgainst: 33.55, goalsFor: 58, goalsAgainst: 35, matches: 36, homeGF: 26, homeGA: 12, homeMP: 17, awayGF: 32, awayGA: 23, awayMP: 19 },
  "Birmingham City":       { xGFor: 50.89, xGAgainst: 36.67, goalsFor: 46, goalsAgainst: 47, matches: 36, homeGF: 31, homeGA: 18, homeMP: 17, awayGF: 15, awayGA: 29, awayMP: 19 },
  "Southampton":           { xGFor: 59.19, xGAgainst: 42.91, goalsFor: 57, goalsAgainst: 46, matches: 35, homeGF: 26, homeGA: 14, homeMP: 17, awayGF: 31, awayGA: 32, awayMP: 18 },
  "Sheffield United":      { xGFor: 55.66, xGAgainst: 43.46, goalsFor: 51, goalsAgainst: 49, matches: 36, homeGF: 29, homeGA: 21, homeMP: 18, awayGF: 22, awayGA: 28, awayMP: 18 },
  "Millwall":              { xGFor: 50.49, xGAgainst: 43.65, goalsFor: 50, goalsAgainst: 41, matches: 36, homeGF: 26, homeGA: 21, homeMP: 18, awayGF: 24, awayGA: 20, awayMP: 18 },
  "Watford":               { xGFor: 43.76, xGAgainst: 36.27, goalsFor: 45, goalsAgainst: 41, matches: 35, homeGF: 26, homeGA: 19, homeMP: 18, awayGF: 19, awayGA: 22, awayMP: 17 },
  "West Bromwich Albion":  { xGFor: 41.69, xGAgainst: 38.09, goalsFor: 35, goalsAgainst: 53, matches: 36, homeGF: 19, homeGA: 22, homeMP: 17, awayGF: 16, awayGA: 31, awayMP: 19 },
  "Blackburn Rovers":      { xGFor: 44.71, xGAgainst: 40.28, goalsFor: 34, goalsAgainst: 47, matches: 36, homeGF: 18, homeGA: 25, homeMP: 19, awayGF: 16, awayGA: 22, awayMP: 17 },
  "Derby County":          { xGFor: 41.88, xGAgainst: 42.41, goalsFor: 54, goalsAgainst: 47, matches: 36, homeGF: 26, homeGA: 25, homeMP: 19, awayGF: 28, awayGA: 22, awayMP: 17 },
  "Queens Park Rangers":   { xGFor: 42.04, xGAgainst: 44.33, goalsFor: 46, goalsAgainst: 58, matches: 36, homeGF: 29, homeGA: 30, homeMP: 18, awayGF: 17, awayGA: 28, awayMP: 18 },
  "Portsmouth":            { xGFor: 39.51, xGAgainst: 40.53, goalsFor: 35, goalsAgainst: 45, matches: 35, homeGF: 18, homeGA: 17, homeMP: 17, awayGF: 17, awayGA: 28, awayMP: 18 },
  "Bristol City":          { xGFor: 44.61, xGAgainst: 45.83, goalsFor: 48, goalsAgainst: 46, matches: 36, homeGF: 28, homeGA: 26, homeMP: 19, awayGF: 20, awayGA: 20, awayMP: 17 },
  "Wrexham":               { xGFor: 43.64, xGAgainst: 44.93, goalsFor: 54, goalsAgainst: 45, matches: 35, homeGF: 33, homeGA: 28, homeMP: 18, awayGF: 21, awayGA: 17, awayMP: 17 },
  "Norwich City":          { xGFor: 46.39, xGAgainst: 50.39, goalsFor: 47, goalsAgainst: 44, matches: 35, homeGF: 19, homeGA: 22, homeMP: 17, awayGF: 28, awayGA: 22, awayMP: 18 },
  "Swansea City":          { xGFor: 37.65, xGAgainst: 41.95, goalsFor: 42, goalsAgainst: 43, matches: 36, homeGF: 28, homeGA: 19, homeMP: 19, awayGF: 14, awayGA: 24, awayMP: 17 },
  "Charlton Athletic":     { xGFor: 35.81, xGAgainst: 47.86, goalsFor: 34, goalsAgainst: 44, matches: 36, homeGF: 18, homeGA: 18, homeMP: 18, awayGF: 16, awayGA: 26, awayMP: 18 },
  "Stoke City":            { xGFor: 37.66, xGAgainst: 47.43, goalsFor: 39, goalsAgainst: 36, matches: 36, homeGF: 23, homeGA: 17, homeMP: 17, awayGF: 16, awayGA: 19, awayMP: 19 },
  "Oxford United":         { xGFor: 36.89, xGAgainst: 48.56, goalsFor: 34, goalsAgainst: 48, matches: 36, homeGF: 15, homeGA: 23, homeMP: 17, awayGF: 19, awayGA: 25, awayMP: 19 },
  "Preston North End":     { xGFor: 38.62, xGAgainst: 51.80, goalsFor: 42, goalsAgainst: 43, matches: 36, homeGF: 23, homeGA: 23, homeMP: 19, awayGF: 19, awayGA: 20, awayMP: 17 },
  "Hull City":             { xGFor: 47.33, xGAgainst: 63.80, goalsFor: 57, goalsAgainst: 52, matches: 36, homeGF: 29, homeGA: 31, homeMP: 19, awayGF: 28, awayGA: 21, awayMP: 17 },
  "Leicester City":        { xGFor: 37.56, xGAgainst: 53.91, goalsFor: 48, goalsAgainst: 57, matches: 36, homeGF: 23, homeGA: 25, homeMP: 17, awayGF: 25, awayGA: 32, awayMP: 19 },
  "Sheffield Wednesday":   { xGFor: 29.56, xGAgainst: 69.42, goalsFor: 22, goalsAgainst: 73, matches: 36, homeGF: 9, homeGA: 38, homeMP: 18, awayGF: 13, awayGA: 35, awayMP: 18 },
};

// ─── Upcoming Championship Matches (March 14-18, 2026) ──────────────────────

const MATCHES = [
  { date: "2026-03-14", home: "Coventry City",         away: "Southampton" },
  { date: "2026-03-14", home: "Middlesbrough",          away: "Bristol City" },
  { date: "2026-03-14", home: "Oxford United",           away: "Charlton Athletic" },
  { date: "2026-03-14", home: "Birmingham City",         away: "Sheffield United" },
  { date: "2026-03-14", home: "Leicester City",          away: "Queens Park Rangers" },
  { date: "2026-03-14", home: "Millwall",                away: "Blackburn Rovers" },
  { date: "2026-03-14", home: "Norwich City",            away: "Preston North End" },
  { date: "2026-03-14", home: "Sheffield Wednesday",     away: "Ipswich Town" },
  { date: "2026-03-14", home: "Stoke City",              away: "Watford" },
  { date: "2026-03-14", home: "West Bromwich Albion",    away: "Hull City" },
  { date: "2026-03-16", home: "Portsmouth",              away: "Derby County" },
  { date: "2026-03-17", home: "Watford",                 away: "Wrexham" },
  { date: "2026-03-18", home: "Southampton",             away: "Norwich City" },
  { date: "2026-03-20", home: "Preston North End",       away: "Stoke City" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function r(v) { return Math.round(v * 100) / 100; }

// ─── Variance calculator (adapted for aggregate data) ───────────────────────
// Since we only have season aggregates, we derive per-match rates and
// estimate venue-specific xG using the venue goal ratio.

function computeVariance(teamName, venue) {
  const t = TEAMS[teamName];
  if (!t) return null;

  let gf, ga, mp, xGFor, xGAgainst;

  if (venue === "h") {
    gf = t.homeGF; ga = t.homeGA; mp = t.homeMP;
    // Estimate venue xG by scaling season xG by venue goal proportion
    const gfRatio = t.goalsFor > 0 ? t.homeGF / t.goalsFor : 0.5;
    const gaRatio = t.goalsAgainst > 0 ? t.homeGA / t.goalsAgainst : 0.5;
    xGFor = t.xGFor * gfRatio;
    xGAgainst = t.xGAgainst * gaRatio;
  } else if (venue === "a") {
    gf = t.awayGF; ga = t.awayGA; mp = t.awayMP;
    const gfRatio = t.goalsFor > 0 ? t.awayGF / t.goalsFor : 0.5;
    const gaRatio = t.goalsAgainst > 0 ? t.awayGA / t.goalsAgainst : 0.5;
    xGFor = t.xGFor * gfRatio;
    xGAgainst = t.xGAgainst * gaRatio;
  } else {
    gf = t.goalsFor; ga = t.goalsAgainst; mp = t.matches;
    xGFor = t.xGFor; xGAgainst = t.xGAgainst;
  }

  const xGD = xGFor - xGAgainst;
  const actualGD = gf - ga;
  const attackVar = gf - xGFor;
  const defenseVar = ga - xGAgainst;
  const totalVar = actualGD - xGD;
  const xGDPerMatch = mp > 0 ? xGD / mp : 0;

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

  const persistentDefiance = mp >= 15 && absTotal > 5;
  const doubleVariance = attackVar > 2 && defenseVar > 2;

  // Regression confidence
  let confidence = 0.5;
  if (absTotal > 5) confidence += 0.2;
  if (absTotal > 8) confidence += 0.1;
  if (dominantType === "defense_underperf") confidence += 0.15;
  if (dominantType === "attack_overperf") confidence -= 0.1;
  if (mp >= 10) confidence += 0.1;
  if (mp < 5) confidence -= 0.15;
  if (persistentDefiance) confidence -= 0.2;
  if (qualityTier === "bad") confidence -= 0.15;
  if (qualityTier === "poor") confidence -= 0.05;
  confidence = Math.max(0, Math.min(1, confidence));

  let regressionDir = "stable";
  if (signal.includes("positive")) regressionDir = "decline";
  else if (signal.includes("negative")) regressionDir = "improve";

  return {
    team: teamName, matches: mp,
    xGFor: r(xGFor), xGAgainst: r(xGAgainst), goalsFor: gf, goalsAgainst: ga,
    xGD: r(xGD), actualGD,
    attackVariance: r(attackVar), defenseVariance: r(defenseVar), totalVariance: r(totalVar),
    xGDPerMatch: r(xGDPerMatch), qualityTier, signal, dominantType,
    persistentDefiance, doubleVariance,
    regressionConfidence: r(confidence), regressionDirection: regressionDir,
  };
}

// ─── Match assessor (same logic as UCL script) ──────────────────────────────

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

  // Pass reasons (optimized thresholds from sweep: edge=0.02, conf=0.7, drawGap=0.20, persist=OFF)
  const pass = [];
  if (absEdge < 0.02) pass.push("Edge below 2%");
  if (favV.signal === "neutral") pass.push("Favored side has no variance signal");
  if (favV.regressionConfidence < 0.7) pass.push("Low regression confidence");
  if (favV.qualityTier === "bad" && favV.regressionDirection === "improve")
    pass.push(`${favV.team} is genuinely bad (not unlucky)`);
  // persistentDefiance filter DISABLED — sweep proved it's toxic to ROI
  if (favV.doubleVariance) pass.push(`${favV.team} has double variance — illusory stability`);

  const qualityGap = Math.abs(homeV.xGDPerMatch - awayV.xGDPerMatch);
  if (qualityGap < 0.20 && magnitude !== "strong")
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

console.log("═══════════════════════════════════════════════════════════════");
console.log("  CHAMPIONSHIP — BLIND VARIANCE MODEL ASSESSMENT");
console.log("  Generated: " + new Date().toISOString());
console.log("  Data source: Fotmob aggregate xG (Championship 2025/26)");
console.log("  NOTE: Model has NO knowledge of Ted's picks");
console.log("  NOTE: Using estimated venue xG (scaled from season aggregates)");
console.log("═══════════════════════════════════════════════════════════════\n");

console.log(`[PROGRESS] Processing ${MATCHES.length} matches...\n`);

let totalBets = 0;
let matchNum = 0;

for (const m of MATCHES) {
  matchNum++;
  console.log(`[PROGRESS] Match ${matchNum}/${MATCHES.length}: ${m.home} vs ${m.away}`);
  console.log(`\n───────────────────────────────────────────────────────────────`);
  console.log(`  ${m.home} vs ${m.away}  (${m.date})`);
  console.log(`───────────────────────────────────────────────────────────────`);

  const homeData = TEAMS[m.home];
  const awayData = TEAMS[m.away];

  if (!homeData || !awayData) {
    console.log(`  STATUS: INSUFFICIENT DATA (home=${!!homeData}, away=${!!awayData})\n`);
    continue;
  }

  // Compute venue-specific variance
  const homeV = computeVariance(m.home, "h");
  const awayV = computeVariance(m.away, "a");

  // Also compute full-season for context
  const homeFullV = computeVariance(m.home, null);
  const awayFullV = computeVariance(m.away, null);

  if (!homeV || !awayV) {
    console.log(`  STATUS: COMPUTATION FAILED\n`);
    continue;
  }

  const assessment = assessMatch(homeV, awayV);

  console.log(`\n  ${m.home} (HOME):`);
  console.log(`    Matches: ${homeV.matches} | xG: ${homeV.xGFor} | xGA: ${homeV.xGAgainst}`);
  console.log(`    Goals: ${homeV.goalsFor} | Conceded: ${homeV.goalsAgainst}`);
  console.log(`    xGD: ${homeV.xGD} | Actual GD: ${homeV.actualGD} | Variance: ${homeV.totalVariance}`);
  console.log(`    Quality: ${homeV.qualityTier} | xGD/m: ${homeV.xGDPerMatch}`);
  console.log(`    Atk var: ${homeV.attackVariance} | Def var: ${homeV.defenseVariance} | Dominant: ${homeV.dominantType}`);
  console.log(`    Signal: ${homeV.signal} | Regression: ${homeV.regressionDirection} | Conf: ${homeV.regressionConfidence}`);
  if (homeV.doubleVariance) console.log(`    ** DOUBLE VARIANCE **`);
  if (homeFullV) console.log(`    Full season: ${homeFullV.matches}m, xGD/m: ${homeFullV.xGDPerMatch}, quality: ${homeFullV.qualityTier}`);

  console.log(`\n  ${m.away} (AWAY):`);
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
console.log(`═══════════════════════════════════════════════════════════════`);

// ─── Quick reference table ──────────────────────────────────────────────────
console.log(`\n  QUICK REFERENCE:`);
console.log(`  ${"Match".padEnd(42)} ${"Edge".padEnd(8)} ${"Side".padEnd(8)} ${"Mag".padEnd(10)} ${"Bet?".padEnd(6)} Grade`);
console.log(`  ${"─".repeat(85)}`);

matchNum = 0;
for (const m of MATCHES) {
  matchNum++;
  const homeV = computeVariance(m.home, "h");
  const awayV = computeVariance(m.away, "a");
  if (!homeV || !awayV) continue;
  const a = assessMatch(homeV, awayV);
  const label = `${m.home} vs ${m.away}`;
  const bet = a.hasBet ? `YES` : `no`;
  const grade = a.grade ?? "-";
  console.log(`  ${label.padEnd(42)} ${(a.edgePct + "%").padEnd(8)} ${a.edgeSide.padEnd(8)} ${a.magnitude.padEnd(10)} ${bet.padEnd(6)} ${grade}`);
}

console.log(`\n[PROGRESS] Done! ${totalBets} bets from ${MATCHES.length} matches.\n`);
