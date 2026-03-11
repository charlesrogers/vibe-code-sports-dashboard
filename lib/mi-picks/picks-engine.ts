/**
 * MI Picks Engine — Core orchestration for today's picks
 *
 * Loads pre-computed solver params, gets upcoming fixtures from live-odds,
 * runs MI model predictions, applies Ted filters, and assigns grades.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { predictMatch, predictMatchFromLambdas } from "../mi-model/predictor";
import { fetchInjuriesForTeams } from "../injuries";
import { adjustLambdas } from "./injury-adjust";
import { devigOdds1X2, devigOdds2Way } from "../mi-model/data-prep";
import type { MIModelParams, MatchPrediction } from "../mi-model/types";
import { MI_LEAGUES, type LeagueConfig } from "./league-config";
import { fitDixonColes, predictMatch as dcPredictMatch } from "../models/dixon-coles";
import { derive1X2 as dcDerive1X2 } from "../betting/markets";
import { calculateEloRatings, eloWinProbability } from "../models/elo";
import { loadCachedXg } from "../xg-cache";
import { fetchTeamXgFromFotmob } from "../fotmob";
import { normalizeTeamName as resolveCanonical } from "../team-mapping";
import { calculateTeamVariance } from "../variance/calculator";
import { assessMatch as tedAssessMatch } from "../variance/match-assessor";
import type { TeamXg } from "../types";
import {
  buildTeamHistory,
  applyTedFilters,
  getVarianceSummary,
  tedReasonLabel,
  DEFAULT_TED_CONFIG,
  type TedFilterConfig,
} from "./ted-filters";

const projectRoot = join(process.cwd());
const paramsDir = join(projectRoot, "data", "mi-params", "latest");
const dataDir = join(projectRoot, "data", "football-data-cache");
const liveOddsDir = join(projectRoot, "data", "live-odds");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PickValueBet {
  marketType: "1X2" | "AH";
  selection: string;
  ahLine?: number;
  modelProb: number;
  marketProb: number;
  edge: number;
  fairOdds: number;
  marketOdds: number;
}

export interface Pick {
  matchId: string;
  league: string;
  leagueLabel: string;
  date: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  prediction: {
    homeProb: number;
    drawProb: number;
    awayProb: number;
    expectedGoals: { home: number; away: number; total: number };
    mostLikelyScore: { home: number; away: number; prob: number };
  };
  pinnacleOdds: { home: number; draw: number; away: number } | null;
  fairOdds: { home: number; draw: number; away: number };
  valueBets: PickValueBet[];
  tedVerdict: "BET" | "PASS";
  tedReason: string | null;
  tedReasonLabel: string;
  grade: "A" | "B" | "C" | null;
  bestEdge: number;
  homeVariance: { isCandidate: boolean; gfGap: number; gaGap: number; direction: string } | null;
  awayVariance: { isCandidate: boolean; gfGap: number; gaGap: number; direction: string } | null;
  injuries?: {
    home: { severity: string; summary: string; totalOut: number } | null;
    away: { severity: string; summary: string; totalOut: number } | null;
    adjusted: boolean;
  };
  ensemble?: {
    dixonColes: { home: number; draw: number; away: number };
    elo: { home: number; draw: number; away: number; homeRating: number; awayRating: number };
    consensus: { home: number; draw: number; away: number };
    agreement: "strong" | "moderate" | "split";
  };
  tedAssessment?: {
    betGrade: "A" | "B" | "C" | null;
    confidence: number;
    edgeSide: "home" | "away" | "neutral";
    varianceEdge: number;
    positiveFactors: string[];
    passReasons: string[];
  };
  xg?: {
    home: { xGFor: number; xGAgainst: number; overperformance: number } | null;
    away: { xGFor: number; xGAgainst: number; overperformance: number } | null;
  };
}

export interface PicksSummary {
  generatedAt: string;
  leagues: string[];
  totalMatches: number;
  totalBets: number;
  avgEdge: number;
  byLeague: Record<string, { matches: number; bets: number; avgEdge: number }>;
  byGrade: Record<string, number>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadParams(leagueId: string): MIModelParams | null {
  const fp = join(paramsDir, `${leagueId}.json`);
  if (!existsSync(fp)) return null;
  try { return JSON.parse(readFileSync(fp, "utf-8")); }
  catch { return null; }
}

function loadPlayedMatches(league: LeagueConfig): any[] {
  const matches: any[] = [];
  for (const season of [league.currentSeason, league.previousSeason]) {
    const fp = join(dataDir, `${league.id}-${season}.json`);
    if (!existsSync(fp)) continue;
    try {
      const data = JSON.parse(readFileSync(fp, "utf-8"));
      matches.push(...(data.matches || []));
    } catch { continue; }
  }
  return matches.filter(m => m.homeGoals != null && m.awayGoals != null).sort((a, b) => a.date.localeCompare(b.date));
}

interface LiveOddsMatch {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  bookmakers: {
    bookmaker: string;
    bookmakerKey: string;
    homeOdds: number;
    drawOdds: number;
    awayOdds: number;
    overOdds?: number;
    overLine?: number;
    underOdds?: number;
    spreadHome?: number;
    spreadAway?: number;
    spreadLine?: number;
  }[];
}

function loadLiveOdds(oddsApiKey: string): LiveOddsMatch[] {
  if (!existsSync(liveOddsDir)) return [];

  // Find the most recent live odds file for this league
  const files = readdirSync(liveOddsDir)
    .filter(f => f.startsWith(`${oddsApiKey}-live-`) && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) return [];

  try {
    return JSON.parse(readFileSync(join(liveOddsDir, files[0]), "utf-8"));
  } catch { return []; }
}

function getPinnacleOdds(match: LiveOddsMatch): { home: number; draw: number; away: number } | null {
  const pinnacle = match.bookmakers.find(b => b.bookmakerKey === "pinnacle");
  if (!pinnacle || !pinnacle.homeOdds || !pinnacle.drawOdds || !pinnacle.awayOdds) return null;
  return { home: pinnacle.homeOdds, draw: pinnacle.drawOdds, away: pinnacle.awayOdds };
}

function getBestOdds(match: LiveOddsMatch): { home: number; draw: number; away: number } | null {
  // Prefer Pinnacle, fall back to average of sharp books
  const pinnacle = getPinnacleOdds(match);
  if (pinnacle) return pinnacle;

  const sharpKeys = ["pinnacle", "betfair_ex_eu", "matchbook", "betclic", "marathonbet"];
  const sharpBooks = match.bookmakers.filter(b => sharpKeys.includes(b.bookmakerKey));
  const books = sharpBooks.length > 0 ? sharpBooks : match.bookmakers;

  if (books.length === 0) return null;
  const avg = (field: "homeOdds" | "drawOdds" | "awayOdds") =>
    books.reduce((s, b) => s + (b[field] || 0), 0) / books.length;

  const home = avg("homeOdds");
  const draw = avg("drawOdds");
  const away = avg("awayOdds");
  if (home <= 1 || draw <= 1 || away <= 1) return null;
  return { home, draw, away };
}

function getBestSpreadOdds(match: LiveOddsMatch): { home: number; away: number; line: number } | null {
  // Prefer Pinnacle spread, fall back to sharp book average
  const sharpKeys = ["pinnacle", "betfair_ex_eu", "matchbook", "betclic", "marathonbet"];

  const pinnacle = match.bookmakers.find(b => b.bookmakerKey === "pinnacle" && b.spreadHome && b.spreadAway && b.spreadLine != null);
  if (pinnacle) {
    return { home: pinnacle.spreadHome!, away: pinnacle.spreadAway!, line: pinnacle.spreadLine! };
  }

  const withSpread = match.bookmakers.filter(b => b.spreadHome && b.spreadAway && b.spreadLine != null);
  if (withSpread.length === 0) return null;

  const sharpBooks = withSpread.filter(b => sharpKeys.includes(b.bookmakerKey ?? ""));
  const books = sharpBooks.length > 0 ? sharpBooks : withSpread;

  // All books should have the same line; use the most common one
  const lineCounts = new Map<number, number>();
  for (const b of books) {
    const l = b.spreadLine!;
    lineCounts.set(l, (lineCounts.get(l) || 0) + 1);
  }
  const bestLine = [...lineCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const sameLine = books.filter(b => b.spreadLine === bestLine);

  const avgHome = sameLine.reduce((s, b) => s + b.spreadHome!, 0) / sameLine.length;
  const avgAway = sameLine.reduce((s, b) => s + b.spreadAway!, 0) / sameLine.length;
  if (avgHome <= 1 || avgAway <= 1) return null;

  return { home: avgHome, away: avgAway, line: bestLine };
}

// ─── Team name normalization (Odds API → football-data-cache) ───────────────

const TEAM_NAME_MAP: Record<string, string> = {
  // EPL
  "Wolverhampton Wanderers": "Wolverhampton",
  "West Ham United": "West Ham",
  "Manchester United": "Man United",
  "Manchester City": "Man City",
  "Newcastle United": "Newcastle",
  "Nottingham Forest": "Nott'ham Forest",
  "Leicester City": "Leicester",
  "Ipswich Town": "Ipswich",
  "Brighton and Hove Albion": "Brighton",
  "Tottenham Hotspur": "Tottenham",
  // La Liga
  "Atletico Madrid": "Ath Madrid",
  "Athletic Bilbao": "Ath Bilbao",
  "Real Betis Balompié": "Betis",
  "Real Betis": "Betis",
  "Rayo Vallecano": "Vallecano",
  "Deportivo Alavés": "Alaves",
  "Deportivo Alaves": "Alaves",
  "RCD Mallorca": "Mallorca",
  "RC Celta de Vigo": "Celta",
  "Celta Vigo": "Celta",
  "Real Sociedad": "Sociedad",
  "CD Leganés": "Leganes",
  "UD Las Palmas": "Las Palmas",
  // Bundesliga
  "Bayern Munich": "Bayern Munich",
  "Borussia Dortmund": "Dortmund",
  "RB Leipzig": "RB Leipzig",
  "Bayer Leverkusen": "Leverkusen",
  "Borussia Monchengladbach": "M'gladbach",
  "Borussia Mönchengladbach": "M'gladbach",
  "Eintracht Frankfurt": "Ein Frankfurt",
  "1. FC Union Berlin": "Union Berlin",
  "FC Augsburg": "Augsburg",
  "VfL Wolfsburg": "Wolfsburg",
  "VfB Stuttgart": "Stuttgart",
  "VfL Bochum": "Bochum",
  "1. FSV Mainz 05": "Mainz",
  "TSG 1899 Hoffenheim": "Hoffenheim",
  "SC Freiburg": "Freiburg",
  "FC St. Pauli": "St Pauli",
  "Holstein Kiel": "Holstein Kiel",
  "1. FC Heidenheim 1846": "Heidenheim",
  // Serie A
  "AC Milan": "Milan",
  "Inter Milan": "Inter",
  "AS Roma": "Roma",
  "SS Lazio": "Lazio",
  "Hellas Verona": "Verona",
  "SSC Napoli": "Napoli",
  "US Lecce": "Lecce",
  "Parma Calcio 1913": "Parma",
  "Como 1907": "Como",
  "Venezia FC": "Venezia",
};

function normalizeTeamName(name: string): string {
  return TEAM_NAME_MAP[name] || name;
}

// ─── Main Engine ────────────────────────────────────────────────────────────

export async function generatePicks(
  leagueIds?: string[],
  tedConfig: TedFilterConfig = DEFAULT_TED_CONFIG,
): Promise<{ picks: Pick[]; summary: PicksSummary }> {
  const leagues = leagueIds
    ? MI_LEAGUES.filter(l => leagueIds.includes(l.id))
    : MI_LEAGUES;

  const allPicks: Pick[] = [];
  const byLeague: Record<string, { matches: number; bets: number; avgEdge: number }> = {};
  const byGrade: Record<string, number> = { A: 0, B: 0, C: 0 };

  for (const league of leagues) {
    const params = loadParams(league.id);
    if (!params) {
      console.log(`[picks] No params for ${league.id} — run solve-latest.ts first`);
      continue;
    }

    // Build team history from played matches for Ted filters
    const playedMatches = loadPlayedMatches(league);
    const { teamHistory, teamMatchDates, seasonMatchdayCount } = buildTeamHistory(
      playedMatches, params, tedConfig
    );

    // Fit Dixon-Coles + Elo on played matches (same data, different models)
    let dcParams: ReturnType<typeof fitDixonColes> | null = null;
    let eloMap = new Map<string, number>();
    try {
      dcParams = fitDixonColes(playedMatches);
      const eloRatings = calculateEloRatings(playedMatches);
      eloMap = new Map(eloRatings.map(e => [e.team, e.rating]));
    } catch (e) {
      console.log(`[picks] DC/Elo fit failed for ${league.id}: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Load xG data (cache first, Fotmob fallback)
    const xgMap = new Map<string, TeamXg>();
    try {
      const cached = await loadCachedXg(league.id);
      let xgData = cached?.teams ?? null;
      if (!xgData || xgData.length === 0) {
        xgData = await fetchTeamXgFromFotmob(league.id);
      }
      if (xgData) {
        for (const t of xgData) {
          xgMap.set(t.team, t); // keyed by canonical name
        }
      }
    } catch {
      // xG unavailable — picks work fine without
    }

    // Load upcoming fixtures from live odds
    const liveOdds = loadLiveOdds(league.oddsApiKey);
    const now = new Date();

    // Filter to upcoming matches only (commence time in the future)
    const upcoming = liveOdds.filter(m => new Date(m.commenceTime) > now);

    // Batch-fetch injuries for all teams in this league
    const allTeamNames = [...new Set(upcoming.flatMap(m => [normalizeTeamName(m.homeTeam), normalizeTeamName(m.awayTeam)]))];
    let injuryMap = new Map<string, import("../injuries").TeamInjuryReport>();
    try {
      injuryMap = await fetchInjuriesForTeams(allTeamNames, league.id);
    } catch (e) {
      console.log(`[picks] Injury fetch failed for ${league.id}: ${e instanceof Error ? e.message : String(e)}`);
    }

    let leagueMatches = 0;
    let leagueBets = 0;
    let leagueEdgeSum = 0;

    for (const match of upcoming) {
      const homeTeam = normalizeTeamName(match.homeTeam);
      const awayTeam = normalizeTeamName(match.awayTeam);

      // Check if both teams exist in model
      if (!params.teams[homeTeam] || !params.teams[awayTeam]) {
        continue;
      }

      leagueMatches++;

      // Run MI model prediction
      let pred: MatchPrediction;
      try { pred = predictMatch(params, homeTeam, awayTeam); }
      catch { continue; }

      // Apply injury adjustment
      const homeInjuries = injuryMap.get(homeTeam) ?? null;
      const awayInjuries = injuryMap.get(awayTeam) ?? null;
      const { lambdaHome: adjLH, lambdaAway: adjLA, homeAdj, awayAdj } = adjustLambdas(
        pred.lambdaHome, pred.lambdaAway, homeInjuries, awayInjuries
      );
      const injuryAdjusted = homeAdj < 1.0 || awayAdj < 1.0;
      if (injuryAdjusted) {
        pred = predictMatchFromLambdas(homeTeam, awayTeam, adjLH, adjLA, pred.lambda3);
      }

      // ─── Ensemble enrichment (DC + Elo + xG + Ted assessment) ─────────
      let dcProbs: { home: number; draw: number; away: number } | null = null;
      try {
        if (dcParams && dcParams.attack[homeTeam] && dcParams.attack[awayTeam]) {
          const dcGrid = dcPredictMatch(homeTeam, awayTeam, dcParams);
          dcProbs = dcDerive1X2(dcGrid);
        }
      } catch {}

      const homeElo = eloMap.get(homeTeam) ?? 1500;
      const awayElo = eloMap.get(awayTeam) ?? 1500;
      const eloProbs = eloWinProbability(homeElo, awayElo);

      // Consensus: average MI + DC + Elo
      const modelProbs: { home: number; draw: number; away: number }[] = [pred.probs1X2];
      if (dcProbs) modelProbs.push(dcProbs);
      modelProbs.push(eloProbs);
      const consensus = {
        home: modelProbs.reduce((s, m) => s + m.home, 0) / modelProbs.length,
        draw: modelProbs.reduce((s, m) => s + m.draw, 0) / modelProbs.length,
        away: modelProbs.reduce((s, m) => s + m.away, 0) / modelProbs.length,
      };
      const favorites = modelProbs.map(m => m.home > m.away ? "home" : "away");
      const agreement: "strong" | "moderate" | "split" =
        favorites.every(f => f === favorites[0]) ? "strong"
        : favorites.filter(f => f === favorites[0]).length >= 2 ? "moderate" : "split";

      // xG lookup (MI name → canonical → xG map)
      const homeCanonical = resolveCanonical(homeTeam, "mi");
      const awayCanonical = resolveCanonical(awayTeam, "mi");
      const homeXgData = xgMap.get(homeCanonical) ?? null;
      const awayXgData = xgMap.get(awayCanonical) ?? null;

      // Full Ted assessment (when xG available for both)
      let tedAssessmentData: Pick["tedAssessment"] = undefined;
      if (homeXgData && awayXgData) {
        try {
          const homeV = calculateTeamVariance(homeXgData, "home");
          const awayV = calculateTeamVariance(awayXgData, "away");
          const assessment = tedAssessMatch(homeV, awayV);
          tedAssessmentData = {
            betGrade: assessment.betGrade,
            confidence: assessment.confidence,
            edgeSide: assessment.edgeSide,
            varianceEdge: assessment.varianceEdge,
            positiveFactors: assessment.positiveFactors,
            passReasons: assessment.passReasons,
          };
        } catch {}
      }

      // Get market odds
      const bestOdds = getBestOdds(match);
      const pinnacleOdds = getPinnacleOdds(match);

      // Compute fair odds from model
      const fairOdds = {
        home: Math.round((1 / pred.probs1X2.home) * 100) / 100,
        draw: Math.round((1 / pred.probs1X2.draw) * 100) / 100,
        away: Math.round((1 / pred.probs1X2.away) * 100) / 100,
      };

      // Find value bets (model prob vs market implied prob)
      const valueBets: PickValueBet[] = [];
      if (bestOdds) {
        const devigged = devigOdds1X2(bestOdds.home, bestOdds.draw, bestOdds.away);
        if (devigged) {
          const sides = [
            { sel: "Home", mp: pred.probs1X2.home, cp: devigged.home, odds: bestOdds.home },
            { sel: "Away", mp: pred.probs1X2.away, cp: devigged.away, odds: bestOdds.away },
            { sel: "Draw", mp: pred.probs1X2.draw, cp: devigged.draw, odds: bestOdds.draw },
          ];
          for (const s of sides) {
            if (tedConfig.noDraws && s.sel === "Draw") continue;
            const edge = s.mp - s.cp;
            if (edge < tedConfig.minEdge) continue;
            if (s.odds > tedConfig.maxOdds) continue;
            valueBets.push({
              marketType: "1X2",
              selection: s.sel,
              modelProb: Math.round(s.mp * 1000) / 1000,
              marketProb: Math.round(s.cp * 1000) / 1000,
              edge: Math.round(edge * 1000) / 1000,
              fairOdds: Math.round((1 / s.mp) * 100) / 100,
              marketOdds: s.odds,
            });
          }
        }
      }

      // Check AH spreads
      const spreadOdds = getBestSpreadOdds(match);
      if (spreadOdds) {
        const lineKey = String(spreadOdds.line);
        const ahProbs = pred.asianHandicap[lineKey];
        if (ahProbs) {
          const devigged = devigOdds2Way(spreadOdds.home, spreadOdds.away);
          if (devigged) {
            for (const side of [
              { sel: `Home ${spreadOdds.line >= 0 ? "+" : ""}${spreadOdds.line}`, mp: ahProbs.home, cp: devigged.prob1, odds: spreadOdds.home },
              { sel: `Away ${-spreadOdds.line >= 0 ? "+" : ""}${-spreadOdds.line}`, mp: ahProbs.away, cp: devigged.prob2, odds: spreadOdds.away },
            ]) {
              const edge = side.mp - side.cp;
              if (edge < tedConfig.minEdge || side.odds > tedConfig.maxOdds) continue;
              valueBets.push({
                marketType: "AH",
                ahLine: spreadOdds.line,
                selection: side.sel,
                modelProb: Math.round(side.mp * 1000) / 1000,
                marketProb: Math.round(side.cp * 1000) / 1000,
                edge: Math.round(edge * 1000) / 1000,
                fairOdds: Math.round((1 / side.mp) * 100) / 100,
                marketOdds: side.odds,
              });
            }
          }
        }
      }

      // Apply Ted filters
      const matchDate = match.commenceTime.split("T")[0];
      const tedResult = applyTedFilters(
        homeTeam, awayTeam, matchDate,
        teamHistory, teamMatchDates,
        seasonMatchdayCount + 1, // upcoming is next matchday
        tedConfig,
      );

      // Determine verdict: BET if has value + passes Ted filters
      const hasValue = valueBets.length > 0;
      const tedVerdict = (hasValue && tedResult.pass) ? "BET" as const : "PASS" as const;
      const bestEdge = valueBets.length > 0 ? Math.max(...valueBets.map(v => v.edge)) : 0;

      // Assign grade
      let grade: "A" | "B" | "C" | null = null;
      if (tedVerdict === "BET") {
        const homeVar = getVarianceSummary(homeTeam, teamHistory, tedConfig);
        const awayVar = getVarianceSummary(awayTeam, teamHistory, tedConfig);
        const bothVariance = (homeVar?.isCandidate || false) && (awayVar?.isCandidate || false);

        if (bestEdge >= 0.10 && bothVariance) grade = "A";
        else if (bestEdge >= 0.07) grade = "B";
        else grade = "C";

        byGrade[grade] = (byGrade[grade] || 0) + 1;
        leagueBets++;
        leagueEdgeSum += bestEdge;
      }

      // Build reason string
      let reason: string | null = null;
      if (!hasValue && !tedResult.pass) {
        reason = `No value edge + ${tedReasonLabel(tedResult.reason)}`;
      } else if (!hasValue) {
        reason = "No value bets above threshold";
      } else if (!tedResult.pass) {
        reason = tedReasonLabel(tedResult.reason);
      }

      allPicks.push({
        matchId: match.matchId,
        league: league.id,
        leagueLabel: league.label,
        date: matchDate,
        kickoff: match.commenceTime,
        homeTeam,
        awayTeam,
        prediction: {
          homeProb: Math.round(pred.probs1X2.home * 1000) / 10,
          drawProb: Math.round(pred.probs1X2.draw * 1000) / 10,
          awayProb: Math.round(pred.probs1X2.away * 1000) / 10,
          expectedGoals: pred.expectedGoals,
          mostLikelyScore: pred.mostLikelyScore,
        },
        pinnacleOdds,
        fairOdds,
        valueBets,
        tedVerdict,
        tedReason: tedResult.reason || (hasValue ? null : "no_value"),
        tedReasonLabel: reason || "",
        grade,
        bestEdge: Math.round(bestEdge * 1000) / 10,
        homeVariance: getVarianceSummary(homeTeam, teamHistory, tedConfig),
        awayVariance: getVarianceSummary(awayTeam, teamHistory, tedConfig),
        injuries: (homeInjuries || awayInjuries) ? {
          home: homeInjuries ? { severity: homeInjuries.severity, summary: homeInjuries.summary, totalOut: homeInjuries.totalOut } : null,
          away: awayInjuries ? { severity: awayInjuries.severity, summary: awayInjuries.summary, totalOut: awayInjuries.totalOut } : null,
          adjusted: injuryAdjusted,
        } : undefined,
        ensemble: {
          dixonColes: dcProbs ? {
            home: Math.round(dcProbs.home * 1000) / 10,
            draw: Math.round(dcProbs.draw * 1000) / 10,
            away: Math.round(dcProbs.away * 1000) / 10,
          } : { home: 0, draw: 0, away: 0 },
          elo: {
            home: Math.round(eloProbs.home * 1000) / 10,
            draw: Math.round(eloProbs.draw * 1000) / 10,
            away: Math.round(eloProbs.away * 1000) / 10,
            homeRating: Math.round(homeElo),
            awayRating: Math.round(awayElo),
          },
          consensus: {
            home: Math.round(consensus.home * 1000) / 10,
            draw: Math.round(consensus.draw * 1000) / 10,
            away: Math.round(consensus.away * 1000) / 10,
          },
          agreement,
        },
        tedAssessment: tedAssessmentData,
        xg: (homeXgData || awayXgData) ? {
          home: homeXgData ? { xGFor: homeXgData.xGFor, xGAgainst: homeXgData.xGAgainst, overperformance: homeXgData.overperformance } : null,
          away: awayXgData ? { xGFor: awayXgData.xGFor, xGAgainst: awayXgData.xGAgainst, overperformance: awayXgData.overperformance } : null,
        } : undefined,
      });
    }

    byLeague[league.id] = {
      matches: leagueMatches,
      bets: leagueBets,
      avgEdge: leagueBets > 0 ? Math.round((leagueEdgeSum / leagueBets) * 1000) / 10 : 0,
    };
  }

  // Sort: BET first (by grade then edge), then PASS
  allPicks.sort((a, b) => {
    if (a.tedVerdict !== b.tedVerdict) return a.tedVerdict === "BET" ? -1 : 1;
    if (a.grade !== b.grade) {
      const gradeOrder = { A: 0, B: 1, C: 2 };
      return (gradeOrder[a.grade!] ?? 99) - (gradeOrder[b.grade!] ?? 99);
    }
    return b.bestEdge - a.bestEdge;
  });

  const betPicks = allPicks.filter(p => p.tedVerdict === "BET");

  return {
    picks: allPicks,
    summary: {
      generatedAt: new Date().toISOString(),
      leagues: leagues.map(l => l.id),
      totalMatches: allPicks.length,
      totalBets: betPicks.length,
      avgEdge: betPicks.length > 0
        ? Math.round(betPicks.reduce((s, p) => s + p.bestEdge, 0) / betPicks.length * 10) / 10
        : 0,
      byLeague,
      byGrade,
    },
  };
}
