"use client";

import { useEffect, useState, useCallback } from "react";

interface DataSourceStatus {
  name: string;
  status: "healthy" | "stale" | "broken" | "missing";
  lastUpdated: string | null;
  detail: string;
  critical: boolean;
  usedBy: string[];
}

interface DataSourcesResponse {
  sources: DataSourceStatus[];
  hasCriticalIssue: boolean;
  criticalMessage: string | null;
}

function relativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "just now";

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const statusColor: Record<string, string> = {
  healthy: "bg-green-500",
  stale: "bg-yellow-500",
  broken: "bg-red-500",
  missing: "bg-red-500",
};

const statusTextColor: Record<string, string> = {
  healthy: "text-green-400",
  stale: "text-yellow-400",
  broken: "text-red-400",
  missing: "text-red-400",
};

export default function DataSourcesPage() {
  const [data, setData] = useState<DataSourcesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/data-sources");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: DataSourcesResponse = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 60000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const healthyCount = data?.sources.filter((s) => s.status === "healthy").length ?? 0;
  const issueCount = data ? data.sources.length - healthyCount : 0;

  return (
    <div className="space-y-6">
      {/* Critical banner */}
      {data?.hasCriticalIssue && (
        <div className="rounded-lg border border-red-500/50 bg-red-950/50 px-4 py-3 text-red-200">
          <span className="font-semibold">WARNING: CRITICAL:</span>{" "}
          {data.criticalMessage} — Models using this data source cannot be trusted.
        </div>
      )}

      {/* Header with summary and refresh */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Data Sources</h2>
          {data && (
            <p className="mt-1 text-sm text-zinc-400">
              {data.sources.length} sources checked —{" "}
              <span className="text-green-400">{healthyCount} healthy</span>
              {issueCount > 0 && (
                <>
                  {" / "}
                  <span className="text-red-400">{issueCount} issues</span>
                </>
              )}
            </p>
          )}
        </div>
        <button
          onClick={fetchStatus}
          disabled={loading}
          className="rounded-md bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700 disabled:opacity-50"
        >
          {loading ? "Checking..." : "Refresh"}
        </button>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-950/30 px-4 py-3 text-red-300 text-sm">
          Failed to load data source status: {error}
        </div>
      )}

      {/* Cron Health */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
        <h3 className="mb-3 text-sm font-semibold text-zinc-300">Vercel Crons</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { path: "/api/cron-odds", label: "Collect Odds", schedule: "9:00 UTC" },
            { path: "/api/paper-trade/log", label: "Log Bets", schedule: "12:00 UTC" },
            { path: "/api/paper-trade/settle", label: "Settle Bets", schedule: "7:00 UTC" },
            { path: "/api/cron/accumulate-xg", label: "Accumulate xG", schedule: "8:00 UTC" },
          ].map(cron => (
            <div key={cron.path} className="rounded border border-zinc-800 bg-zinc-950 p-3">
              <div className="text-xs font-semibold text-zinc-300">{cron.label}</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">{cron.schedule} daily</div>
              <div className="text-[10px] text-zinc-600 mt-0.5 font-mono truncate">{cron.path}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Source cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {data?.sources.map((source) => (
          <div
            key={source.name}
            className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${statusColor[source.status]}`}
                />
                <h3 className="font-semibold text-white">{source.name}</h3>
              </div>
              <div className="flex items-center gap-2">
                {source.critical && (
                  <span className="rounded bg-red-900/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400">
                    Critical
                  </span>
                )}
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium capitalize ${statusTextColor[source.status]} bg-zinc-800`}
                >
                  {source.status}
                </span>
              </div>
            </div>

            <p className="mt-2 text-sm text-zinc-400">{source.detail}</p>

            {source.lastUpdated && (
              <p className="mt-1 text-xs text-zinc-500">
                Last updated: {relativeTime(source.lastUpdated)}
              </p>
            )}

            {source.usedBy.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {source.usedBy.map((feature) => (
                  <span
                    key={feature}
                    className="rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400"
                  >
                    {feature}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900"
            />
          ))}
        </div>
      )}
    </div>
  );
}
