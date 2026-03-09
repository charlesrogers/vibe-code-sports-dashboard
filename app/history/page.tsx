"use client";

import { useState, useEffect } from "react";
import SeasonSelector from "../components/season-selector";
import type { MatchWithOdds } from "@/lib/football-data-uk";

interface SeasonStats {
  totalMatches: number;
  totalGoals: number;
  goalsPerGame: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  homeWinPct: number;
  drawPct: number;
  awayWinPct: number;
  over25Pct: number;
  bttsPct: number;
  avgHomeGoals: number;
  avgAwayGoals: number;
  cleanSheetsPct: number;
  topScorer: { team: string; goals: number };
  bestDefense: { team: string; conceded: number };
  biggestWin: { match: string; score: string };
}

interface TeamSeason {
  team: string;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
  shotsFor: number;
  shotsAgainst: number;
  shotAccuracy: number;
  cornersFor: number;
  foulsCommitted: number;
  yellowCards: number;
  redCards: number;
}

function calculateStats(matches: MatchWithOdds[]): SeasonStats {
  const n = matches.length;
  if (n === 0) return {} as SeasonStats;

  const totalGoals = matches.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0);
  const homeWins = matches.filter((m) => m.result === "H").length;
  const draws = matches.filter((m) => m.result === "D").length;
  const awayWins = matches.filter((m) => m.result === "A").length;
  const over25 = matches.filter((m) => m.homeGoals + m.awayGoals > 2.5).length;
  const btts = matches.filter((m) => m.homeGoals > 0 && m.awayGoals > 0).length;
  const cleanSheets = matches.filter((m) => m.homeGoals === 0 || m.awayGoals === 0).length;

  // Team goal tallies
  const teamGoals: Record<string, number> = {};
  const teamConceded: Record<string, number> = {};
  matches.forEach((m) => {
    teamGoals[m.homeTeam] = (teamGoals[m.homeTeam] || 0) + m.homeGoals;
    teamGoals[m.awayTeam] = (teamGoals[m.awayTeam] || 0) + m.awayGoals;
    teamConceded[m.homeTeam] = (teamConceded[m.homeTeam] || 0) + m.awayGoals;
    teamConceded[m.awayTeam] = (teamConceded[m.awayTeam] || 0) + m.homeGoals;
  });

  const topScorer = Object.entries(teamGoals).sort((a, b) => b[1] - a[1])[0];
  const bestDef = Object.entries(teamConceded).sort((a, b) => a[1] - b[1])[0];

  // Biggest win
  const sorted = [...matches].sort((a, b) =>
    Math.abs(b.homeGoals - b.awayGoals) - Math.abs(a.homeGoals - a.awayGoals)
  );
  const big = sorted[0];

  return {
    totalMatches: n,
    totalGoals,
    goalsPerGame: Math.round((totalGoals / n) * 100) / 100,
    homeWins, draws, awayWins,
    homeWinPct: Math.round((homeWins / n) * 1000) / 10,
    drawPct: Math.round((draws / n) * 1000) / 10,
    awayWinPct: Math.round((awayWins / n) * 1000) / 10,
    over25Pct: Math.round((over25 / n) * 1000) / 10,
    bttsPct: Math.round((btts / n) * 1000) / 10,
    avgHomeGoals: Math.round((matches.reduce((s, m) => s + m.homeGoals, 0) / n) * 100) / 100,
    avgAwayGoals: Math.round((matches.reduce((s, m) => s + m.awayGoals, 0) / n) * 100) / 100,
    cleanSheetsPct: Math.round((cleanSheets / n) * 1000) / 10,
    topScorer: topScorer ? { team: topScorer[0], goals: topScorer[1] } : { team: "-", goals: 0 },
    bestDefense: bestDef ? { team: bestDef[0], conceded: bestDef[1] } : { team: "-", conceded: 0 },
    biggestWin: big ? { match: `${big.homeTeam} v ${big.awayTeam}`, score: `${big.homeGoals}-${big.awayGoals}` } : { match: "-", score: "-" },
  };
}

