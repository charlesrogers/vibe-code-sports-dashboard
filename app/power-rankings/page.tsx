"use client";

import { useState, useEffect } from "react";

interface TeamRank {
  team: string;
  attack: number;
  defense: number;
  overall: number;
  elo: number;
}

export default function PowerRankingsPage() {
  const [teams, setTeams] = useState<TeamRank[]>([]);
  const [sortBy, setSortBy] = useState<"overall" | "attack" | "defense" | "elo">("overall");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/model");
        const data = await res.json();
        const eloMap = new Map(data.elo.map((e: any) => [e.team, e.rating]));
        const rows: TeamRank[] = Object.keys(data.params.attack).map((team) => ({
          team,
          attack: data.params.attack[team],
          defense: data.params.defense[team],
          overall: data.params.attack[team] / data.params.defense[team],
          elo: (eloMap.get(team) as number) || 1500,
        }));
        setTeams(rows);
      } catch {
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="py-20 text-center text-zinc-500">Loading rankings...</div>;

  const sorted = [...teams].sort((a, b) => {
    if (sortBy === "attack") return b.attack - a.attack;
    if (sortBy === "defense") return a.defense - b.defense; // lower is better
    if (sortBy === "elo") return b.elo - a.elo;
    return b.overall - a.overall;
  });

  const maxAtt = Math.max(...teams.map((t) => t.attack));
  const maxDef = Math.max(...teams.map((t) => t.defense));

  return (
    <div>
      {/* Sort buttons */}
      <div className="mb-4 flex gap-2">
        {(["overall", "attack", "defense", "elo"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              sortBy === s ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-white"
            }`}
          >
            {s === "overall" ? "Overall" : s === "attack" ? "Attack" : s === "defense" ? "Defense" : "ELO"}
          </button>
        ))}
      </div>

      {/* Rankings */}
      <div className="space-y-2">
        {sorted.map((team, i) => (
          <div key={team.team} className="flex items-center gap-4 rounded-xl bg-zinc-900 px-4 py-3">
            <span className={`w-8 text-center text-lg font-bold ${
              i === 0 ? "text-yellow-400" : i === 1 ? "text-zinc-300" : i === 2 ? "text-amber-600" : "text-zinc-500"
            }`}>
              {i + 1}
            </span>
            <div className="w-32 font-medium">{team.team}</div>
            <div className="flex-1 space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-12 text-right text-xs text-zinc-500">ATK</span>
                <div className="h-3 flex-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-green-500 rounded-full" style={{ width: `${(team.attack / maxAtt) * 100}%` }} />
                </div>
                <span className="w-10 text-right text-xs text-green-400">{team.attack.toFixed(2)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-12 text-right text-xs text-zinc-500">DEF</span>
                <div className="h-3 flex-1 rounded-full bg-zinc-800 overflow-hidden">
                  <div className="h-full bg-red-500 rounded-full" style={{ width: `${(team.defense / maxDef) * 100}%` }} />
                </div>
                <span className="w-10 text-right text-xs text-red-400">{team.defense.toFixed(2)}</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold">{sortBy === "elo" ? team.elo : team.overall.toFixed(2)}</div>
              <div className="text-xs text-zinc-500">{sortBy === "elo" ? "ELO" : "DC Rating"}</div>
            </div>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-zinc-600">
        Attack: scoring ability (higher = better). Defense: goals conceded rate (lower = better).
        Overall = attack/defense ratio. ELO = cumulative win-based rating.
      </p>
    </div>
  );
}
