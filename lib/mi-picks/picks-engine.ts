/**
 * MI Picks Engine — Core orchestration for today's picks
 *
 * Loads pre-computed solver params, gets upcoming fixtures from live-odds,
 * runs MI model predictions, applies Ted filters, and assigns grades.
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { predictMatch, predictMatchFromLambdas } from "../mi-model/predictor";
import { fetchInjuriesForTeams, enrichWithMinutes } from "../injuries";
import { fetchGKStats, fetchPlayerMinutes, getStartingGK, buildMinutesLookup, type GKStats, type PlayerMinutes } from "../gk-psxg";
import { fetchManagersForTeams, type ManagerInfo } from "../manager-changes";
import { adjustLambdas } from "./injury-adjust";
import { adjustLambdasForGK, type GKAdjustment } from "./gk-adjust";
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
  checkPassRate,
} from "./ted-filters";
import { isPostInternationalBreak } from "./international-breaks";
import { isDerby as checkDerby } from "./derbies";
import { loadLiveOdds as loadLiveOddsFromStore } from "../odds-collector/store";

const projectRoot = join(process.cwd());
const paramsDir = join(projectRoot, "data", "mi-params", "latest");
const dataDir = join(projectRoot, "data", "football-data-cache");

// ─── Types ──────────────────────────────────────────────────────────────────

export interface BookOddsEntry {
  book: string;
  bookKey: string;
  odds: number;
}

export interface PickValueBet {
  marketType: "1X2" | "AH";
  selection: string;
  ahLine?: number;
  modelProb: number;
  marketProb: number;
  edge: number;
  fairOdds: number;
  marketOdds: number;         // Pinnacle/sharp book odds (used for edge calc)
  bestBooks: BookOddsEntry[]; // Top books sorted by odds (best first), max 5
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
  gkContext?: {
    home: { player: string; goalsPrevented: number; goalsPreventedPer90: number; matchesPlayed: number } | null;
    away: { player: string; goalsPrevented: number; goalsPreventedPer90: number; matchesPlayed: number } | null;
  };
  gkAdjustment?: GKAdjustment;
  strengthOfSchedule?: {
    home: { avgOpponentElo: number; last5Opponents: string[] } | null;
    away: { avgOpponentElo: number; last5Opponents: string[] } | null;
    leagueAvgElo: number;
  };
  managerContext?: {
    home: ManagerInfo | null;
    away: ManagerInfo | null;
    recentChanges: boolean; // true if either team has a new/mid-season manager
  };
  activeSignals?: string[];
  isPostBreak?: boolean;
  isDerby?: boolean;
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

async function loadLiveOdds(oddsApiKey: string): Promise<LiveOddsMatch[]> {
  // Use the storage adapter (Blob on Vercel, file locally)
  const snapshots = await loadLiveOddsFromStore(oddsApiKey);
  if (snapshots.length > 0) return snapshots as unknown as LiveOddsMatch[];

  // Fallback: read from local filesystem (legacy format)
  const liveOddsDir = join(process.cwd(), "data", "live-odds");
  if (!existsSync(liveOddsDir)) return [];
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

/** Get top N bookmakers offering best odds for a 1X2 selection */
function getBestBooksFor1X2(match: LiveOddsMatch, selection: "Home" | "Draw" | "Away", maxBooks: number = 5): BookOddsEntry[] {
  const field = selection === "Home" ? "homeOdds" : selection === "Away" ? "awayOdds" : "drawOdds";
  return match.bookmakers
    .filter(b => (b as any)[field] > 1)
    .map(b => ({ book: b.bookmaker, bookKey: b.bookmakerKey, odds: (b as any)[field] as number }))
    .sort((a, b) => b.odds - a.odds)
    .slice(0, maxBooks);
}

