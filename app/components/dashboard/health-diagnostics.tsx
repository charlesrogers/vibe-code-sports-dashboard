"use client";

import type { ModelHealthReport } from "@/lib/model-health-monitor";

const LEAGUE_LABELS: Record<string, string> = {
  epl: "EPL", "la-liga": "La Liga", bundesliga: "Bundesliga",
  "serie-a": "Serie A", "serie-b": "Serie B",
};

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function clvColor(v: number): string {
  return v >= 0 ? "text-green-400" : "text-red-400";
}

export default function HealthDiagnostics({ report }: { report: ModelHealthReport }) {
  if (!report.diagnostics) return null;
  if (report.quadrant !== "ORANGE" && report.quadrant !== "RED") return null;

  const { byLeague, byMarket, byOddsBucket, clvTrend, pipelineIssues } = report.diagnostics;

  return (
    <details className="rounded-lg border border-zinc-800 bg-zinc-900/50 mt-4">
      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-zinc-300">
        Diagnostics — drill down
      </summary>
      <div className="px-4 pb-4 space-y-4">
        {/* League CLV */}
        {Object.keys(byLeague).length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-zinc-400 mb-2 uppercase">League CLV</h4>
            <table className="w-full text-xs">
              <thead><tr className="text-zinc-500 border-b border-zinc-800">
                <th className="py-1 text-left">League</th>
                <th className="py-1 text-right">N</th>
                <th className="py-1 text-right">CLV</th>
                <th className="py-1 text-right">ROI</th>
              </tr></thead>
              <tbody>
                {Object.entries(byLeague).map(([lid, s]) => (
                  <tr key={lid} className="border-b border-zinc-800/50">
                    <td className="py-1 text-zinc-300">{LEAGUE_LABELS[lid] || lid}</td>
                    <td className="py-1 text-right text-zinc-400">{s.n}</td>
                    <td className={`py-1 text-right font-mono ${clvColor(s.clv)}`}>{fmtPct(s.clv)}</td>
                    <td className={`py-1 text-right font-mono ${s.roi >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtPct(s.roi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Market CLV */}
        {Object.keys(byMarket).length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-zinc-400 mb-2 uppercase">Market CLV</h4>
            <table className="w-full text-xs">
              <thead><tr className="text-zinc-500 border-b border-zinc-800">
                <th className="py-1 text-left">Market</th>
                <th className="py-1 text-right">N</th>
                <th className="py-1 text-right">CLV</th>
                <th className="py-1 text-right">ROI</th>
              </tr></thead>
              <tbody>
                {Object.entries(byMarket).map(([mt, s]) => (
                  <tr key={mt} className="border-b border-zinc-800/50">
                    <td className="py-1 text-zinc-300">{mt}</td>
                    <td className="py-1 text-right text-zinc-400">{s.n}</td>
                    <td className={`py-1 text-right font-mono ${clvColor(s.clv)}`}>{fmtPct(s.clv)}</td>
                    <td className={`py-1 text-right font-mono ${s.roi >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtPct(s.roi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Odds buckets */}
        {byOddsBucket.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-zinc-400 mb-2 uppercase">Odds Bucket Analysis</h4>
            <table className="w-full text-xs">
              <thead><tr className="text-zinc-500 border-b border-zinc-800">
                <th className="py-1 text-left">Odds Range</th>
                <th className="py-1 text-right">N</th>
                <th className="py-1 text-right">CLV</th>
                <th className="py-1 text-right">ROI</th>
              </tr></thead>
              <tbody>
                {byOddsBucket.map(b => (
                  <tr key={b.label} className="border-b border-zinc-800/50">
                    <td className="py-1 text-zinc-300">{b.label}</td>
                    <td className="py-1 text-right text-zinc-400">{b.n}</td>
                    <td className={`py-1 text-right font-mono ${clvColor(b.clv)}`}>{fmtPct(b.clv)}</td>
                    <td className={`py-1 text-right font-mono ${b.roi >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtPct(b.roi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* CLV trend */}
        <div className="text-xs text-zinc-400">
          <span className="font-semibold uppercase">CLV Trend:</span>{" "}
          {clvTrend.isDecaying ? (
            <span className="text-red-400">Decaying — slope {(clvTrend.slope * 100).toFixed(2)}%/week</span>
          ) : (
            <span className="text-zinc-500">Stable — slope {(clvTrend.slope * 100).toFixed(2)}%/week</span>
          )}
        </div>

        {/* Pipeline issues */}
        {pipelineIssues.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold text-zinc-400 mb-1 uppercase">Recommended Actions</h4>
            <ul className="text-xs text-zinc-500 space-y-1">
              {pipelineIssues.map((issue, i) => (
                <li key={i}>- {issue}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
