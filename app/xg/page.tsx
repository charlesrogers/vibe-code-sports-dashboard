"use client";

import { useState, useEffect } from "react";
import { TeamXg } from "@/lib/types";

export default function XgDashboardPage() {
  const [xgData, setXgData] = useState<TeamXg[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"xGDiff" | "xGFor" | "xGAgainst" | "overperformance">("xGDiff");

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/xg");
        if (!res.ok) throw new Error();
        const data = await res.json();
        setXgData(data);
      } catch {
        // xG data may not be available
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="py-20 text-center text-zinc-500">Loading xG data from Understat...</div>;
  if (xgData.length === 0) return (
    <div className="py-20 text-center text-zinc-500">
      <p className="text-lg">xG data unavailable</p>
      <p className="mt-2 text-sm">Understat may be temporarily inaccessible. Try again later.</p>
    </div>
  );

  const sorted = [...xgData].sort((a, b) => {
    if (sortBy === "xGFor") return b.xGFor - a.xGFor;
    if (sortBy === "xGAgainst") return a.xGAgainst - b.xGAgainst;
    if (sortBy === "overperformance") return b.overperformance - a.overperformance;
    return b.xGDiff - a.xGDiff;
  });

  const maxXg = Math.max(...xgData.map((t) => Math.max(t.xGFor, t.goalsFor)));

  return (
    <div>
      {/* xG vs Actual scatter (simplified as a comparison table) */}
      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-zinc-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-400">Biggest Overperformers (Goals &gt; xG)</h3>
          <div className="space-y-2">
            {[...xgData].sort((a, b) => b.overperformance - a.overperformance).slice(0, 5).map((t) => (
              <div key={t.team} className="flex justify-between text-sm">
                <span>{t.team}</span>
                <span className="text-green-400">+{t.overperformance.toFixed(1)} goals</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-400">Biggest Underperformers (Goals &lt; xG)</h3>
          <div className="space-y-2">
            {[...xgData].sort((a, b) => a.overperformance - b.overperformance).slice(0, 5).map((t) => (
              <div key={t.team} className="flex justify-between text-sm">
                <span>{t.team}</span>
                <span className="text-red-400">{t.overperformance.toFixed(1)} goals</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sort buttons */}
      <div className="mb-4 flex gap-2">
        {(["xGDiff", "xGFor", "xGAgainst", "overperformance"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSortBy(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              sortBy === s ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"
            }`}
          >
            {s === "xGDiff" ? "xG Diff" : s === "xGFor" ? "xG For" : s === "xGAgainst" ? "xG Against" : "Over/Under Perf"}
          </button>
        ))}
      </div>

      {/* xG Table */}
      <div className="rounded-xl bg-zinc-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-400">
              <th className="px-3 py-3 text-left">#</th>
              <th className="px-3 py-3 text-left">Team</th>
              <th className="px-3 py-3 text-center">MP</th>
              <th className="px-3 py-3 text-center">Goals</th>
              <th className="px-3 py-3 text-center">xG</th>
              <th className="px-3 py-3 text-center">GA</th>
              <th className="px-3 py-3 text-center">xGA</th>
              <th className="px-3 py-3 text-center">xGD</th>
              <th className="px-3 py-3 text-center">+/-</th>
              <th className="px-3 py-3 text-left">xG vs Actual</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => (
              <tr key={t.team} className="border-b border-zinc-800/50">
                <td className="px-3 py-2 text-zinc-500">{i + 1}</td>
                <td className="px-3 py-2 font-medium">{t.team}</td>
                <td className="px-3 py-2 text-center text-zinc-400">{t.matches}</td>
                <td className="px-3 py-2 text-center">{t.goalsFor}</td>
                <td className="px-3 py-2 text-center text-blue-400">{t.xGFor.toFixed(1)}</td>
                <td className="px-3 py-2 text-center">{t.goalsAgainst}</td>
                <td className="px-3 py-2 text-center text-blue-400">{t.xGAgainst.toFixed(1)}</td>
                <td className={`px-3 py-2 text-center font-bold ${t.xGDiff > 0 ? "text-green-400" : "text-red-400"}`}>
                  {t.xGDiff > 0 ? "+" : ""}{t.xGDiff.toFixed(1)}
                </td>
                <td className={`px-3 py-2 text-center ${t.overperformance > 0 ? "text-green-400" : "text-red-400"}`}>
                  {t.overperformance > 0 ? "+" : ""}{t.overperformance.toFixed(1)}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <div className="h-3 rounded bg-zinc-700" style={{ width: `${(t.xGFor / maxXg) * 80}px` }}>
                      <div className="h-full rounded bg-blue-500" style={{ width: "100%" }} />
                    </div>
                    <div className="h-3 rounded bg-green-500" style={{ width: `${(t.goalsFor / maxXg) * 80}px` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-zinc-600">
        xG (Expected Goals) measures shot quality. +/- shows overperformance (goals minus xG).
        Teams with high positive +/- may regress; negative +/- may improve. Data from Understat.
      </p>
    </div>
  );
}
