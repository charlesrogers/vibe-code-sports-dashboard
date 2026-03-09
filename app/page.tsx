"use client";

import { useState, useEffect } from "react";
import SeasonSelector from "./components/season-selector";

interface StandingRow {
  position: number;
  team: string;
  attack: number;
  defense: number;
  overall: number;
  elo: number;
}

export default function StandingsPage() {
  const [teams, setTeams] = useState<StandingRow[]>([]);
  const [season, setSeason] = useState("2025-26");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [matchCount, setMatchCount] = useState(0);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/model?season=${season}`);
        if (!res.ok) throw new Error("Failed to load model");
        const data = await res.json();
        setMatchCount(data.matchCount || 0);

        const { params, elo } = data;
        const eloMap = new Map(elo.map((e: any) => [e.team, e.rating]));

        const rows: StandingRow[] = Object.keys(params.attack)
          .map((team, i) => ({
            position: i + 1,
            team,
            attack: params.attack[team],
            defense: params.defense[team],
            overall: params.attack[team] / params.defense[team],
            elo: (eloMap.get(team) as number) || 1500,
          }))
          .sort((a, b) => b.overall - a.overall)
          .map((row, i) => ({ ...row, position: i + 1 }));

        setTeams(rows);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [season]);

  if (loading) return <div className="py-20 text-center text-zinc-500">Fitting Dixon-Coles model for {season}...</div>;
  if (error) return <div className="py-20 text-center text-red-400">{error}</div>;

  return (
    <div>
      {/* Season selector */}
      <div className="mb-4 flex items-center gap-3">
        <SeasonSelector value={season} onChange={setSeason} />
        <span className="text-xs text-zinc-500">{matchCount} matches &middot; {teams.length} teams</span>
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <div className="rounded-xl bg-zinc-900 p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">{teams.length}</div>
          <div className="text-xs text-zinc-500">Teams</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-4 text-center">
          <div className="text-2xl font-bold text-green-400">
            {teams.length > 0 ? teams[0].team : "-"}
          </div>
          <div className="text-xs text-zinc-500">Strongest (DC)</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-4 text-center">
          <div className="text-2xl font-bold text-purple-400">
            {teams.length > 0 ? teams.sort((a, b) => b.attack - a.attack)[0].team : "-"}
          </div>
          <div className="text-xs text-zinc-500">Best Attack</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-4 text-center">
          <div className="text-2xl font-bold text-yellow-400">
            {teams.length > 0 ? [...teams].sort((a, b) => a.defense - b.defense)[0].team : "-"}
          </div>
          <div className="text-xs text-zinc-500">Best Defense</div>
        </div>
      </div>

      {/* Rankings Table */}
      <div className="rounded-xl bg-zinc-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400">
              <th className="px-4 py-3 text-left">#</th>
              <th className="px-4 py-3 text-left">Team</th>
              <th className="px-4 py-3 text-center">Attack</th>
              <th className="px-4 py-3 text-center">Defense</th>
              <th className="px-4 py-3 text-center">Overall</th>
              <th className="px-4 py-3 text-center">ELO</th>
              <th className="px-4 py-3 text-left">Att/Def</th>
            </tr>
          </thead>
          <tbody>
            {[...teams].sort((a, b) => b.overall - a.overall).map((team, i) => (
              <tr
                key={team.team}
                className={`border-b border-zinc-800/50 ${
                  i < 4 ? "bg-blue-500/5" : i >= teams.length - 3 ? "bg-red-500/5" : ""
                }`}
              >
                <td className="px-4 py-3 text-zinc-500">{i + 1}</td>
                <td className="px-4 py-3 font-medium">{team.team}</td>
                <td className="px-4 py-3 text-center">
                  <span className={team.attack > 1.15 ? "text-green-400" : team.attack < 0.85 ? "text-red-400" : "text-zinc-300"}>
                    {team.attack.toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={team.defense < 0.85 ? "text-green-400" : team.defense > 1.15 ? "text-red-400" : "text-zinc-300"}>
                    {team.defense.toFixed(2)}
                  </span>
                </td>
                <td className="px-4 py-3 text-center font-bold">
                  {team.overall.toFixed(2)}
                </td>
                <td className="px-4 py-3 text-center text-zinc-400">
                  {team.elo}
                </td>
                <td className="px-4 py-3">
                  <div className="flex h-3 w-32 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="bg-green-500"
                      style={{ width: `${Math.min(100, (team.attack / 2) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-1 flex h-3 w-32 overflow-hidden rounded-full bg-zinc-800">
                    <div
                      className="bg-red-500"
                      style={{ width: `${Math.min(100, (team.defense / 2) * 100)}%` }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-zinc-600">
        Attack &gt; 1.0 = above average scoring. Defense &lt; 1.0 = better than average defending.
        Overall = attack / defense ratio. Top 4 highlighted blue (CL), bottom 3 red (relegation).
      </p>
    </div>
  );
}
