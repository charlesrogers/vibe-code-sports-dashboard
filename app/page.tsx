"use client";

import { useState } from "react";
import { games, type Game } from "./data/games";

type TeamStats = {
  name: string;
  wins: number;
  losses: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  form: ("W" | "L" | "D")[];
};

function getTeamStats(teamName: string, allGames: Game[]): TeamStats {
  const teamGames = allGames.filter(
    (g) => g.homeTeam === teamName || g.awayTeam === teamName
  );

  let wins = 0, losses = 0, draws = 0, goalsFor = 0, goalsAgainst = 0;
  const results: ("W" | "L" | "D")[] = [];

  teamGames.forEach((g) => {
    const isHome = g.homeTeam === teamName;
    const scored = isHome ? g.homeScore : g.awayScore;
    const conceded = isHome ? g.awayScore : g.homeScore;
    goalsFor += scored;
    goalsAgainst += conceded;

    if (scored > conceded) { wins++; results.push("W"); }
    else if (scored < conceded) { losses++; results.push("L"); }
    else { draws++; results.push("D"); }
  });

  return {
    name: teamName,
    wins, losses, draws, goalsFor, goalsAgainst,
    points: wins * 3 + draws,
    form: results.slice(-5),
  };
}

function getHeadToHead(team1: string, team2: string, allGames: Game[]) {
  const matchups = allGames.filter(
    (g) =>
      (g.homeTeam === team1 && g.awayTeam === team2) ||
      (g.homeTeam === team2 && g.awayTeam === team1)
  );

  let team1Wins = 0, team2Wins = 0, draws = 0;
  matchups.forEach((g) => {
    const t1Score = g.homeTeam === team1 ? g.homeScore : g.awayScore;
    const t2Score = g.homeTeam === team2 ? g.homeScore : g.awayScore;
    if (t1Score > t2Score) team1Wins++;
    else if (t2Score > t1Score) team2Wins++;
    else draws++;
  });

  return { matchups, team1Wins, team2Wins, draws, total: matchups.length };
}

const teams = [...new Set(games.flatMap((g) => [g.homeTeam, g.awayTeam]))].sort();

