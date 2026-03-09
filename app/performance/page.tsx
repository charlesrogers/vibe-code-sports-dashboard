"use client";

import { useState, useEffect } from "react";

interface PerfData {
  totalMatches: number;
  correctOutcomes: number;
  accuracy: number;
  brierScore: number;
  logLoss: number;
  calibration: { bucket: string; predicted: number; actual: number; count: number }[];
}

export default function PerformancePage() {
  const [perf, setPerf] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Fetch model and matches
        const [modelRes, matchRes] = await Promise.all([
          fetch("/api/model"),
          fetch("/api/matches"),
        ]);
        const { params } = await modelRes.json();
        const matches = await matchRes.json();

        // Use only current season matches for backtest
        const currentSeason = matches.filter((m: any) => m.season === "2024-25");

        // Split: train on first 70%, test on last 30%
        const splitIdx = Math.floor(currentSeason.length * 0.7);
        const testMatches = currentSeason.slice(splitIdx);

        // Run backtest client-side using the API
        let correct = 0;
        let brierSum = 0;
        let logLossSum = 0;
        let evaluated = 0;
        const buckets: Record<string, { predicted: number; actual: number; count: number }> = {};
        for (let i = 0; i < 10; i++) {
          const label = `${i * 10}-${(i + 1) * 10}%`;
          buckets[label] = { predicted: 0, actual: 0, count: 0 };
        }

        for (const m of testMatches) {
          if (!(m.homeTeam in params.attack) || !(m.awayTeam in params.attack)) continue;

          try {
            const res = await fetch(
              `/api/predictions?home=${encodeURIComponent(m.homeTeam)}&away=${encodeURIComponent(m.awayTeam)}`
            );
            const pred = await res.json();
            if (!pred.markets) continue;

            const probs = pred.markets.match1X2;
            const actual = m.homeGoals > m.awayGoals ? "home" : m.homeGoals < m.awayGoals ? "away" : "draw";
            const predicted = probs.home >= probs.draw && probs.home >= probs.away ? "home"
              : probs.away >= probs.draw ? "away" : "draw";

            if (actual === predicted) correct++;

            const actH = actual === "home" ? 1 : 0;
            const actD = actual === "draw" ? 1 : 0;
            const actA = actual === "away" ? 1 : 0;
            brierSum += (probs.home - actH) ** 2 + (probs.draw - actD) ** 2 + (probs.away - actA) ** 2;

            const actualProb = actual === "home" ? probs.home : actual === "draw" ? probs.draw : probs.away;
            logLossSum += -Math.log(Math.max(actualProb, 0.001));

            const maxProb = Math.max(probs.home, probs.draw, probs.away);
            const bucketIdx = Math.min(9, Math.floor(maxProb * 10));
            const bucketKey = `${bucketIdx * 10}-${(bucketIdx + 1) * 10}%`;
            buckets[bucketKey].predicted += maxProb;
            buckets[bucketKey].actual += actual === predicted ? 1 : 0;
            buckets[bucketKey].count += 1;

            evaluated++;
          } catch { continue; }
        }

        const calibration = Object.entries(buckets)
          .filter(([, v]) => v.count > 0)
          .map(([bucket, v]) => ({
            bucket,
            predicted: Math.round((v.predicted / v.count) * 100) / 100,
            actual: Math.round((v.actual / v.count) * 100) / 100,
            count: v.count,
          }));

        setPerf({
          totalMatches: evaluated,
          correctOutcomes: correct,
          accuracy: evaluated > 0 ? Math.round((correct / evaluated) * 1000) / 10 : 0,
          brierScore: evaluated > 0 ? Math.round((brierSum / evaluated) * 1000) / 1000 : 0,
          logLoss: evaluated > 0 ? Math.round((logLossSum / evaluated) * 1000) / 1000 : 0,
          calibration,
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="py-20 text-center text-zinc-500">Running backtest (~30 seconds)...</div>;
  if (!perf) return <div className="py-20 text-center text-red-400">Backtest failed</div>;

  return (
    <div>
      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-4 gap-3">
        <div className="rounded-xl bg-zinc-900 p-4 text-center">
          <div className="text-2xl font-bold text-blue-400">{perf.totalMatches}</div>
          <div className="text-xs text-zinc-500">Matches Tested</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-4 text-center">
          <div className={`text-2xl font-bold ${perf.accuracy >= 45 ? "text-green-400" : "text-red-400"}`}>
            {perf.accuracy}%
          </div>
          <div className="text-xs text-zinc-500">Accuracy (1X2)</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-4 text-center">
          <div className={`text-2xl font-bold ${perf.brierScore < 0.6 ? "text-green-400" : "text-yellow-400"}`}>
            {perf.brierScore}
          </div>
          <div className="text-xs text-zinc-500">Brier Score</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-4 text-center">
          <div className="text-2xl font-bold text-purple-400">{perf.logLoss}</div>
          <div className="text-xs text-zinc-500">Log Loss</div>
        </div>
      </div>

      {/* Calibration */}
      <div className="rounded-xl bg-zinc-900 p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-400">Calibration</h3>
        <p className="mb-3 text-xs text-zinc-500">
          When the model says X% confident, how often is it right?
        </p>
        <div className="space-y-2">
          {perf.calibration.map((c) => (
            <div key={c.bucket} className="flex items-center gap-3 text-sm">
              <span className="w-16 text-zinc-500">{c.bucket}</span>
              <div className="flex-1 h-4 rounded-full bg-zinc-800 overflow-hidden relative">
                {/* Predicted */}
                <div
                  className="absolute h-full bg-blue-500/30 rounded-full"
                  style={{ width: `${c.predicted * 100}%` }}
                />
                {/* Actual */}
                <div
                  className="absolute h-full bg-green-500 rounded-full"
                  style={{ width: `${c.actual * 100}%` }}
                />
              </div>
              <span className="w-24 text-right text-xs">
                <span className="text-blue-400">{(c.predicted * 100).toFixed(0)}%</span>
                {" / "}
                <span className="text-green-400">{(c.actual * 100).toFixed(0)}%</span>
              </span>
              <span className="w-8 text-right text-xs text-zinc-500">n={c.count}</span>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-zinc-500">
          <span><span className="text-blue-400">Blue</span> = predicted confidence</span>
          <span><span className="text-green-400">Green</span> = actual accuracy</span>
        </div>
      </div>

      <div className="mt-4 rounded-xl bg-zinc-900 p-4">
        <h3 className="mb-2 text-sm font-medium text-zinc-400">Benchmarks</h3>
        <div className="space-y-1 text-xs text-zinc-500">
          <p>Brier Score: 0.0 = perfect, 0.667 = always predicting 33/33/33. Below 0.55 is good.</p>
          <p>1X2 Accuracy: 33% = random, 45-50% = good model, &gt;55% = excellent.</p>
          <p>Log Loss: lower is better. Below 1.0 indicates useful predictions.</p>
        </div>
      </div>
    </div>
  );
}
