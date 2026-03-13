"use client";

import { useState } from "react";

interface Signal {
  id: string;
  registered: string;
  hypothesis: string;
  metric: string;
  threshold: string;
  status: "pending" | "testing" | "accepted" | "rejected" | "graveyard";
  result?: string;
  deployed?: string;
  deployedIn?: string;
  backtestStats?: {
    standaloneROI: number;
    standaloneCLV: number;
    standaloneN: number;
    marginalROI?: number;
    correlationWithBase?: number;
    testedAt: string;
  };
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-zinc-800 text-zinc-400 border-zinc-700",
  testing: "bg-blue-900/30 text-blue-400 border-blue-800",
  accepted: "bg-green-900/30 text-green-400 border-green-800",
  rejected: "bg-red-900/30 text-red-400 border-red-800",
  graveyard: "bg-zinc-800 text-zinc-600 border-zinc-700",
};

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

export default function SignalExplorer({ signals }: { signals: Signal[] }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"registered" | "roi">("registered");

  const filtered = signals.filter(s => statusFilter === "all" || s.status === statusFilter);

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "roi") {
      const aROI = a.backtestStats?.standaloneROI ?? -Infinity;
      const bROI = b.backtestStats?.standaloneROI ?? -Infinity;
      return bROI - aROI;
    }
    return (b.registered || "").localeCompare(a.registered || "");
  });

  return (
    <div className="space-y-3">
      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1">
          {["all", "pending", "testing", "accepted", "rejected", "graveyard"].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`rounded px-2 py-0.5 text-[10px] border ${
                statusFilter === s
                  ? "bg-blue-900/50 text-blue-400 border-blue-700"
                  : "bg-zinc-900 text-zinc-500 border-zinc-800"
              }`}>
              {s}
            </button>
          ))}
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as "registered" | "roi")}
          className="rounded bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400 ml-auto">
          <option value="registered">Sort: Date</option>
          <option value="roi">Sort: ROI</option>
        </select>
      </div>

      {/* Signal cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map(signal => {
          const hasStats = !!signal.backtestStats;
          const marginalPositive = hasStats && (signal.backtestStats!.marginalROI ?? 0) > 0;

          return (
            <div key={signal.id}
              className={`rounded-lg border bg-zinc-900/50 p-4 space-y-2 ${
                hasStats
                  ? marginalPositive ? "border-green-900/50" : "border-red-900/50"
                  : "border-zinc-800"
              }`}>
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-sm text-zinc-200">{signal.id}</div>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold border ${STATUS_COLORS[signal.status]}`}>
                  {signal.status.toUpperCase()}
                </span>
              </div>

              {/* Hypothesis */}
              <div className="text-xs text-zinc-500 leading-relaxed">{signal.hypothesis}</div>

              {/* Metric/threshold */}
              <div className="text-[10px] text-zinc-600">
                <span className="font-semibold">Metric:</span> {signal.metric}
                {signal.threshold && signal.threshold !== "TBD" && (
                  <span> | <span className="font-semibold">Threshold:</span> {signal.threshold}</span>
                )}
              </div>

              {/* Backtest stats */}
              {hasStats && (
                <div className="rounded bg-zinc-800/50 p-2 space-y-1">
                  <div className="flex gap-4 text-[10px] font-mono">
                    <span className={signal.backtestStats!.standaloneROI >= 0 ? "text-green-400" : "text-red-400"}>
                      ROI: {fmtPct(signal.backtestStats!.standaloneROI)}
                    </span>
                    <span className="text-blue-400">
                      CLV: {fmtPct(signal.backtestStats!.standaloneCLV)}
                    </span>
                    <span className="text-zinc-500">
                      N: {signal.backtestStats!.standaloneN}
                    </span>
                  </div>
                  {signal.backtestStats!.marginalROI != null && (
                    <div className="text-[10px] font-mono">
                      <span className={marginalPositive ? "text-green-400" : "text-red-400"}>
                        Marginal ROI: {fmtPct(signal.backtestStats!.marginalROI)}
                      </span>
                      {signal.backtestStats!.correlationWithBase != null && (
                        <span className="text-zinc-600 ml-3">
                          Corr: {signal.backtestStats!.correlationWithBase.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="text-[10px] text-zinc-600">
                    Tested: {signal.backtestStats!.testedAt}
                  </div>
                </div>
              )}

              {/* Result */}
              {signal.result && (
                <div className="text-[10px] text-zinc-500 leading-relaxed border-t border-zinc-800 pt-1.5">
                  {signal.result}
                </div>
              )}

              {/* Deployed in */}
              {signal.deployedIn && (
                <div className="text-[10px] text-purple-400">
                  Deployed: {signal.deployedIn}
                </div>
              )}

              {/* Registration date */}
              <div className="text-[10px] text-zinc-700">
                Registered: {signal.registered}
              </div>
            </div>
          );
        })}
      </div>

      {sorted.length === 0 && (
        <div className="py-8 text-center text-zinc-600 text-xs">No signals match filter.</div>
      )}
    </div>
  );
}