export default function Home() {
  const [selectedTeam1, setSelectedTeam1] = useState(teams[0]);
  const [selectedTeam2, setSelectedTeam2] = useState(teams[1]);
  const [tab, setTab] = useState<"standings" | "h2h" | "recent">("standings");

  const standings = teams
    .map((t) => getTeamStats(t, games))
    .sort((a, b) => b.points - a.points || (b.goalsFor - b.goalsAgainst) - (a.goalsFor - a.goalsAgainst));

  const h2h = getHeadToHead(selectedTeam1, selectedTeam2, games);

  const formBadge = (result: "W" | "L" | "D", i: number) => {
    const colors = { W: "bg-green-500", L: "bg-red-500", D: "bg-zinc-500" };
    return (
      <span
        key={i}
        className={`${colors[result]} inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold`}
      >
        {result}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white">
      <header className="border-b border-zinc-800 px-6 py-4">
        <h1 className="text-2xl font-bold">Sports Dashboard</h1>
        <p className="text-sm text-zinc-400">
          Built from a spreadsheet in 10 minutes with AI
        </p>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800">
        {(["standings", "h2h", "recent"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-6 py-3 text-sm font-medium transition-colors ${
              tab === t
                ? "border-b-2 border-blue-500 text-white"
                : "text-zinc-400 hover:text-white"
            }`}
          >
            {t === "standings" ? "Standings" : t === "h2h" ? "Head to Head" : "Recent Games"}
          </button>
        ))}
      </div>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {/* STANDINGS */}
        {tab === "standings" && (
          <div>
            <div className="mb-6 grid grid-cols-3 gap-3">
              <div className="rounded-xl bg-zinc-900 p-4 text-center">
                <div className="text-2xl font-bold text-blue-400">{games.length}</div>
                <div className="text-xs text-zinc-500">Games Played</div>
              </div>
              <div className="rounded-xl bg-zinc-900 p-4 text-center">
                <div className="text-2xl font-bold text-green-400">
                  {games.reduce((s, g) => s + g.homeScore + g.awayScore, 0)}
                </div>
                <div className="text-xs text-zinc-500">Total Goals</div>
              </div>
              <div className="rounded-xl bg-zinc-900 p-4 text-center">
                <div className="text-2xl font-bold text-purple-400">
                  {(games.reduce((s, g) => s + g.homeScore + g.awayScore, 0) / games.length).toFixed(1)}
                </div>
                <div className="text-xs text-zinc-500">Goals/Game</div>
              </div>
            </div>

            <div className="rounded-xl bg-zinc-900 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Team</th>
                    <th className="px-4 py-3 text-center">W</th>
                    <th className="px-4 py-3 text-center">D</th>
                    <th className="px-4 py-3 text-center">L</th>
                    <th className="px-4 py-3 text-center">GD</th>
                    <th className="px-4 py-3 text-center font-bold text-white">Pts</th>
                    <th className="hidden px-4 py-3 text-center sm:table-cell">Form</th>
                  </tr>
                </thead>
                <tbody>
                  {standings.map((team, i) => (
                    <tr
                      key={team.name}
                      className={`border-b border-zinc-800/50 ${i === 0 ? "bg-yellow-500/5" : ""}`}
                    >
                      <td className="px-4 py-3 text-zinc-500">{i + 1}</td>
                      <td className="px-4 py-3 font-medium">{team.name}</td>
                      <td className="px-4 py-3 text-center text-green-400">{team.wins}</td>
                      <td className="px-4 py-3 text-center text-zinc-400">{team.draws}</td>
                      <td className="px-4 py-3 text-center text-red-400">{team.losses}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={
                          team.goalsFor - team.goalsAgainst > 0 ? "text-green-400" :
                          team.goalsFor - team.goalsAgainst < 0 ? "text-red-400" : "text-zinc-400"
                        }>
                          {team.goalsFor - team.goalsAgainst > 0 ? "+" : ""}
                          {team.goalsFor - team.goalsAgainst}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-lg font-bold">{team.points}</td>
                      <td className="hidden px-4 py-3 sm:table-cell">
                        <div className="flex gap-1">{team.form.map(formBadge)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* HEAD TO HEAD */}
        {tab === "h2h" && (
          <div>
            <div className="mb-6 flex gap-3">
              <select
                value={selectedTeam1}
                onChange={(e) => setSelectedTeam1(e.target.value)}
                className="flex-1 rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none"
              >
                {teams.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <span className="flex items-center text-zinc-500 font-bold">vs</span>
              <select
                value={selectedTeam2}
                onChange={(e) => setSelectedTeam2(e.target.value)}
                className="flex-1 rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none"
              >
                {teams.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {selectedTeam1 === selectedTeam2 ? (
              <p className="text-center text-zinc-500 py-8">Pick two different teams</p>
            ) : (
              <>
                <div className="mb-6 grid grid-cols-3 gap-3">
                  <div className="rounded-xl bg-zinc-900 p-4 text-center">
                    <div className="text-3xl font-bold text-green-400">{h2h.team1Wins}</div>
                    <div className="text-xs text-zinc-500">{selectedTeam1} Wins</div>
                  </div>
                  <div className="rounded-xl bg-zinc-900 p-4 text-center">
                    <div className="text-3xl font-bold text-zinc-400">{h2h.draws}</div>
                    <div className="text-xs text-zinc-500">Draws</div>
                  </div>
                  <div className="rounded-xl bg-zinc-900 p-4 text-center">
                    <div className="text-3xl font-bold text-blue-400">{h2h.team2Wins}</div>
                    <div className="text-xs text-zinc-500">{selectedTeam2} Wins</div>
                  </div>
                </div>

                {h2h.total > 0 && (
                  <div className="mb-6 rounded-xl bg-zinc-900 p-4">
                    <div className="mb-2 text-xs text-zinc-500 text-center">
                      {h2h.total} games played
                    </div>
                    <div className="flex h-4 overflow-hidden rounded-full">
                      <div className="bg-green-500 transition-all" style={{ width: `${(h2h.team1Wins / h2h.total) * 100}%` }} />
                      <div className="bg-zinc-600 transition-all" style={{ width: `${(h2h.draws / h2h.total) * 100}%` }} />
                      <div className="bg-blue-500 transition-all" style={{ width: `${(h2h.team2Wins / h2h.total) * 100}%` }} />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {h2h.matchups.slice(-8).reverse().map((g, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
                      <span className="text-xs text-zinc-500 w-20">{g.date}</span>
                      <span className={`flex-1 text-right ${g.homeScore > g.awayScore ? "font-bold" : "text-zinc-400"}`}>
                        {g.homeTeam}
                      </span>
                      <span className="mx-3 rounded bg-zinc-800 px-3 py-1 font-mono font-bold">
                        {g.homeScore} - {g.awayScore}
                      </span>
                      <span className={`flex-1 ${g.awayScore > g.homeScore ? "font-bold" : "text-zinc-400"}`}>
                        {g.awayTeam}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* RECENT GAMES */}
        {tab === "recent" && (
          <div className="space-y-2">
            {games.slice(-15).reverse().map((g, i) => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-zinc-900 px-4 py-3">
                <span className="text-xs text-zinc-500 w-20">{g.date}</span>
                <span className={`flex-1 text-right ${g.homeScore > g.awayScore ? "font-bold" : "text-zinc-400"}`}>
                  {g.homeTeam}
                </span>
                <span className="mx-3 rounded bg-zinc-800 px-3 py-1 font-mono font-bold">
                  {g.homeScore} - {g.awayScore}
                </span>
                <span className={`flex-1 ${g.awayScore > g.homeScore ? "font-bold" : "text-zinc-400"}`}>
                  {g.awayTeam}
                </span>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
