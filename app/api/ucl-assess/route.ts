/**
 * UCL Match Assessment — Blind variance model predictions for Champions League R16
 *
 * Uses each team's DOMESTIC league xG data to run our variance model.
 * This produces assessments without any knowledge of Ted's picks.
 */

import { NextResponse } from "next/server";
import { calculateTeamVariance } from "@/lib/variance/calculator";
import { assessMatch } from "@/lib/variance/match-assessor";
import type { TeamXg } from "@/lib/types";
import fs from "fs";
import path from "path";

// ─── UCL R16 First Leg Matches (March 10-11, 2026) ─────────────────────────

interface UCLMatch {
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeLeague: string;
  awayLeague: string;
  homeUnderstat: string;
  awayUnderstat: string;
}

const UCL_R16_FIRST_LEGS: UCLMatch[] = [
  { date: "2026-03-10", homeTeam: "Galatasaray", awayTeam: "Liverpool", homeLeague: "", awayLeague: "premierLeague", homeUnderstat: "", awayUnderstat: "Liverpool" },
  { date: "2026-03-10", homeTeam: "Atalanta", awayTeam: "Bayern Munich", homeLeague: "serieA", awayLeague: "bundesliga", homeUnderstat: "Atalanta", awayUnderstat: "Bayern Munich" },
  { date: "2026-03-10", homeTeam: "Atletico Madrid", awayTeam: "Tottenham", homeLeague: "laLiga", awayLeague: "premierLeague", homeUnderstat: "Atletico Madrid", awayUnderstat: "Tottenham" },
  { date: "2026-03-10", homeTeam: "Newcastle", awayTeam: "Barcelona", homeLeague: "premierLeague", awayLeague: "laLiga", homeUnderstat: "Newcastle United", awayUnderstat: "Barcelona" },
  { date: "2026-03-11", homeTeam: "Leverkusen", awayTeam: "Arsenal", homeLeague: "bundesliga", awayLeague: "premierLeague", homeUnderstat: "Bayer Leverkusen", awayUnderstat: "Arsenal" },
  { date: "2026-03-11", homeTeam: "Bodo/Glimt", awayTeam: "Sporting CP", homeLeague: "", awayLeague: "", homeUnderstat: "", awayUnderstat: "" },
  { date: "2026-03-11", homeTeam: "PSG", awayTeam: "Chelsea", homeLeague: "ligue1", awayLeague: "premierLeague", homeUnderstat: "Paris Saint Germain", awayUnderstat: "Chelsea" },
  { date: "2026-03-11", homeTeam: "Real Madrid", awayTeam: "Man City", homeLeague: "laLiga", awayLeague: "premierLeague", homeUnderstat: "Real Madrid", awayUnderstat: "Manchester City" },
];

const LEAGUE_CACHE_FILES: Record<string, string> = {
  premierLeague: "premierLeague-2025.json",
  serieA: "serieA-2025.json",
  laLiga: "laLiga-2025.json",
  bundesliga: "bundesliga-2025.json",
  ligue1: "ligue1-2025.json",
};

interface UnderstatMatch {
  h_a: "h" | "a";
  xG: number;
  xGA: number;
  scored: number;
  missed: number;
  date: string;
}

interface UnderstatTeamData {
  id: string;
  title: string;
  history: UnderstatMatch[];
}

interface UnderstatLeagueData {
  teams: Record<string, UnderstatTeamData>;
}

function loadLeagueData(league: string): UnderstatLeagueData | null {
  const file = LEAGUE_CACHE_FILES[league];
  if (!file) return null;
  const filePath = path.join(process.cwd(), "data", "understat-cache", file);
  console.log(`[ucl-assess] Loading ${league} from ${filePath}...`);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);

    // Handle two cache formats:
    // 1. Raw Understat API format: { teams: { "123": { id, title, history } } }
    // 2. UnderstatCacheEntry format: { rawHistory: [{ team, matches }], venueSplits: [...] }
    if (parsed.teams && !parsed.rawHistory) {
      console.log(`[ucl-assess]   ${league}: raw Understat format, ${Object.keys(parsed.teams).length} teams`);
      return parsed as UnderstatLeagueData;
    }

    if (parsed.rawHistory) {
      // Convert UnderstatCacheEntry format to the raw format expected by getTeamXg
      console.log(`[ucl-assess]   ${league}: UnderstatCacheEntry format, ${parsed.rawHistory.length} teams`);
      const teams: Record<string, UnderstatTeamData> = {};
      for (const teamData of parsed.rawHistory) {
        const id = teamData.team.replace(/\s/g, "_").toLowerCase();
        teams[id] = {
          id,
          title: teamData.team,
          history: teamData.matches.map((m: { date: string; h_a: "h" | "a"; xG: number; xGA: number; scored: number; missed: number }) => ({
            h_a: m.h_a,
            xG: m.xG,
            xGA: m.xGA,
            scored: m.scored,
            missed: m.missed,
            date: m.date,
          })),
        };
      }
      return { teams };
    }

    console.log(`[ucl-assess]   ${league}: unknown format, keys: ${Object.keys(parsed).join(", ")}`);
    return null;
  } catch (e) {
    console.error(`[ucl-assess]   ${league}: failed to load:`, e);
    return null;
  }
}

