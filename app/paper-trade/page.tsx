"use client";

import { useState, useEffect } from "react";

interface PaperBet {
  id: string; createdAt: string; matchDate: string; league: string;
  homeTeam: string; awayTeam: string; marketType: string; selection: string;
  stake: number; modelProb: number; marketOdds: number; edge: number;
  confidenceGrade: "A" | "B" | "C" | null; status: string;
  settledAt?: string; homeGoals?: number; awayGoals?: number;
  profit?: number; closingOdds?: number; clv?: number;
}

interface DailyPnL { date: string; profit: number; cumProfit: number; bets: number; }

interface Stats {
  totalBets: number; settledBets: number; pendingBets: number;
  wins: number; losses: number; pushes: number; hitRate: number;
  totalProfit: number; roi: number; avgEdge: number; avgCLV: number;
  byLeague: Record<string, { n: number; roi: number; clv: number; profit: number }>;
  byGrade: Record<string, { n: number; roi: number; clv: number; profit: number }>;
  dailyPnL: DailyPnL[];
}

const LEAGUE_LABELS: Record<string, string> = {
  epl: "EPL", "la-liga": "La Liga", bundesliga: "Bundesliga", "serie-a": "Serie A",
};

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-yellow-900/30 text-yellow-400 border-yellow-800",
    won: "bg-green-900/30 text-green-400 border-green-800",
    lost: "bg-red-900/30 text-red-400 border-red-800",
    push: "bg-zinc-800 text-zinc-400 border-zinc-700",
  };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold border ${styles[status] || styles.pending}`}>
      {status.toUpperCase()}
    </span>
  );
}

export default function PaperTradePage() {
  const [bets, setBets] = useState<PaperBet[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [logging, setLogging] = useState(false);
  const [settling, setSettling] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/paper-trade");
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBets(data.ledger || []);
      setStats(data.stats || null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const triggerLog = async () => {
    setLogging(true);
    try {
      const res = await fetch("/api/paper-trade/log", { method: "POST" });
      const data = await res.json();
      alert(`Logged ${data.logged || data.added || 0} new bets, skipped ${data.skipped || 0}`);
      await load();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setLogging(false);
    }
  };

  const triggerSettle = async () => {
    setSettling(true);
    try {
      const res = await fetch("/api/paper-trade/settle", { method: "POST" });
      const data = await res.json();
      alert(`Settled ${data.settled || 0} bets`);
      await load();
    } catch (e: any) {
      alert(`Error: ${e.message}`);
    } finally {
      setSettling(false);
    }
  };

  const filtered = statusFilter === "all" ? bets : bets.filter(b => b.status === statusFilter);

  if (loading) return <div className="py-20 text-center text-zinc-500">Loading paper trade ledger...</div>;
  if (error) return <div className="py-20 text-center text-red-400">{error}</div>;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-sm text-zinc-400">
          Paper trading — auto-log MI model picks, track forward P&L and CLV.
        </div>
        <div className="flex gap-2">
          <button onClick={triggerLog} disabled={logging}
            className="rounded bg-blue-900/50 border border-blue-700 px-3 py-1 text-xs text-blue-400 hover:bg-blue-900/70 disabled:opacity-50">
            {logging ? "Logging..." : "Log Picks"}
          </button>
          <button onClick={triggerSettle} disabled={settling}
            className="rounded bg-green-900/50 border border-green-700 px-3 py-1 text-xs text-green-400 hover:bg-green-900/70 disabled:opacity-50">
            {settling ? "Settling..." : "Settle Bets"}
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-white">{stats.totalBets}</div>
            <div className="text-[10px] text-zinc-500 uppercase">Total Bets</div>
            <div className="text-[10px] text-yellow-500">{stats.pendingBets} pending</div>
          </div>
          <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className={`text-2xl font-bold ${stats.roi >= 0 ? "text-green-400" : "text-red-400"}`}>
              {fmtPct(stats.roi)}
            </div>
            <div className="text-[10px] text-zinc-500 uppercase">ROI</div>
          </div>
          <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className={`text-2xl font-bold ${stats.totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
              {stats.totalProfit >= 0 ? "+" : ""}{stats.totalProfit.toFixed(1)}u
            </div>
            <div className="text-[10px] text-zinc-500 uppercase">P&L</div>
          </div>
          <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{fmtPct(stats.avgCLV)}</div>
            <div className="text-[10px] text-zinc-500 uppercase">Avg CLV</div>
          </div>
          <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-white">{(stats.hitRate * 100).toFixed(0)}%</div>
            <div className="text-[10px] text-zinc-500 uppercase">Hit Rate</div>
            <div className="text-[10px] text-zinc-600">{stats.wins}W / {stats.losses}L</div>
          </div>
          <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-white">{fmtPct(stats.avgEdge)}</div>
            <div className="text-[10px] text-zinc-500 uppercase">Avg Edge</div>
          </div>
        </div>
      )}

      {/* P&L Chart (simple ASCII-style for now) */}
      {stats && stats.dailyPnL.length > 0 && (
        <div className="mb-6 rounded bg-zinc-900 border border-zinc-800 p-4">
          <h3 className="mb-2 text-sm font-semibold text-zinc-300">Cumulative P&L</h3>
          <div className="flex items-end gap-px h-32">
            {stats.dailyPnL.map((d, i) => {
              const maxAbs = Math.max(...stats.dailyPnL.map(x => Math.abs(x.cumProfit)), 1);
              const height = Math.abs(d.cumProfit) / maxAbs * 100;
              const isPositive = d.cumProfit >= 0;
              return (
                <div key={i} className="flex-1 flex flex-col justify-end items-center" title={`${d.date}: ${d.cumProfit >= 0 ? "+" : ""}${d.cumProfit.toFixed(1)}u`}>
                  <div
                    className={`w-full rounded-t ${isPositive ? "bg-green-600" : "bg-red-600"}`}
                    style={{ height: `${Math.max(height, 2)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-zinc-600 mt-1">
            <span>{stats.dailyPnL[0]?.date}</span>
            <span>{stats.dailyPnL[stats.dailyPnL.length - 1]?.date}</span>
          </div>
        </div>
      )}

      {/* League breakdown */}
      {stats && Object.keys(stats.byLeague).length > 0 && (
        <div className="mb-6">
          <h3 className="mb-2 text-sm font-semibold text-zinc-300">By League</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {Object.entries(stats.byLeague).map(([lid, s]) => (
              <div key={lid} className="rounded bg-zinc-900 border border-zinc-800 p-3">
                <div className="text-xs text-zinc-500">{LEAGUE_LABELS[lid] || lid}</div>
                <div className={`text-lg font-bold ${s.roi >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {fmtPct(s.roi)}
                </div>
                <div className="text-[10px] text-zinc-600">{s.n} bets | P&L: {s.profit >= 0 ? "+" : ""}{s.profit.toFixed(1)}u</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status filter */}
      <div className="mb-3 flex gap-2">
        {["all", "pending", "won", "lost", "push"].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`rounded px-2 py-1 text-xs border ${
              statusFilter === s
                ? "bg-blue-900/50 text-blue-400 border-blue-700"
                : "bg-zinc-900 text-zinc-500 border-zinc-800"
            }`}>
            {s === "all" ? `All (${bets.length})` : `${s} (${bets.filter(b => b.status === s).length})`}
          </button>
        ))}
      </div>

      {/* Bet table */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-zinc-600">
          {bets.length === 0
            ? "No paper bets yet. Click 'Log Picks' to start tracking."
            : "No bets match filter."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="py-2 text-left">Date</th>
                <th className="py-2 text-left">Match</th>
                <th className="py-2 text-left">League</th>
                <th className="py-2 text-left">Pick</th>
                <th className="py-2 text-right">Odds</th>
                <th className="py-2 text-right">Edge</th>
                <th className="py-2 text-center">Grade</th>
                <th className="py-2 text-center">Status</th>
                <th className="py-2 text-right">P&L</th>
                <th className="py-2 text-right">CLV</th>
              </tr>
            </thead>
            <tbody>
              {filtered.sort((a, b) => b.matchDate.localeCompare(a.matchDate)).map(bet => (
                <tr key={bet.id} className="border-b border-zinc-900 text-zinc-300">
                  <td className="py-1.5">{bet.matchDate}</td>
                  <td className="py-1.5">{bet.homeTeam} vs {bet.awayTeam}</td>
                  <td className="py-1.5">{LEAGUE_LABELS[bet.league] || bet.league}</td>
                  <td className="py-1.5 font-semibold">{bet.selection}</td>
                  <td className="py-1.5 text-right font-mono">{bet.marketOdds.toFixed(2)}</td>
                  <td className="py-1.5 text-right font-mono text-blue-400">{fmtPct(bet.edge * 100)}</td>
                  <td className="py-1.5 text-center">{bet.confidenceGrade || "—"}</td>
                  <td className="py-1.5 text-center"><StatusBadge status={bet.status} /></td>
                  <td className={`py-1.5 text-right font-mono ${
                    bet.profit != null ? (bet.profit >= 0 ? "text-green-400" : "text-red-400") : "text-zinc-600"
                  }`}>
                    {bet.profit != null ? `${bet.profit >= 0 ? "+" : ""}${bet.profit.toFixed(2)}` : "—"}
                  </td>
                  <td className={`py-1.5 text-right font-mono ${
                    bet.clv != null ? (bet.clv >= 0 ? "text-green-400" : "text-red-400") : "text-zinc-600"
                  }`}>
                    {bet.clv != null ? `${bet.clv >= 0 ? "+" : ""}${(bet.clv * 100).toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