/** Get top N bookmakers offering best odds for AH spread selection */
function getBestBooksForSpread(match: LiveOddsMatch, side: "home" | "away", maxBooks: number = 5): BookOddsEntry[] {
  const field = side === "home" ? "spreadHome" : "spreadAway";
  return match.bookmakers
    .filter(b => (b as any)[field] > 1 && b.spreadLine != null)
    .map(b => ({ book: b.bookmaker, bookKey: b.bookmakerKey, odds: (b as any)[field] as number }))
    .sort((a, b) => b.odds - a.odds)
    .slice(0, maxBooks);
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
  // Serie B
  "SSC Bari": "Bari",
  "Palermo FC": "Palermo",
  "Spezia Calcio": "Spezia",
  "US Cremonese": "Cremonese",
  "AC Pisa 1909": "Pisa",
  "US Salernitana 1919": "Salernitana",
  "US Sassuolo Calcio": "Sassuolo",
  "Frosinone Calcio": "Frosinone",
  "Brescia Calcio": "Brescia",
  // Ligue 1
  "Paris Saint Germain": "Paris SG",
  "Paris Saint-Germain": "Paris SG",
  "Olympique Lyonnais": "Lyon",
  "Olympique de Marseille": "Marseille",
  "AS Monaco": "Monaco",
  "AS Saint-Étienne": "Saint-Etienne",
  "AS Saint-Etienne": "Saint-Etienne",
  "RC Strasbourg Alsace": "Strasbourg",
  "RC Strasbourg": "Strasbourg",
  "Stade Rennais FC": "Rennes",
  "Stade Rennais": "Rennes",
  "FC Nantes": "Nantes",
  "OGC Nice": "Nice",
  "RC Lens": "Lens",
  "Toulouse FC": "Toulouse",
  "Montpellier HSC": "Montpellier",
  "Stade de Reims": "Reims",
  "Stade Brestois 29": "Brest",
  "Angers SCO": "Angers",
  "LOSC Lille": "Lille",
  "LOSC": "Lille",
  "Le Havre AC": "Le Havre",
  "AJ Auxerre": "Auxerre",
};

function normalizeTeamName(name: string): string {
  return TEAM_NAME_MAP[name] || name;
}

// ─── Strength of Schedule ────────────────────────────────────────────────────

interface SoSData {
  avgOpponentElo: number;
  last5Opponents: string[];
}

