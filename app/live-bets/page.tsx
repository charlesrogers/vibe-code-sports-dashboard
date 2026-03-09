"use client";

import { useState, useEffect } from "react";

interface Prediction {
  date: string;
  round?: number;
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  expHome: number;
  expAway: number;
  probs: { home: number; draw: number; away: number };
  fairOdds: { home: number; draw: number; away: number };
  over15: number;
  over25: number;
  over35: number;
  bttsYes: number;
}

export default function LiveBetsPage() {
  const [fixtures, setFixtures] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRound, setSelectedRound] = useState<number | "all">("all");
  const [sortBy, setSortBy] = useState<"date" | "homeProb" | "overUnder">("date");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/live-bets");
        const data = await res.json();
        setFixtures(data.fixtures || []);
        // Auto-select the nearest upcoming round
        if (data.fixtures?.length > 0) {
          const rounds = [...new Set(data.fixtures.map((f: Prediction) => f.round))].sort() as number[];
          if (rounds.length > 0) setSelectedRound(rounds[0]);
        }
      } catch {
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const rounds = [...new Set(fixtures.map((f) => f.round))].sort() as number[];

  const filtered = selectedRound === "all"
    ? fixtures
    : fixtures.filter((f) => f.round === selectedRound);

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "homeProb") return b.probs.home - a.probs.home;
    if (sortBy === "overUnder") return b.over25 - a.over25;
    return a.date.localeCompare(b.date);
  });

  if (loading) return <div className="py-20 text-center text-zinc-500">Loading upcoming fixtures & running model predictions...</div>;

  return (
    <div>
      <div className="mb-4 text-sm text-zinc-400">
        Dixon-Coles model predictions for upcoming Serie A 2025-26 fixtures. Fair odds have zero margin — compare with your bookmaker to find value.
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">Matchday:</label>
          <select
            value={selectedRound === "all" ? "all" : selectedRound}
            onChange={(e) => setSelectedRound(e.target.value === "all" ? "all" : parseInt(e.target.value))}
            className="rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white outline-none"
          >
            <option value="all">All ({fixtures.length})</option>
            {rounds.map((r) => (
              <option key={r} value={r}>
                Matchday {r} ({fixtures.filter((f) => f.round === r).length})
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-1 ml-auto">
          {([["date", "By Date"], ["homeProb", "Home %"], ["overUnder", "O/U 2.5"]] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setSortBy(key as any)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                sortBy === key ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="mb-6 grid grid-cols-3 gap-3 sm:grid-cols-5">
        <div className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xl font-bold text-blue-400">{filtered.length}</div>
          <div className="text-[10px] text-zinc-500">Fixtures</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xl font-bold text-green-400">
            {filtered.filter((f) => f.probs.home > 55).length}
          </div>
          <div className="text-[10px] text-zinc-500">Strong Home</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xl font-bold text-purple-400">
            {filtered.filter((f) => f.probs.away > 45).length}
          </div>
          <div className="text-[10px] text-zinc-500">Strong Away</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-3 text-center hidden sm:block">
          <div className="text-xl font-bold text-yellow-400">
            {filtered.filter((f) => f.over25 > 60).length}
          </div>
          <div className="text-[10px] text-zinc-500">Likely O2.5</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-3 text-center hidden sm:block">
          <div className="text-xl font-bold text-red-400">
            {filtered.filter((f) => f.bttsYes > 60).length}
          </div>
          <div className="text-[10px] text-zinc-500">Likely BTTS</div>
        </div>
      </div>

      {/* Fixture Cards */}
      <div className="space-y-3">
        {sorted.map((f, i) => {
          const favorite = f.probs.home > f.probs.away ? "home" : f.probs.away > f.probs.home ? "away" : "draw";
          return (
            <div key={i} className="rounded-xl bg-zinc-900 p-4">
              {/* Header */}
              <div className="mb-1 flex items-center justify-between text-[10px] text-zinc-500">
                <span>{f.date} &middot; Matchday {f.round}</span>
                <span>ELO: {f.homeElo} vs {f.awayElo}</span>
              </div>

              {/* Teams & Score */}
              <div className="mb-3 flex items-center justify-between">
                <div className="flex-1 text-right">
                  <span className={`text-lg font-medium ${favorite === "home" ? "text-green-400" : ""}`}>
                    {f.homeTeam}
                  </span>
                </div>
                <div className="mx-4 rounded bg-zinc-800 px-4 py-1 font-mono text-lg font-bold">
                  {f.expHome} - {f.expAway}
                </div>
                <div className="flex-1">
                  <span className={`text-lg font-medium ${favorite === "away" ? "text-blue-400" : ""}`}>
                    {f.awayTeam}
                  </span>
                </div>
              </div>

              {/* 1X2 Probability Bar */}
              <div className="mb-2 flex h-7 overflow-hidden rounded-full text-[10px] font-bold">
                <div
                  className="flex items-center justify-center bg-green-600"
                  style={{ width: `${f.probs.home}%` }}
                >
                  {f.probs.home}%
                </div>
                <div
                  className="flex items-center justify-center bg-yellow-600"
                  style={{ width: `${f.probs.draw}%` }}
                >
                  {f.probs.draw}%
                </div>
                <div
                  className="flex items-center justify-center bg-blue-600"
                  style={{ width: `${f.probs.away}%` }}
                >
                  {f.probs.away}%
                </div>
              </div>

              {/* Fair Odds & Markets */}
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                <div>
                  <span className="text-zinc-500">Fair Odds: </span>
                  <span className="font-mono text-green-400">1: {f.fairOdds.home}</span>
                  <span className="mx-1 text-zinc-600">|</span>
                  <span className="font-mono text-yellow-400">X: {f.fairOdds.draw}</span>
                  <span className="mx-1 text-zinc-600">|</span>
                  <span className="font-mono text-blue-400">2: {f.fairOdds.away}</span>
                </div>
                <div>
                  <span className="text-zinc-500">O1.5: </span>
                  <span className="font-mono text-zinc-300">{f.over15}%</span>
                  <span className="mx-1 text-zinc-600">|</span>
                  <span className="text-zinc-500">O2.5: </span>
                  <span className={`font-mono ${f.over25 > 55 ? "text-green-400" : f.over25 < 40 ? "text-red-400" : "text-zinc-300"}`}>
                    {f.over25}%
                  </span>
                  <span className="mx-1 text-zinc-600">|</span>
                  <span className="text-zinc-500">O3.5: </span>
                  <span className="font-mono text-zinc-300">{f.over35}%</span>
                </div>
                <div>
                  <span className="text-zinc-500">BTTS: </span>
                  <span className={`font-mono font-bold ${f.bttsYes > 55 ? "text-green-400" : "text-zinc-300"}`}>
                    {f.bttsYes}%
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {fixtures.length === 0 && (
        <div className="py-20 text-center text-zinc-500">No upcoming fixtures found</div>
      )}

      <p className="mt-4 text-xs text-zinc-600">
        Fair odds = model probability converted to decimal odds with zero margin.
        If a bookmaker offers higher odds than the fair price, that&apos;s a value bet.
        xG = expected goals from Dixon-Coles Poisson model. Compare these with your book&apos;s lines.
      </p>
    </div>
  );
}
