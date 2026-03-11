/**
 * MI Model Performance API
 *
 * Runs backtest-eval logic in-memory from solver cache.
 * Returns comprehensive performance stats.
 */

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { predictMatch } from "@/lib/mi-model/predictor";
import { devigOdds1X2, devigOdds2Way } from "@/lib/mi-model/data-prep";
import type { MIModelParams } from "@/lib/mi-model/types";

const projectRoot = process.cwd();
const dataDir = join(projectRoot, "data/football-data-cache");
const cacheDir = join(projectRoot, "data", "backtest", "solver-cache");

const LEAGUES = [
  { id: "epl", label: "EPL" },
  { id: "la-liga", label: "La Liga" },
  { id: "bundesliga", label: "Bundesliga" },
  { id: "serie-a", label: "Serie A" },
];

const TEST_SEASON_START = "2022";
const SEASONS = ["2020-21", "2021-22", "2022-23", "2023-24", "2024-25"];

interface BetRecord {
  league: string; season: string; date: string;
  homeTeam: string; awayTeam: string;
  marketType: string; selection: string;
  modelProb: number; closingImpliedProb: number;
  clv: number; closingOdds: number;
  won: boolean; profit: number;
}

function loadSnapshots(leagueId: string): Map<string, MIModelParams> {
  const map = new Map<string, MIModelParams>();
  if (!existsSync(cacheDir)) return map;
  const prefix = `${leagueId}_`;
  const files = readdirSync(cacheDir).filter(f => f.startsWith(prefix) && f.endsWith(".json"));
  for (const f of files) {
    const parts = f.replace(".json", "").split("_");
    const date = parts[1];
    try {
      map.set(date, JSON.parse(readFileSync(join(cacheDir, f), "utf-8")));
    } catch { /* skip */ }
  }
  return map;
}

function summarize(bets: BetRecord[]) {
  if (bets.length === 0) return { n: 0, clv: 0, roi: 0, hitRate: 0, avgOdds: 0, profit: 0 };
  const wins = bets.filter(b => b.won).length;
  const totalProfit = bets.reduce((s, b) => s + b.profit, 0);
  return {
    n: bets.length,
    clv: bets.reduce((s, b) => s + b.clv, 0) / bets.length,
    roi: totalProfit / bets.length,
    hitRate: wins / bets.length,
    avgOdds: bets.reduce((s, b) => s + b.closingOdds, 0) / bets.length,
    profit: totalProfit,
  };
}

