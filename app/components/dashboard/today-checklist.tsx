"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface TodayData {
  picks: { total: number; matches: number } | null;
  dataHealth: { healthy: number; total: number; critical: string | null } | null;
  loading: boolean;
}

export default function TodayChecklist({ pendingBets }: { pendingBets: number }) {
  const [data, setData] = useState<TodayData>({ picks: null, dataHealth: null, loading: true });

  useEffect(() => {
    async function load() {
      const [picksData, healthData] = await Promise.all([
        fetch("/api/mi-picks").then(async r => {
          if (!r.ok) return null;
          const d = await r.json();
          if (d.error) return null;
          const picks = d.picks || [];
          const matches = new Set(picks.map((p: { matchId: string }) => p.matchId)).size;
          return { total: picks.filter((p: { tedVerdict: string }) => p.tedVerdict === "BET").length, matches };
        }).catch(() => null),
        fetch("/api/data-sources").then(async r => {
          if (!r.ok) return null;
          const d = await r.json();
          const sources = d.sources || [];
          const healthy = sources.filter((s: { status: string }) => s.status === "healthy").length;
          return { healthy, total: sources.length, critical: d.criticalMessage || null };
        }).catch(() => null),
      ]);
      setData({ picks: picksData, dataHealth: healthData, loading: false });
    }
    load();
  }, []);

  if (data.loading) return null;

  const healthColor = data.dataHealth?.critical
    ? "text-red-400"
    : data.dataHealth && data.dataHealth.healthy < data.dataHealth.total
      ? "text-yellow-400"
      : "text-green-400";

  const healthDot = data.dataHealth?.critical
    ? "bg-red-400"
    : data.dataHealth && data.dataHealth.healthy < data.dataHealth.total
      ? "bg-yellow-400"
      : "bg-green-400";

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {/* Picks to review */}
      <Link href="/picks" className="group rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 hover:border-zinc-700 transition-colors">
        <div className="flex items-center gap-2 mb-1">
          <div className="h-2 w-2 rounded-full bg-blue-400" />
          <span className="text-[10px] text-zinc-500 uppercase font-semibold">Picks Today</span>
        </div>
        {data.picks ? (
          data.picks.total > 0 ? (
            <div className="text-sm text-zinc-300">
              <span className="text-lg font-bold text-blue-400">{data.picks.total}</span> value bets across {data.picks.matches} matches
            </div>
          ) : (
            <div className="text-sm text-zinc-500">No matches with value today</div>
          )
        ) : (
          <div className="text-sm text-zinc-500">Could not load picks</div>
        )}
      </Link>

      {/* Pending bets */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
        <div className="flex items-center gap-2 mb-1">
          <div className={`h-2 w-2 rounded-full ${pendingBets > 0 ? "bg-yellow-400" : "bg-green-400"}`} />
          <span className="text-[10px] text-zinc-500 uppercase font-semibold">Open Bets</span>
        </div>
        {pendingBets > 0 ? (
          <div className="text-sm text-zinc-300">
            <span className="text-lg font-bold text-yellow-400">{pendingBets}</span> pending settlement
          </div>
        ) : (
          <div className="text-sm text-zinc-500">All bets settled</div>
        )}
      </div>

      {/* Data health */}
      <Link href="/data" className="group rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 hover:border-zinc-700 transition-colors">
        <div className="flex items-center gap-2 mb-1">
          <div className={`h-2 w-2 rounded-full ${healthDot}`} />
          <span className="text-[10px] text-zinc-500 uppercase font-semibold">Data Health</span>
        </div>
        {data.dataHealth ? (
          data.dataHealth.critical ? (
            <div className={`text-sm ${healthColor}`}>{data.dataHealth.critical}</div>
          ) : (
            <div className={`text-sm ${healthColor}`}>
              {data.dataHealth.healthy}/{data.dataHealth.total} sources healthy
            </div>
          )
        ) : (
          <div className="text-sm text-zinc-500">Could not check</div>
        )}
      </Link>
    </div>
  );
}