function calculateTeamTable(matches: MatchWithOdds[]): TeamSeason[] {
  const teams: Record<string, TeamSeason> = {};

  for (const m of matches) {
    for (const side of ["home", "away"] as const) {
      const team = side === "home" ? m.homeTeam : m.awayTeam;
      if (!teams[team]) {
        teams[team] = {
          team, played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0,
          shotsFor: 0, shotsAgainst: 0, shotAccuracy: 0, cornersFor: 0, foulsCommitted: 0,
          yellowCards: 0, redCards: 0,
        };
      }
      const t = teams[team];
      t.played++;
      const scored = side === "home" ? m.homeGoals : m.awayGoals;
      const conceded = side === "home" ? m.awayGoals : m.homeGoals;
      t.gf += scored;
      t.ga += conceded;
      t.gd = t.gf - t.ga;

      if (scored > conceded) { t.won++; t.points += 3; }
      else if (scored === conceded) { t.drawn++; t.points += 1; }
      else { t.lost++; }

      t.shotsFor += side === "home" ? m.homeShots : m.awayShots;
      t.shotsAgainst += side === "home" ? m.awayShots : m.homeShots;
      const sot = side === "home" ? m.homeShotsOnTarget : m.awayShotsOnTarget;
      const shots = side === "home" ? m.homeShots : m.awayShots;
      t.cornersFor += side === "home" ? m.homeCorners : m.awayCorners;
      t.foulsCommitted += side === "home" ? m.homeFouls : m.awayFouls;
      t.yellowCards += side === "home" ? m.homeYellow : m.awayYellow;
      t.redCards += side === "home" ? m.homeRed : m.awayRed;
    }
  }

  return Object.values(teams)
    .map((t) => ({
      ...t,
      shotAccuracy: t.shotsFor > 0
        ? Math.round((matches.reduce((s, m) =>
            s + (m.homeTeam === t.team ? m.homeShotsOnTarget : m.awayTeam === t.team ? m.awayShotsOnTarget : 0), 0
          ) / t.shotsFor) * 1000) / 10
        : 0,
    }))
    .sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);
}

