"use client";

import { useState, useEffect } from "react";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Get model params
        const modelRes = await fetch("/api/model");
        const { params } = await modelRes.json();

        // Get match data to find upcoming (unplayed) matches
        const matchRes = await fetch("/api/matches");
        const matches = await matchRes.json();

        // Find the most recent played round
        const playedRounds = matches
          .filter((m: any) => m.round)
          .map((m: any) => m.round);
        const maxRound = Math.max(...playedRounds, 0);

        // Get teams from the current season
        const currentSeasonTeams = new Set(
          matches
            .filter((m: any) => m.season === "2024-25")
            .flatMap((m: any) => [m.homeTeam, m.awayTeam])
        );

        // Generate some upcoming fixtures by cycling teams we haven't seen play recently
        // For now, predict all possible next-round matchups from the model
        const teams = Object.keys(params.attack).filter((t) => currentSeasonTeams.has(t));

        // Create sample fixtures (in a real app, this comes from football-data.org)
        // For demo: generate round-robin for next round
        const upcomingFixtures: FixturePrediction[] = [];

        // Take pairs of teams for demo purposes (top vs bottom, etc.)
        const sortedTeams = [...teams].sort(
          (a, b) => (params.attack[b] / params.defense[b]) - (params.attack[a] / params.defense[a])
        );

        for (let i = 0; i < Math.min(10, Math.floor(sortedTeams.length / 2)); i++) {
          const home = sortedTeams[i];
          const away = sortedTeams[sortedTeams.length - 1 - i];

          const predRes = await fetch(
            `/api/predictions?home=${encodeURIComponent(home)}&away=${encodeURIComponent(away)}`
          );
          const pred = await predRes.json();

          if (pred.markets) {
            upcomingFixtures.push({
              date: "Next Round",
              homeTeam: home,
              awayTeam: away,
              round: maxRound + 1,
              home1X2: pred.markets.match1X2.home,
              draw1X2: pred.markets.match1X2.draw,
              away1X2: pred.markets.match1X2.away,
              over25: pred.markets.overUnder["2.5"]?.over || 0,
              bttsYes: pred.markets.btts.yes,
              predictedHome: pred.markets.predictedScore.home,
              predictedAway: pred.markets.predictedScore.away,
            });
          }
        }

        setFixtures(upcomingFixtures);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="py-20 text-center text-zinc-500">Generating predictions for upcoming fixtures...</div>;

  function pct(p: number): string { return `${(p * 100).toFixed(0)}%`; }
  function odds(p: number): string { return p > 0 ? (1 / p).toFixed(2) : "-"; }

  return (
    <div>
      <p className="mb-4 text-sm text-zinc-400">
        Sample matchups: strongest vs weakest (for demo). Connect football-data.org API key for real fixtures.
      </p>

      <div className="space-y-3">
        {fixtures.map((f, i) => (
          <div key={i} className="rounded-xl bg-zinc-900 p-4">
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
        <div className="py-20 text-center text-zinc-500">No fixtures to predict</div>
      )}
    </div>
  );
}