function getTeamXg(leagueData: UnderstatLeagueData, teamName: string, venue?: "h" | "a"): TeamXg | null {
  const teamEntry = Object.values(leagueData.teams).find(
    (t) => t.title.toLowerCase() === teamName.toLowerCase()
  );
  if (!teamEntry) return null;

  let matches = teamEntry.history;
  if (venue) {
    matches = matches.filter((m) => m.h_a === venue);
  }
  if (matches.length === 0) return null;

  const xGFor = matches.reduce((s, m) => s + m.xG, 0);
  const xGAgainst = matches.reduce((s, m) => s + m.xGA, 0);
  const goalsFor = matches.reduce((s, m) => s + m.scored, 0);
  const goalsAgainst = matches.reduce((s, m) => s + m.missed, 0);

  return {
    team: teamName,
    xGFor: Math.round(xGFor * 100) / 100,
    xGAgainst: Math.round(xGAgainst * 100) / 100,
    goalsFor,
    goalsAgainst,
    xGDiff: Math.round((xGFor - xGAgainst) * 100) / 100,
    overperformance: Math.round((goalsFor - xGFor) * 100) / 100,
    matches: matches.length,
  };
}

export async function GET() {
  console.log("[ucl-assess] === UCL R16 Variance Assessment ===");
  console.log(`[ucl-assess] Processing ${UCL_R16_FIRST_LEGS.length} matches...`);

  const results: any[] = [];
  const leagueCache: Record<string, UnderstatLeagueData | null> = {};

  // Pre-load all required leagues
  const requiredLeagues = new Set<string>();
  for (const match of UCL_R16_FIRST_LEGS) {
    if (match.homeLeague) requiredLeagues.add(match.homeLeague);
    if (match.awayLeague) requiredLeagues.add(match.awayLeague);
  }
  console.log(`[ucl-assess] Required leagues: ${[...requiredLeagues].join(", ")}`);
  for (const league of requiredLeagues) {
    leagueCache[league] = loadLeagueData(league);
  }
  const loadedCount = Object.values(leagueCache).filter(Boolean).length;
  console.log(`[ucl-assess] Loaded ${loadedCount}/${requiredLeagues.size} leagues`);

  for (const match of UCL_R16_FIRST_LEGS) {
    console.log(`[ucl-assess] --- ${match.homeTeam} vs ${match.awayTeam} ---`);
    if (!match.homeLeague && !match.awayLeague) {
      results.push({
        match: `${match.homeTeam} vs ${match.awayTeam}`,
        date: match.date,
        status: "insufficient_data",
        reason: `No domestic league xG data available for ${match.homeTeam} or ${match.awayTeam} (leagues not covered by Understat)`,
      });
      continue;
    }

    let homeXg: TeamXg | null = null;
    let homeFullXg: TeamXg | null = null;
    if (match.homeLeague && leagueCache[match.homeLeague]) {
      homeXg = getTeamXg(leagueCache[match.homeLeague]!, match.homeUnderstat, "h");
      homeFullXg = getTeamXg(leagueCache[match.homeLeague]!, match.homeUnderstat);
    }

    let awayXg: TeamXg | null = null;
    let awayFullXg: TeamXg | null = null;
    if (match.awayLeague && leagueCache[match.awayLeague]) {
      awayXg = getTeamXg(leagueCache[match.awayLeague]!, match.awayUnderstat, "a");
      awayFullXg = getTeamXg(leagueCache[match.awayLeague]!, match.awayUnderstat);
    }

    if (!homeXg && !match.homeLeague) {
      if (!awayXg) {
        results.push({
          match: `${match.homeTeam} vs ${match.awayTeam}`,
          date: match.date,
          status: "insufficient_data",
          reason: `No xG data for either team`,
        });
        continue;
      }
      const awayVariance = calculateTeamVariance(awayXg, { venue: "away" });
      results.push({
        match: `${match.homeTeam} vs ${match.awayTeam}`,
        date: match.date,
        status: "partial_data",
        reason: `No Understat data for ${match.homeTeam} (league not covered). Away team analysis only.`,
        awayTeamAnalysis: {
          team: match.awayTeam,
          league: match.awayLeague,
          xGD: awayFullXg?.xGDiff,
          xGDPerMatch: awayVariance.xGDPerMatch,
          qualityTier: awayVariance.qualityTier,
          signal: awayVariance.signal,
          dominantType: awayVariance.dominantType,
          totalVariance: awayVariance.totalVariance,
          regressionDirection: awayVariance.regressionDirection,
          regressionConfidence: awayVariance.regressionConfidence,
          matches: awayVariance.matches,
          explanation: awayVariance.explanation,
        },
      });
      continue;
    }

    if (!homeXg || !awayXg) {
      results.push({
        match: `${match.homeTeam} vs ${match.awayTeam}`,
        date: match.date,
        status: "insufficient_data",
        reason: `Missing xG data: home=${!!homeXg}, away=${!!awayXg}`,
      });
      continue;
    }

    const homeVariance = calculateTeamVariance(homeXg, { venue: "home" });
    const awayVariance = calculateTeamVariance(awayXg, { venue: "away" });
    const assessment = assessMatch(homeVariance, awayVariance);
    console.log(`[ucl-assess]   Home: ${homeVariance.qualityTier} (${homeVariance.signal}) | Away: ${awayVariance.qualityTier} (${awayVariance.signal})`);
    console.log(`[ucl-assess]   Edge: ${assessment.edgeSide} (${assessment.edgeMagnitude}) | Bet: ${assessment.hasBet ? `${assessment.betSide} Grade ${assessment.betGrade}` : "PASS"}`);

    const homeFullVariance = homeFullXg ? calculateTeamVariance(homeFullXg) : null;
    const awayFullVariance = awayFullXg ? calculateTeamVariance(awayFullXg) : null;

    results.push({
      match: `${match.homeTeam} vs ${match.awayTeam}`,
      date: match.date,
      status: "assessed",
      assessment: {
        hasBet: assessment.hasBet,
        betSide: assessment.betSide,
        betGrade: assessment.betGrade,
        confidence: assessment.confidence,
        varianceEdge: assessment.varianceEdge,
        edgeSide: assessment.edgeSide,
        edgeMagnitude: assessment.edgeMagnitude,
        betReasoning: assessment.betReasoning,
        positiveFactors: assessment.positiveFactors,
        passReasons: assessment.passReasons,
      },
      homeTeam: {
        name: match.homeTeam,
        league: match.homeLeague,
        venueMatches: homeXg.matches,
        venueXGD: homeXg.xGDiff,
        venueXGDPerMatch: homeVariance.xGDPerMatch,
        qualityTier: homeVariance.qualityTier,
        signal: homeVariance.signal,
        dominantType: homeVariance.dominantType,
        totalVariance: homeVariance.totalVariance,
        attackVariance: homeVariance.attackVariance,
        defenseVariance: homeVariance.defenseVariance,
        regressionDirection: homeVariance.regressionDirection,
        regressionConfidence: homeVariance.regressionConfidence,
        doubleVariance: homeVariance.doubleVariance,
        explanation: homeVariance.explanation,
        fullSeason: homeFullVariance ? {
          matches: homeFullVariance.matches,
          xGDPerMatch: homeFullVariance.xGDPerMatch,
          qualityTier: homeFullVariance.qualityTier,
          totalVariance: homeFullVariance.totalVariance,
        } : null,
      },
      awayTeam: {
        name: match.awayTeam,
        league: match.awayLeague,
        venueMatches: awayXg.matches,
        venueXGD: awayXg.xGDiff,
        venueXGDPerMatch: awayVariance.xGDPerMatch,
        qualityTier: awayVariance.qualityTier,
        signal: awayVariance.signal,
        dominantType: awayVariance.dominantType,
        totalVariance: awayVariance.totalVariance,
        attackVariance: awayVariance.attackVariance,
        defenseVariance: awayVariance.defenseVariance,
        regressionDirection: awayVariance.regressionDirection,
        regressionConfidence: awayVariance.regressionConfidence,
        doubleVariance: awayVariance.doubleVariance,
        explanation: awayVariance.explanation,
        fullSeason: awayFullVariance ? {
          matches: awayFullVariance.matches,
          xGDPerMatch: awayFullVariance.xGDPerMatch,
          qualityTier: awayFullVariance.qualityTier,
          totalVariance: awayFullVariance.totalVariance,
        } : null,
      },
    });
  }

  const assessed = results.filter((r) => r.status === "assessed");
  const bets = assessed.filter((r) => r.assessment?.hasBet);

  return NextResponse.json({
    title: "UCL R16 First Leg — Blind Variance Model Assessment",
    generatedAt: new Date().toISOString(),
    note: "Assessments based on domestic league xG data (Understat 2025-26). Model has NO knowledge of Ted's picks.",
    summary: {
      totalMatches: UCL_R16_FIRST_LEGS.length,
      assessed: assessed.length,
      betsRecommended: bets.length,
      insufficientData: results.filter((r) => r.status === "insufficient_data").length,
      partialData: results.filter((r) => r.status === "partial_data").length,
    },
    matches: results,
  });
}
