"use client";

import { useState, useEffect } from "react";

interface SignalScore {
  signal: string;
  n: number;
  clvMean: number;
  roi: number;
  hitRate: number;
  profit: number;
  trend: "up" | "down" | "flat";
}

interface SignalHealthData {
  scorecard: SignalScore[];
  totalSettled: number;
  totalTagged: number;
}

const SIGNAL_LABELS: Record<string, string> = {
  "variance-regression": "Variance",
  "congestion-filter": "Congestion",
  "odds-cap-2.0": "Odds Cap",
  "pass-rate-filter": "Pass Rate",
  "injury-lambda": "Injury Adj",
  "gk-psxg-adj": "GK Adj",
  P1: "Quality+Under",
  P2: "Def Underperf",
  P3: "Opp Regress",
  P4: "Fragile Atk",
  P5: "Dam Break",
  P6: "Extreme Gap",
  P7: "Avg+Under",
  P8: "Opp Injuries",
  P9: "Double Var",
  untagged: "Untagged",
};

const TREND_ICON: Record<string, string> = {
  up: "\u2191",
  down: "\u2193",
  flat: "\u2192",
};

export default function SignalHealth() {
  const [data, setData] = useState<SignalHealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/signal-health")
      .then(async (r) => {
        if (!r.ok) return;
        const d = await r.json();
        if (!d.error) setData(d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <div className="text-xs text-zinc-500">Loading signal health...</div>
      </div>
    );
  }

  if (!data || data.scorecard.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="text-sm font-semibold text-zinc-300 mb-2">Signal Health</h3>
        <div className="text-xs text-zinc-600">No settled bets with signal tags yet. Signals will appear after bets settle.</div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-zinc-300">Signal Health</h3>
        <span className="text-[10px] text-zinc-600">
          {data.totalTagged}/{data.totalSettled} tagged
        </span>
      </div>
      <div className="space-y-1.5">
        {data.scorecard.map((s) => (
          <div
            key={s.signal}
            className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-[11px]"
          >
            <span className="w-20 truncate text-zinc-400 font-medium" title={s.signal}>
              {SIGNAL_LABELS[s.signal] || s.signal}
            </span>
            <span
              className={`w-14 text-right font-mono ${
                s.clvMean > 0 ? "text-green-400" : s.clvMean < 0 ? "text-red-400" : "text-zinc-500"
              }`}
            >
              {s.clvMean > 0 ? "+" : ""}
              {s.clvMean.toFixed(1)}%
            </span>
            <span className="w-10 text-right font-mono text-zinc-500">{s.n}b</span>
            <span
              className={`w-14 text-right font-mono ${
                s.roi > 0 ? "text-green-500" : s.roi < 0 ? "text-red-500" : "text-zinc-600"
              }`}
            >
              {s.roi > 0 ? "+" : ""}
              {s.roi.toFixed(1)}%
            </span>
            <span
              className={`w-5 text-center ${
                s.trend === "up"
                  ? "text-green-400"
                  : s.trend === "down"
                  ? "text-red-400"
                  : "text-zinc-600"
              }`}
              title={`Trend: ${s.trend}`}
            >
              {TREND_ICON[s.trend]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
