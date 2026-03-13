"use client";

import { useState, useMemo } from "react";

interface PaperBet {
  id: string;
  createdAt: string;
  matchDate: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  marketType: string;
  selection: string;
  stake: number;
  modelProb: number;
  marketOdds: number;
  executionOdds: number;
  edge: number;
  confidenceGrade: "A" | "B" | "C" | null;
  status: string;
  profit?: number;
  clv?: number;
  bestBook?: string;
  bestBookOdds?: number;
}

const LEAGUE_LABELS: Record<string, string> = {
  epl: "EPL", "la-liga": "La Liga", bundesliga: "Bundesliga",
  "serie-a": "Serie A", "serie-b": "Serie B",
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

interface BetJournalProps {
  bets: PaperBet[];
  onLog: () => void;
  onSettle: () => void;
  logging: boolean;
  settling: boolean;
}

export default function BetJournal({ bets, onLog, onSettle, logging, settling }: BetJournalProps) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [leagueFilter, setLeagueFilter] = useState("all");
  const [marketFilter, setMarketFilter] = useState("all");
  const [gradeFilter, setGradeFilter] = useState("all");

  const leagues = useMemo(() => [...new Set(bets.map(b => b.league))].sort(), [bets]);
  const markets = useMemo(() => [...new Set(bets.map(b => b.marketType))].sort(), [bets]);

  const filtered = useMemo(() => {
    return bets.filter(b => {
      if (statusFilter !== "all" && b.status !== statusFilter) return false;
      if (leagueFilter !== "all" && b.league !== leagueFilter) return false;
      if (marketFilter !== "all" && b.marketType !== marketFilter) return false;
      if (gradeFilter !== "all" && (b.confidenceGrade || "none") !== gradeFilter) return false;
      return true;
    });
  }, [bets, statusFilter, leagueFilter, marketFilter, gradeFilter]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-300">Bet Journal</h3>
        <div className="flex gap-2">
          <button onClick={onLog} disabled={logging}
            className="rounded bg-blue-900/50 border border-blue-700 px-3 py-1 text-xs text-blue-400 hover:bg-blue-900/70 disabled:opacity-50">
            {logging ? "Logging..." : "Log Picks"}
          </button>
          <button onClick={onSettle} disabled={settling}
            className="rounded bg-green-900/50 border border-green-700 px-3 py-1 text-xs text-green-400 hover:bg-green-900/70 disabled:opacity-50">
            {settling ? "Settling..." : "Settle Bets"}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 border-b border-zinc-800 px-4 py-2">
        {/* Status */}
        <div className="flex gap-1">
          {["all", "pending", "won", "lost", "push"].map(s => (
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
        {/* League */}
        <select value={leagueFilter} onChange={e => setLeagueFilter(e.target.value)}
          className="rounded bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
          <option value="all">All leagues</option>
          {leagues.map(l => <option key={l} value={l}>{LEAGUE_LABELS[l] || l}</option>)}
        </select>
        {/* Market */}
        <select value={marketFilter} onChange={e => setMarketFilter(e.target.value)}
          className="rounded bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
          <option value="all">All markets</option>
          {markets.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        {/* Grade */}
        <select value={gradeFilter} onChange={e => setGradeFilter(e.target.value)}
          className="rounded bg-zinc-900 border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-400">
          <option value="all">All grades</option>
          {["A", "B", "C", "none"].map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <span className="text-[10px] text-zinc-600 self-center ml-auto">{filtered.length} bets</span>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="py-8 text-center text-zinc-600 text-xs">
          {bets.length === 0 ? "No paper bets yet. Click 'Log Picks' to start tracking." : "No bets match filters."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-left">Match</th>
                <th className="px-3 py-2 text-left">Pick</th>
                <th className="px-3 py-2 text-right">Odds</th>
                <th className="px-3 py-2 text-right">Edge</th>
                <th className="px-3 py-2 text-center">Grade</th>
                <th className="px-3 py-2 text-center">Status</th>
                <th className="px-3 py-2 text-right">P&L</th>
                <th className="px-3 py-2 text-right">CLV</th>
              </tr>
            </thead>
            <tbody>
              {filtered.sort((a, b) => b.matchDate.localeCompare(a.matchDate)).map(bet => (
                <tr key={bet.id} className="border-b border-zinc-900/50 text-zinc-300 hover:bg-zinc-800/30">
                  <td className="px-3 py-1.5 text-zinc-500">{bet.matchDate}</td>
                  <td className="px-3 py-1.5">
                    {bet.homeTeam} vs {bet.awayTeam}
                    <span className="ml-1 text-[10px] text-zinc-600">{LEAGUE_LABELS[bet.league] || bet.league}</span>
                  </td>
                  <td className="px-3 py-1.5 font-semibold">{bet.marketType} {bet.selection}</td>
                  <td className="px-3 py-1.5 text-right font-mono">{bet.marketOdds.toFixed(2)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-blue-400">{fmtPct(bet.edge * 100)}</td>
                  <td className="px-3 py-1.5 text-center">{bet.confidenceGrade || "—"}</td>
                  <td className="px-3 py-1.5 text-center"><StatusBadge status={bet.status} /></td>
                  <td className={`px-3 py-1.5 text-right font-mono ${
                    bet.profit != null ? (bet.profit >= 0 ? "text-green-400" : "text-red-400") : "text-zinc-600"
                  }`}>
                    {bet.profit != null ? `${bet.profit >= 0 ? "+" : ""}${bet.profit.toFixed(2)}` : "—"}
                  </td>
                  <td className={`px-3 py-1.5 text-right font-mono ${
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
