"use client";

import { useState, useEffect } from "react";

interface ExperimentResult {
  id: string;
  config?: Record<string, unknown>;
  summary?: {
    totalBets?: number;
    roi?: number;
    clv?: number;
    hitRate?: number;
    profit?: number;
  };
  byLeague?: Record<string, {
    n: number;
    roi: number;
    clv?: number;
    hitRate?: number;
    profit?: number;
  }>;
  [key: string]: unknown;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

export default function BacktestViewer() {
  const [experiments, setExperiments] = useState<ExperimentResult[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ExperimentResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/lab/experiments")
      .then(r => r.json())
      .then(data => {
        setExperiments(data.experiments || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    fetch(`/api/lab/experiments/${selected}`)
      .then(r => r.json())
      .then(data => setDetail(data))
      .catch(() => setDetail(null));
  }, [selected]);

  if (loading) return <div className="py-8 text-center text-zinc-500 text-xs">Loading experiments...</div>;

  if (experiments.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="text-zinc-500 text-sm mb-2">No experiment results yet</div>
        <div className="text-zinc-600 text-xs">
          Run a backtest with output flag to create one:
        </div>
        <code className="mt-2 inline-block rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400">
          npx tsx scripts/backtest-eval.ts --ted --output=experiment-name
        </code>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Experiment selector */}
      <div className="flex items-center gap-3">
        <label className="text-xs text-zinc-500">Experiment:</label>
        <select
          value={selected || ""}
          onChange={e => setSelected(e.target.value || null)}
          className="rounded bg-zinc-900 border border-zinc-800 px-3 py-1.5 text-sm text-zinc-300"
        >
          <option value="">Select...</option>
          {experiments.map(exp => (
            <option key={exp.id} value={exp.id}>{exp.id}</option>
          ))}
        </select>
      </div>

      {/* Detail view */}
      {detail && (
        <div className="space-y-4">
          {/* Summary */}
          {detail.summary && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {detail.summary.totalBets != null && (
                <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
                  <div className="text-lg font-bold text-white">{detail.summary.totalBets}</div>
                  <div className="text-[10px] text-zinc-500 uppercase">Bets</div>
                </div>
              )}
              {detail.summary.roi != null && (
                <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
                  <div className={`text-lg font-bold ${detail.summary.roi >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {fmtPct(detail.summary.roi)}
                  </div>
                  <div className="text-[10px] text-zinc-500 uppercase">ROI</div>
                </div>
              )}
              {detail.summary.clv != null && (
                <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
                  <div className={`text-lg font-bold ${detail.summary.clv >= 0 ? "text-blue-400" : "text-red-400"}`}>
                    {fmtPct(detail.summary.clv)}
                  </div>
                  <div className="text-[10px] text-zinc-500 uppercase">CLV</div>
                </div>
              )}
              {detail.summary.hitRate != null && (
                <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
                  <div className="text-lg font-bold text-white">
                    {(detail.summary.hitRate * 100).toFixed(0)}%
                  </div>
                  <div className="text-[10px] text-zinc-500 uppercase">Hit Rate</div>
                </div>
              )}
              {detail.summary.profit != null && (
                <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
                  <div className={`text-lg font-bold ${detail.summary.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {detail.summary.profit >= 0 ? "+" : ""}{detail.summary.profit.toFixed(1)}u
                  </div>
                  <div className="text-[10px] text-zinc-500 uppercase">Profit</div>
                </div>
              )}
            </div>
          )}

          {/* Config */}
          {detail.config && (
            <details className="rounded border border-zinc-800 bg-zinc-900/50">
              <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-zinc-400">Config</summary>
              <pre className="px-4 pb-3 text-[10px] text-zinc-500 overflow-x-auto">
                {JSON.stringify(detail.config, null, 2)}
              </pre>
            </details>
          )}

          {/* Per-league breakdown */}
          {detail.byLeague && Object.keys(detail.byLeague).length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-zinc-400 mb-2 uppercase">By League</h4>
              <table className="w-full text-xs">
                <thead><tr className="text-zinc-500 border-b border-zinc-800">
                  <th className="py-1 text-left">League</th>
                  <th className="py-1 text-right">N</th>
                  <th className="py-1 text-right">ROI</th>
                  <th className="py-1 text-right">CLV</th>
                  <th className="py-1 text-right">Hit Rate</th>
                  <th className="py-1 text-right">Profit</th>
                </tr></thead>
                <tbody>
                  {Object.entries(detail.byLeague).map(([league, s]) => (
                    <tr key={league} className="border-b border-zinc-800/50">
                      <td className="py-1 text-zinc-300">{league}</td>
                      <td className="py-1 text-right text-zinc-400">{s.n}</td>
                      <td className={`py-1 text-right font-mono ${s.roi >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {fmtPct(s.roi)}
                      </td>
                      <td className={`py-1 text-right font-mono ${(s.clv || 0) >= 0 ? "text-blue-400" : "text-red-400"}`}>
                        {s.clv != null ? fmtPct(s.clv) : "—"}
                      </td>
                      <td className="py-1 text-right font-mono text-zinc-400">
                        {s.hitRate != null ? `${(s.hitRate * 100).toFixed(0)}%` : "—"}
                      </td>
                      <td className={`py-1 text-right font-mono ${(s.profit || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {s.profit != null ? `${s.profit >= 0 ? "+" : ""}${s.profit.toFixed(1)}u` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Raw data fallback for unknown shapes */}
          {!detail.summary && !detail.byLeague && (
            <details className="rounded border border-zinc-800 bg-zinc-900/50" open>
              <summary className="cursor-pointer px-4 py-2 text-xs font-semibold text-zinc-400">Raw Results</summary>
              <pre className="px-4 pb-3 text-[10px] text-zinc-500 overflow-x-auto max-h-96">
                {JSON.stringify(detail, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