export async function GET(request: NextRequest) {
  const leagueFilter = request.nextUrl.searchParams.get("leagues")?.split(",") ?? null;
  const noDraws = request.nextUrl.searchParams.get("no-draws") !== "false"; // default true
  const maxOdds = parseFloat(request.nextUrl.searchParams.get("max-odds") || "2.5");
  const minEdge = parseFloat(request.nextUrl.searchParams.get("min-edge") || "0.07");
  const marketsArg = request.nextUrl.searchParams.get("markets") || "sides";

  try {
    const activeLeagues = leagueFilter
      ? LEAGUES.filter(l => leagueFilter.includes(l.id))
      : LEAGUES;

    const allBets: BetRecord[] = [];

    for (const league of activeLeagues) {
      const snapshots = loadSnapshots(league.id);
      if (snapshots.size === 0) continue;
      const snapDates = [...snapshots.keys()].sort();

      let rawMatches: any[] = [];
      for (const season of SEASONS) {
        const fp = join(dataDir, `${league.id}-${season}.json`);
        if (!existsSync(fp)) continue;
        try {
          const raw = JSON.parse(readFileSync(fp, "utf-8"));
          rawMatches.push(...(raw.matches || []));
        } catch { continue; }
      }
      rawMatches.sort((a: any, b: any) => a.date.localeCompare(b.date));

      const testMatches = rawMatches.filter((m: any) => m.date >= `${TEST_SEASON_START}-07-01`);
      const matchdayDates = [...new Set(testMatches.map((m: any) => m.date))].sort();
      let currentParams: MIModelParams | null = null;

      for (const matchday of matchdayDates) {
        let bestSnap: string | null = null;
        for (const sd of snapDates) {
          if (sd <= matchday) bestSnap = sd;
          else break;
        }
        if (bestSnap) currentParams = snapshots.get(bestSnap)!;
        if (!currentParams) continue;

        const dayMatches = rawMatches.filter((m: any) => m.date === matchday);

        for (const m of dayMatches) {
          if (m.homeGoals == null || m.awayGoals == null) continue;
          if (!currentParams.teams[m.homeTeam] || !currentParams.teams[m.awayTeam]) continue;

          let pred;
          try { pred = predictMatch(currentParams, m.homeTeam, m.awayTeam); }
          catch { continue; }

          const totalGoals = m.homeGoals + m.awayGoals;
          const season = m.season || "unknown";

          // 1X2
          if (m.pinnacleCloseHome && m.pinnacleCloseDraw && m.pinnacleCloseAway) {
            const closingMkt = devigOdds1X2(m.pinnacleCloseHome, m.pinnacleCloseDraw, m.pinnacleCloseAway);
            if (closingMkt && (marketsArg === "sides" || marketsArg === "1x2" || marketsArg === "all")) {
              const sides = [
                { sel: "Home", mp: pred.probs1X2.home, cp: closingMkt.home, odds: m.pinnacleCloseHome, won: m.homeGoals > m.awayGoals },
                { sel: "Away", mp: pred.probs1X2.away, cp: closingMkt.away, odds: m.pinnacleCloseAway, won: m.awayGoals > m.homeGoals },
                { sel: "Draw", mp: pred.probs1X2.draw, cp: closingMkt.draw, odds: m.pinnacleCloseDraw, won: m.homeGoals === m.awayGoals },
              ];
              for (const s of sides) {
                if (noDraws && s.sel === "Draw") continue;
                const clv = s.mp - s.cp;
                if (clv <= minEdge) continue;
                if (s.odds > maxOdds) continue;
                allBets.push({
                  league: league.id, season, date: m.date,
                  homeTeam: m.homeTeam, awayTeam: m.awayTeam,
                  marketType: "1X2", selection: s.sel,
                  modelProb: s.mp, closingImpliedProb: s.cp,
                  clv, closingOdds: s.odds,
                  won: s.won, profit: s.won ? s.odds - 1 : -1,
                });
              }
            }
          }

          // AH
          const ahLine = m.ahCloseLine ?? m.ahLine;
          const ahHome = m.pinnacleCloseAHHome ?? m.pinnacleAHHome;
          const ahAway = m.pinnacleCloseAHAway ?? m.pinnacleAHAway;
          if (ahLine != null && ahHome && ahAway && (marketsArg === "sides" || marketsArg === "ah" || marketsArg === "all")) {
            const modelAH = pred.asianHandicap[String(ahLine)];
            const closingAH = devigOdds2Way(ahHome, ahAway);
            if (modelAH && closingAH) {
              const goalDiff = m.homeGoals - m.awayGoals;
              const ahSides = [
                { sel: `Home AH ${ahLine >= 0 ? "+" : ""}${ahLine}`, mp: modelAH.home, cp: closingAH.prob1, odds: ahHome, result: goalDiff + ahLine },
                { sel: `Away AH ${-ahLine >= 0 ? "+" : ""}${-ahLine}`, mp: modelAH.away, cp: closingAH.prob2, odds: ahAway, result: -(goalDiff + ahLine) },
              ];
              for (const s of ahSides) {
                const clv = s.mp - s.cp;
                if (clv <= minEdge) continue;
                if (s.odds > maxOdds) continue;
                const won = s.result > 0;
                const push = s.result === 0;
                allBets.push({
                  league: league.id, season, date: m.date,
                  homeTeam: m.homeTeam, awayTeam: m.awayTeam,
                  marketType: "AH", selection: s.sel,
                  modelProb: s.mp, closingImpliedProb: s.cp,
                  clv, closingOdds: s.odds,
                  won, profit: push ? 0 : won ? s.odds - 1 : -1,
                });
              }
            }
          }
        }
      }
    }

    // Compute stats
    const overall = summarize(allBets);

    const thresholds = [0.00, 0.03, 0.05, 0.07, 0.10, 0.15];
    const edgeTable = thresholds.map(t => {
      const f = allBets.filter(b => b.clv >= t);
      return { threshold: t, ...summarize(f) };
    }).filter(r => r.n > 0);

    const leagueIds = activeLeagues.map(l => l.id);
    const stability: Record<string, Record<string, any>> = {};
    for (const row of ["sides", "ah"]) {
      stability[row] = {};
      for (const lid of [...leagueIds, "overall"]) {
        const subset = (lid === "overall" ? allBets : allBets.filter(b => b.league === lid))
          .filter(b => row === "ah" ? b.marketType === "AH" : true);
        stability[row][lid] = summarize(subset);
      }
    }

    const seasons = [...new Set(allBets.map(b => b.season))].sort();
    const bySeason = seasons.map(season => {
      const sb = allBets.filter(b => b.season === season);
      return { season, ...summarize(sb) };
    }).filter(r => r.n >= 10);

    const oddsBuckets = [
      { label: "1.00-1.50", min: 1.0, max: 1.5 },
      { label: "1.50-2.00", min: 1.5, max: 2.0 },
      { label: "2.00-2.50", min: 2.0, max: 2.5 },
      { label: "2.50-3.00", min: 2.5, max: 3.0 },
      { label: "3.00+", min: 3.0, max: 99 },
    ];
    const byOdds = oddsBuckets.map(b => {
      const f = allBets.filter(x => x.closingOdds >= b.min && x.closingOdds < b.max);
      return { label: b.label, ...summarize(f) };
    }).filter(r => r.n > 0);

    const byLeague = Object.fromEntries(
      leagueIds.map(lid => [lid, summarize(allBets.filter(b => b.league === lid))])
    );

    return NextResponse.json({
      filters: { leagues: leagueIds, maxOdds, minEdge, markets: marketsArg, noDraws },
      overall,
      edgeTable,
      stability,
      bySeason,
      byOdds,
      byLeague,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
