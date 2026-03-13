"use client";

import type { ModelHealthReport } from "@/lib/model-health-monitor";

const QUADRANT_STYLES: Record<string, { bg: string; border: string; dot: string; text: string }> = {
  GREEN:  { bg: "bg-green-900/20",  border: "border-green-800", dot: "bg-green-400", text: "text-green-400" },
  YELLOW: { bg: "bg-yellow-900/20", border: "border-yellow-800", dot: "bg-yellow-400", text: "text-yellow-400" },
  ORANGE: { bg: "bg-orange-900/20", border: "border-orange-800", dot: "bg-orange-400", text: "text-orange-400" },
  RED:    { bg: "bg-red-900/20",    border: "border-red-800",    dot: "bg-red-400",    text: "text-red-400" },
};

const QUADRANT_LABELS: Record<string, string> = {
  GREEN: "Safe to bet",
  YELLOW: "Variance — keep betting",
  ORANGE: "Lucky — reduce stakes",
  RED: "Stop betting",
};

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

export default function HealthCard({ report }: { report: ModelHealthReport }) {
  const style = QUADRANT_STYLES[report.quadrant] || QUADRANT_STYLES.RED;

  return (
    <div className={`rounded-lg border ${style.bg} ${style.border} p-5`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className={`inline-block h-3 w-3 rounded-full ${style.dot}`} />
        <span className={`text-lg font-bold ${style.text}`}>
          {report.quadrant} — {QUADRANT_LABELS[report.quadrant]}
        </span>
      </div>

      {/* CLV line */}
      <div className="text-sm text-zinc-300 space-y-1">
        <div>
          CLV: {fmtPct(report.clv.mean)}{" "}
          <span className="text-zinc-500">
            ({report.clv.n} bets, p={report.clv.pValue < 0.001 ? "<0.001" : report.clv.pValue.toFixed(3)})
          </span>
        </div>
        <div>
          P&L: {report.pnl.actual >= 0 ? "+" : ""}{report.pnl.actual.toFixed(1)}u
          <span className="text-zinc-500 mx-2">|</span>
          Expected: {report.pnl.expected >= 0 ? "+" : ""}{report.pnl.expected.toFixed(1)}u
        </div>
        {report.pnl.expected !== 0 && (
          <div className="text-zinc-500 text-xs">
            Variance gap: {(report.pnl.actual - report.pnl.expected).toFixed(1)}u
            {" "}({report.pnl.shortfallProb > 0.1 ? "normal" : "unusual"}, p={report.pnl.shortfallProb.toFixed(2)})
          </div>
        )}
      </div>

      {/* Red flags */}
      {report.redFlags.length > 0 && (
        <div className="mt-3 space-y-1">
          {report.redFlags.map((flag, i) => (
            <div key={i} className={`text-xs ${
              flag.severity === "critical" ? "text-red-400" :
              flag.severity === "warning" ? "text-yellow-400" :
              "text-zinc-500"
            }`}>
              {flag.severity === "critical" ? "!!" : flag.severity === "warning" ? "!" : "i"}{" "}
              {flag.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