function computeTeamSoS(
  team: string,
  playedMatches: any[],
  eloMap: Map<string, number>,
  lastN: number = 5,
): SoSData | null {
  // Find this team's recent matches (most recent N)
  const teamMatches = playedMatches
    .filter(m => m.homeTeam === team || m.awayTeam === team)
    .slice(-lastN);

  if (teamMatches.length === 0) return null;

  const opponents: string[] = [];
  let eloSum = 0;
  let eloCount = 0;

  for (const m of teamMatches) {
    const opp = m.homeTeam === team ? m.awayTeam : m.homeTeam;
    opponents.push(opp);
    const oppElo = eloMap.get(opp);
    if (oppElo) {
      eloSum += oppElo;
      eloCount++;
    }
  }

  if (eloCount === 0) return null;

  return {
    avgOpponentElo: Math.round(eloSum / eloCount),
    last5Opponents: opponents,
  };
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
    const liveOdds = await loadLiveOdds(league.oddsApiKey);
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

    // Fetch GK stats + player minutes from Fotmob
    let gkStats: GKStats[] = [];
    let playerMins: PlayerMinutes[] = [];
    let minutesLookup = new Map<string, Map<string, { minutes: number; matchesPlayed: number }>>();
    try {
      [gkStats, playerMins] = await Promise.all([
        fetchGKStats(league.id),
        fetchPlayerMinutes(league.id),
      ]);
      minutesLookup = buildMinutesLookup(playerMins);

      // Enrich injury reports with minutes data (marks bench players)
      const totalMatchdays = seasonMatchdayCount;
      for (const report of injuryMap.values()) {
        const teamKey = report.team.toLowerCase()
          .replace(/\s+(fc|afc|cf|sc|ssc)$/i, "")
          .replace(/^(fc|afc|cf|sc|ssc)\s+/i, "")
          .replace(/\band\b/g, "&")
          .trim();
        const teamMins = minutesLookup.get(teamKey) ?? null;
        enrichWithMinutes(report.unavailable, teamMins, totalMatchdays);
      }
    } catch (e) {
      console.log(`[picks] GK/minutes fetch failed for ${league.id}: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Fetch manager data from Fotmob
    let managerMap = new Map<string, ManagerInfo | null>();
    try {
      managerMap = await fetchManagersForTeams(allTeamNames, league.id);
    } catch (e) {
      console.log(`[picks] Manager fetch failed for ${league.id}: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Compute league average Elo for SoS context
    const allEloValues = [...eloMap.values()];
    const leagueAvgElo = allEloValues.length > 0
      ? Math.round(allEloValues.reduce((s, v) => s + v, 0) / allEloValues.length)
      : 1500;

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

      // Apply GK PSxG+/- adjustment (after injuries)
      const homeGK = getStartingGK(homeTeam, gkStats, playerMins);
      const awayGK = getStartingGK(awayTeam, gkStats, playerMins);
      const { lambdaHome: gkLH, lambdaAway: gkLA, adjustment: gkAdj } = adjustLambdasForGK(
        pred.lambdaHome, pred.lambdaAway, homeGK, awayGK
      );
      const gkAdjusted = gkAdj.homeGKAdj !== 1.0 || gkAdj.awayGKAdj !== 1.0;
      if (gkAdjusted) {
        pred = predictMatchFromLambdas(homeTeam, awayTeam, gkLH, gkLA, pred.lambda3);
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
      const homeMgr = managerMap.get(homeTeam) ?? null;
      const awayMgr = managerMap.get(awayTeam) ?? null;
      if (homeXgData && awayXgData) {
        try {
          const homeV = calculateTeamVariance(homeXgData, {
            venue: "home",
            managerChange: homeMgr ? { isNewThisSeason: homeMgr.isNewThisSeason, isMidSeasonChange: homeMgr.isMidSeasonChange } : undefined,
          });
          const awayV = calculateTeamVariance(awayXgData, {
            venue: "away",
            managerChange: awayMgr ? { isNewThisSeason: awayMgr.isNewThisSeason, isMidSeasonChange: awayMgr.isMidSeasonChange } : undefined,
          });
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
              bestBooks: getBestBooksFor1X2(match, s.sel as "Home" | "Draw" | "Away"),
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
              const ahSide = side.sel.startsWith("Home") ? "home" as const : "away" as const;
              valueBets.push({
                marketType: "AH",
                ahLine: spreadOdds.line,
                selection: side.sel,
                modelProb: Math.round(side.mp * 1000) / 1000,
                marketProb: Math.round(side.cp * 1000) / 1000,
                edge: Math.round(edge * 1000) / 1000,
                fairOdds: Math.round((1 / side.mp) * 100) / 100,
                marketOdds: side.odds,
                bestBooks: getBestBooksForSpread(match, ahSide),
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

      // Filter out value bets that fail pass rate threshold
      const passRateFiltered = valueBets.filter(vb => {
        const pr = checkPassRate(league.id, vb.marketType, vb.selection);
        return pr.pass; // allow if no data or hit rate >= threshold
      });

      // Determine verdict: BET if has value + passes Ted filters + passes pass rate
      const hasValue = passRateFiltered.length > 0;
      const tedVerdict = (hasValue && tedResult.pass) ? "BET" as const : "PASS" as const;
      const bestEdge = passRateFiltered.length > 0
        ? Math.max(...passRateFiltered.map(v => v.edge))
        : (valueBets.length > 0 ? Math.max(...valueBets.map(v => v.edge)) : 0);

      // Assign grade (homeVar/awayVar computed below for signal attribution)
      let grade: "A" | "B" | "C" | null = null;
      const homeVarGrade = getVarianceSummary(homeTeam, teamHistory, tedConfig);
      const awayVarGrade = getVarianceSummary(awayTeam, teamHistory, tedConfig);
      if (tedVerdict === "BET") {
        const bothVariance = (homeVarGrade?.isCandidate || false) && (awayVarGrade?.isCandidate || false);

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

      // Collect active signal IDs for attribution
      const activeSignals: string[] = [];
      // Core variance regression signal
      if (homeVarGrade?.isCandidate || awayVarGrade?.isCandidate) {
        activeSignals.push("variance-regression");
      }
      // Congestion filter (passed = not congested)
      if (tedResult.pass) {
        activeSignals.push("congestion-filter");
      }
      // Odds cap filter (all value bets within max odds)
      if (passRateFiltered.length > 0 && passRateFiltered.every(vb => vb.marketOdds <= tedConfig.maxOdds)) {
        activeSignals.push("odds-cap-2.0");
      }
      // Pass rate filter
      if (passRateFiltered.length > 0) {
        activeSignals.push("pass-rate-filter");
      }
      // Injury lambda adjustment
      if (injuryAdjusted) {
        activeSignals.push("injury-lambda");
      }
      // GK PSxG adjustment
      if (gkAdjusted) {
        activeSignals.push("gk-psxg-adj");
      }
      // Ted assessment positive/negative factors
      if (tedAssessmentData) {
        for (const f of tedAssessmentData.positiveFactors) {
          if (f.includes("underlying quality")) activeSignals.push("P1");
          else if (f.includes("defensive underperformance")) activeSignals.push("P2");
          else if (f.includes("due to regress")) activeSignals.push("P3");
          else if (f.includes("fragile attack")) activeSignals.push("P4");
          else if (f.includes("dam will break")) activeSignals.push("P5");
          else if (f.includes("extreme variance gap")) activeSignals.push("P6");
          else if (f.includes("average quality")) activeSignals.push("P7");
          else if (f.includes("injury crisis")) activeSignals.push("P8");
          else if (f.includes("double variance")) activeSignals.push("P9");
        }
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
        homeVariance: homeVarGrade,
        awayVariance: awayVarGrade,
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
        gkContext: gkStats.length > 0 ? (() => {
          return (homeGK || awayGK) ? {
            home: homeGK ? { player: homeGK.player, goalsPrevented: homeGK.goalsPrevented, goalsPreventedPer90: homeGK.goalsPreventedPer90, matchesPlayed: homeGK.matchesPlayed } : null,
            away: awayGK ? { player: awayGK.player, goalsPrevented: awayGK.goalsPrevented, goalsPreventedPer90: awayGK.goalsPreventedPer90, matchesPlayed: awayGK.matchesPlayed } : null,
          } : undefined;
        })() : undefined,
        gkAdjustment: gkAdjusted ? gkAdj : undefined,
        strengthOfSchedule: (() => {
          const homeSoS = computeTeamSoS(homeTeam, playedMatches, eloMap);
          const awaySoS = computeTeamSoS(awayTeam, playedMatches, eloMap);
          return (homeSoS || awaySoS) ? { home: homeSoS, away: awaySoS, leagueAvgElo } : undefined;
        })(),
        managerContext: (homeMgr || awayMgr) ? {
          home: homeMgr,
          away: awayMgr,
          recentChanges: (homeMgr?.isNewThisSeason || homeMgr?.isMidSeasonChange || awayMgr?.isNewThisSeason || awayMgr?.isMidSeasonChange) ?? false,
        } : undefined,
        activeSignals: activeSignals.length > 0 ? activeSignals : undefined,
        isPostBreak: isPostInternationalBreak(matchDate) || undefined,
        isDerby: checkDerby(homeTeam, awayTeam, league.id) || undefined,
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