export default function HistoryPage() {
  const [season, setSeason] = useState("2025-26");
  const [matches, setMatches] = useState<MatchWithOdds[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"overview" | "table" | "matches">("overview");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/odds?season=${season}`);
        const data = await res.json();
        setMatches(data.matches || []);
      } catch {
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [season]);

  if (loading) return <div className="py-20 text-center text-zinc-500">Loading {season} data...</div>;

  const stats = calculateStats(matches);
  const table = calculateTeamTable(matches);

  return (
    <div>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SeasonSelector value={season} onChange={setSeason} />
        <div className="flex gap-1">
          {(["overview", "table", "matches"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 text-xs font-medium ${
                tab === t ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {t === "overview" ? "Season Overview" : t === "table" ? "Full Table" : "Match Log"}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-zinc-500">{matches.length} matches loaded</span>
      </div>

      {/* OVERVIEW TAB */}
      {tab === "overview" && stats.totalMatches > 0 && (
        <div>
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-2xl font-bold text-blue-400">{stats.totalMatches}</div>
              <div className="text-xs text-zinc-500">Matches</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-2xl font-bold text-green-400">{stats.totalGoals}</div>
              <div className="text-xs text-zinc-500">Goals</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-2xl font-bold text-purple-400">{stats.goalsPerGame}</div>
              <div className="text-xs text-zinc-500">Goals/Game</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-2xl font-bold text-yellow-400">{stats.over25Pct}%</div>
              <div className="text-xs text-zinc-500">Over 2.5 %</div>
            </div>
          </div>

          {/* 1X2 Distribution */}
          <div className="mb-6 rounded-xl bg-zinc-900 p-4">
            <h3 className="mb-2 text-sm font-medium text-zinc-400">Result Distribution</h3>
            <div className="flex h-8 overflow-hidden rounded-full text-xs font-bold">
              <div className="flex items-center justify-center bg-green-600" style={{ width: `${stats.homeWinPct}%` }}>
                H {stats.homeWinPct}%
              </div>
              <div className="flex items-center justify-center bg-yellow-600" style={{ width: `${stats.drawPct}%` }}>
                D {stats.drawPct}%
              </div>
              <div className="flex items-center justify-center bg-blue-600" style={{ width: `${stats.awayWinPct}%` }}>
                A {stats.awayWinPct}%
              </div>
            </div>
          </div>

          {/* Key stats grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-xl bg-zinc-900 p-4">
              <div className="text-lg font-bold">{stats.avgHomeGoals}</div>
              <div className="text-xs text-zinc-500">Avg Home Goals</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4">
              <div className="text-lg font-bold">{stats.avgAwayGoals}</div>
              <div className="text-xs text-zinc-500">Avg Away Goals</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4">
              <div className="text-lg font-bold">{stats.bttsPct}%</div>
              <div className="text-xs text-zinc-500">BTTS %</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4">
              <div className="text-lg font-bold">{stats.cleanSheetsPct}%</div>
              <div className="text-xs text-zinc-500">Clean Sheet %</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4">
              <div className="text-lg font-bold text-green-400">{stats.topScorer.team}</div>
              <div className="text-xs text-zinc-500">Top Scorer ({stats.topScorer.goals} goals)</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4">
              <div className="text-lg font-bold text-blue-400">{stats.bestDefense.team}</div>
              <div className="text-xs text-zinc-500">Best Defense ({stats.bestDefense.conceded} GA)</div>
            </div>
          </div>

          <div className="mt-3 rounded-xl bg-zinc-900 p-4">
            <div className="text-sm">
              <span className="text-zinc-500">Biggest Win: </span>
              <span className="font-bold">{stats.biggestWin.match}</span>
              <span className="ml-2 font-mono text-yellow-400">{stats.biggestWin.score}</span>
            </div>
          </div>
        </div>
      )}

      {/* TABLE TAB */}
      {tab === "table" && (
        <div className="rounded-xl bg-zinc-900 overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-400">
                <th className="px-2 py-2 text-left">#</th>
                <th className="px-2 py-2 text-left">Team</th>
                <th className="px-2 py-2 text-center">P</th>
                <th className="px-2 py-2 text-center">W</th>
                <th className="px-2 py-2 text-center">D</th>
                <th className="px-2 py-2 text-center">L</th>
                <th className="px-2 py-2 text-center">GF</th>
                <th className="px-2 py-2 text-center">GA</th>
                <th className="px-2 py-2 text-center">GD</th>
                <th className="px-2 py-2 text-center font-bold text-white">Pts</th>
                <th className="hidden px-2 py-2 text-center sm:table-cell">Shots</th>
                <th className="hidden px-2 py-2 text-center sm:table-cell">Corners</th>
                <th className="hidden px-2 py-2 text-center sm:table-cell">YC</th>
                <th className="hidden px-2 py-2 text-center sm:table-cell">RC</th>
              </tr>
            </thead>
            <tbody>
              {table.map((t, i) => (
                <tr
                  key={t.team}
                  className={`border-b border-zinc-800/50 ${
                    i < 4 ? "bg-blue-500/5" : i >= table.length - 3 ? "bg-red-500/5" : ""
                  }`}
                >
                  <td className="px-2 py-2 text-zinc-500">{i + 1}</td>
                  <td className="px-2 py-2 font-medium">{t.team}</td>
                  <td className="px-2 py-2 text-center text-zinc-400">{t.played}</td>
                  <td className="px-2 py-2 text-center text-green-400">{t.won}</td>
                  <td className="px-2 py-2 text-center text-zinc-400">{t.drawn}</td>
                  <td className="px-2 py-2 text-center text-red-400">{t.lost}</td>
                  <td className="px-2 py-2 text-center">{t.gf}</td>
                  <td className="px-2 py-2 text-center">{t.ga}</td>
                  <td className={`px-2 py-2 text-center ${t.gd > 0 ? "text-green-400" : t.gd < 0 ? "text-red-400" : ""}`}>
                    {t.gd > 0 ? "+" : ""}{t.gd}
                  </td>
                  <td className="px-2 py-2 text-center font-bold text-lg">{t.points}</td>
                  <td className="hidden px-2 py-2 text-center text-zinc-400 sm:table-cell">{t.shotsFor}</td>
                  <td className="hidden px-2 py-2 text-center text-zinc-400 sm:table-cell">{t.cornersFor}</td>
                  <td className="hidden px-2 py-2 text-center text-yellow-400 sm:table-cell">{t.yellowCards}</td>
                  <td className="hidden px-2 py-2 text-center text-red-400 sm:table-cell">{t.redCards}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MATCH LOG TAB */}
      {tab === "matches" && (
        <div className="space-y-1">
          {[...matches].reverse().slice(0, 50).map((m, i) => (
            <div key={i} className="flex items-center rounded-lg bg-zinc-900 px-3 py-2 text-sm">
              <span className="w-20 text-xs text-zinc-500">{m.date}</span>
              <span className={`flex-1 text-right ${m.result === "H" ? "font-bold" : "text-zinc-400"}`}>
                {m.homeTeam}
              </span>
              <span className="mx-3 rounded bg-zinc-800 px-3 py-0.5 font-mono font-bold">
                {m.homeGoals} - {m.awayGoals}
              </span>
              <span className={`flex-1 ${m.result === "A" ? "font-bold" : "text-zinc-400"}`}>
                {m.awayTeam}
              </span>
              {m.avgHome > 0 && (
                <span className="ml-2 hidden text-[10px] text-zinc-600 sm:block">
                  {m.avgHome.toFixed(2)} / {m.avgDraw.toFixed(2)} / {m.avgAway.toFixed(2)}
                </span>
              )}
            </div>
          ))}
          {matches.length > 50 && (
            <p className="py-2 text-center text-xs text-zinc-600">Showing last 50 of {matches.length} matches</p>
          )}
        </div>
      )}
    </div>
  );
}
