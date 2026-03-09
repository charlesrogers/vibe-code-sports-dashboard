"use client";

import { useState, useEffect } from "react";
import LeagueSelector from "../components/league-selector";

interface FixturePrediction {
  date: string;
  homeTeam: string;
  awayTeam: string;
  round?: number;
  home1X2: number;
  draw1X2: number;
  away1X2: number;
  over25: number;
  bttsYes: number;
  predictedHome: number;
  predictedAway: number;
}

export default function FixturesPage() {
  const [fixtures, setFixtures] = useState<FixturePrediction[]>([]);
  const [league, setLeague] = useState("serieA");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/live-bets?league=${league}`);
        const data = await res.json();

        const mapped: FixturePrediction[] = (data.fixtures || []).map((f: any) => ({
          date: f.date,
          homeTeam: f.homeTeam,
          awayTeam: f.awayTeam,
          round: f.round,
          home1X2: f.probs.home / 100,
          draw1X2: f.probs.draw / 100,
          away1X2: f.probs.away / 100,
          over25: f.over25 / 100,
          bttsYes: f.bttsYes / 100,
          predictedHome: f.expHome,
          predictedAway: f.expAway,
        }));

        setFixtures(mapped);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [league]);

  if (loading) return <div className="py-20 text-center text-zinc-500">Generating predictions for upcoming fixtures...</div>;

  function pct(p: number): string { return `${(p * 100).toFixed(0)}%`; }
  function odds(p: number): string { return p > 0 ? (1 / p).toFixed(2) : "-"; }

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <LeagueSelector value={league} onChange={setLeague} />
        <span className="text-sm text-zinc-400">
          Upcoming {league === "serieB" ? "Serie B" : "Serie A"} 2025-26 fixtures with Dixon-Coles model predictions.
        </span>
      </div>

      <div className="space-y-3">
        {fixtures.map((f, i) => (
          <div key={i} className="rounded-xl bg-zinc-900 p-4">
            {/* Date & round */}
            <div className="mb-1 text-[10px] text-zinc-500">
              {f.date} &middot; Matchday {f.round}
            </div>

            {/* Match header */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex-1 text-right">
                <span className="text-lg font-medium">{f.homeTeam}</span>
              </div>
              <div className="mx-4 rounded bg-zinc-800 px-4 py-1 font-mono text-lg font-bold">
                {f.predictedHome} - {f.predictedAway}
              </div>
              <div className="flex-1">
                <span className="text-lg font-medium">{f.awayTeam}</span>
              </div>
            </div>

            {/* 1X2 bar */}
            <div className="mb-2 flex h-6 overflow-hidden rounded-full text-[10px] font-bold">
              <div className="flex items-center justify-center bg-green-600" style={{ width: pct(f.home1X2) }}>
                {pct(f.home1X2)}
              </div>
              <div className="flex items-center justify-center bg-yellow-600" style={{ width: pct(f.draw1X2) }}>
                {pct(f.draw1X2)}
              </div>
              <div className="flex items-center justify-center bg-blue-600" style={{ width: pct(f.away1X2) }}>
                {pct(f.away1X2)}
              </div>
            </div>

            {/* Quick stats */}
            <div className="flex gap-4 text-xs text-zinc-400">
              <span>1: {odds(f.home1X2)}</span>
              <span>X: {odds(f.draw1X2)}</span>
              <span>2: {odds(f.away1X2)}</span>
              <span className="ml-auto">O2.5: {pct(f.over25)}</span>
              <span>BTTS: {pct(f.bttsYes)}</span>
            </div>
          </div>
        ))}
      </div>

      {fixtures.length === 0 && (
        <div className="py-20 text-center text-zinc-500">No upcoming fixtures found</div>
      )}
    </div>
  );
}
