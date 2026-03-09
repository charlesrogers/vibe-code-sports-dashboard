"use client";

import { useState, useEffect } from "react";
import ProbabilityGrid from "../components/probability-grid";
import BettingMarketsDisplay from "../components/betting-markets";
import { BettingMarkets } from "@/lib/types";

export default function PredictorPage() {
  const [teams, setTeams] = useState<string[]>([]);
  const [home, setHome] = useState("");
  const [away, setAway] = useState("");
  const [prediction, setPrediction] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);

  // Load team list
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/model");
        const data = await res.json();
        const teamNames = Object.keys(data.params.attack).sort();
        setTeams(teamNames);
        if (teamNames.length >= 2) {
          setHome(teamNames[0]);
          setAway(teamNames[1]);
        }
      } catch {
      } finally {
        setInitialLoading(false);
      }
    }
    load();
  }, []);

  async function predict() {
    if (!home || !away || home === away) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/predictions?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`);
      const data = await res.json();
      setPrediction(data);
    } catch {
    } finally {
      setLoading(false);
    }
  }

  if (initialLoading) return <div className="py-20 text-center text-zinc-500">Loading teams...</div>;

  return (
    <div>
      {/* Team Selectors */}
      <div className="mb-6 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[150px]">
          <label className="mb-1 block text-xs text-zinc-500">Home Team</label>
          <select
            value={home}
            onChange={(e) => setHome(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none"
          >
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <span className="pb-3 text-zinc-500 font-bold">vs</span>
        <div className="flex-1 min-w-[150px]">
          <label className="mb-1 block text-xs text-zinc-500">Away Team</label>
          <select
            value={away}
            onChange={(e) => setAway(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 px-4 py-3 text-white outline-none"
          >
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button
          onClick={predict}
          disabled={loading || home === away}
          className="rounded-lg bg-blue-600 px-8 py-3 font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
        >
          {loading ? "Running model..." : "Predict"}
        </button>
      </div>

      {home === away && (
        <p className="mb-4 text-center text-yellow-400 text-sm">Select two different teams</p>
      )}

      {prediction && (
        <div className="space-y-6">
          {/* Expected Goals Header */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-3xl font-bold text-green-400">
                {prediction.expectedGoals.home}
              </div>
              <div className="text-xs text-zinc-500">{home} xG</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-3xl font-bold text-zinc-300">
                {prediction.markets.predictedScore.home} - {prediction.markets.predictedScore.away}
              </div>
              <div className="text-xs text-zinc-500">Most Likely Score</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-3xl font-bold text-blue-400">
                {prediction.expectedGoals.away}
              </div>
              <div className="text-xs text-zinc-500">{away} xG</div>
            </div>
          </div>

          {/* Probability Grid */}
          <div className="rounded-xl bg-zinc-900 p-4">
            <h3 className="mb-3 text-sm font-medium text-zinc-400">Score Probability Matrix (%)</h3>
            <ProbabilityGrid grid={prediction.grid} homeTeam={home} awayTeam={away} />
          </div>

          {/* All Betting Markets */}
          <BettingMarketsDisplay markets={prediction.markets} homeTeam={home} awayTeam={away} />
        </div>
      )}
    </div>
  );
}
