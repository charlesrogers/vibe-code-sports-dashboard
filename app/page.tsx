"use client";

import { useState, useEffect, useCallback } from "react";
import HealthCard from "./components/dashboard/health-card";
import HealthDiagnostics from "./components/dashboard/health-diagnostics";
import BankrollChart from "./components/dashboard/bankroll-chart";
import RollingROI from "./components/dashboard/rolling-roi";
import BetJournal from "./components/dashboard/bet-journal";
import WeeklyDigest from "./components/dashboard/weekly-digest";
import TodayChecklist from "./components/dashboard/today-checklist";
import SignalHealth from "./components/dashboard/signal-health";
import type { ModelHealthReport } from "@/lib/model-health-monitor";

interface DailyPnL {
  date: string;
  profit: number;
  cumProfit: number;
  bets: number;
}

interface Stats {
  totalBets: number;
  settledBets: number;
  pendingBets: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number;
  totalProfit: number;
  roi: number;
  avgEdge: number;
  avgCLV: number;
  dailyPnL: DailyPnL[];
}

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
  kickoffTime?: string;
}

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export default function DashboardPage() {
  const [health, setHealth] = useState<ModelHealthReport | null>(null);
  const [bets, setBets] = useState<PaperBet[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [logging, setLogging] = useState(false);
  const [settling, setSettling] = useState(false);
  const [actionMsg, setActionMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showAction = useCallback((text: string, type: "success" | "error") => {
    setActionMsg({ text, type });
    setTimeout(() => setActionMsg(null), 4000);
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [healthRes, tradeRes] = await Promise.all([
        fetch("/api/model-health"),
        fetch("/api/paper-trade"),
      ]);
      if (!healthRes.ok) throw new Error(`Model health API returned ${healthRes.status}`);
      if (!tradeRes.ok) throw new Error(`Paper trade API returned ${tradeRes.status}`);

      const healthData = await healthRes.json();
      const tradeData = await tradeRes.json();

      if (tradeData.error) throw new Error(tradeData.error);

      setHealth(healthData.error ? null : healthData);
      setBets(tradeData.ledger || []);
      setStats(tradeData.stats || null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Lazy settle: auto-trigger settlement when finished matches exist
  useEffect(() => {
    if (loading || bets.length === 0) return;
    const now = Date.now();
    const threeHours = 3 * 60 * 60 * 1000;
    const needsSettle = bets.some(
      b => b.status === "pending" && b.kickoffTime && (now - new Date(b.kickoffTime).getTime()) > threeHours
    );
    if (needsSettle && !settling) {
      console.log("[dashboard] Auto-settling finished matches...");
      triggerSettle();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, bets]);

  const triggerLog = async () => {
    setLogging(true);
    try {
      const res = await fetch("/api/paper-trade/log", { method: "POST" });
      if (!res.ok) throw new Error(`Log API returned ${res.status}`);
      const data = await res.json();
      showAction(`Logged ${data.logged || data.added || 0} new bets, skipped ${data.skipped || 0}`, "success");
      await loadData();
    } catch (e: unknown) {
      showAction(e instanceof Error ? e.message : "Unknown error", "error");
    } finally {
      setLogging(false);
    }
  };

  const triggerSettle = async () => {
    setSettling(true);
    try {
      const res = await fetch("/api/paper-trade/settle", { method: "POST" });
      if (!res.ok) throw new Error(`Settle API returned ${res.status}`);
      const data = await res.json();
      showAction(`Settled ${data.settled || 0} bets`, "success");
      await loadData();
    } catch (e: unknown) {
      showAction(e instanceof Error ? e.message : "Unknown error", "error");
    } finally {
      setSettling(false);
    }
  };

  if (loading) return <div className="py-20 text-center text-zinc-500">Loading dashboard...</div>;
  if (error) return <div className="py-20 text-center text-red-400">{error}</div>;

  const activeBets = bets.filter(b => b.status !== "superseded");

  return (
    <div className="space-y-6">
      {/* Action feedback toast */}
      {actionMsg && (
        <div className={`rounded-lg border px-4 py-2 text-sm ${actionMsg.type === "success" ? "border-green-800 bg-green-900/30 text-green-400" : "border-red-800 bg-red-900/30 text-red-400"}`}>
          {actionMsg.text}
        </div>
      )}

      {/* Today's checklist — the daily workflow */}
      <TodayChecklist pendingBets={stats?.pendingBets ?? 0} />

      {/* Signal Health — per-signal CLV attribution */}
      <SignalHealth />

      {/* Health Card — the stop/go signal */}
      {health && (
        <div>
          <HealthCard report={health} />
          <HealthDiagnostics report={health} />
        </div>
      )}

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-white">{stats.totalBets}</div>
            <div className="text-[10px] text-zinc-500 uppercase">Total Bets</div>
            <div className="text-[10px] text-yellow-500">{stats.pendingBets} pending</div>
          </div>
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className={`text-2xl font-bold ${stats.roi >= 0 ? "text-green-400" : "text-red-400"}`}>
              {fmtPct(stats.roi)}
            </div>
            <div className="text-[10px] text-zinc-500 uppercase">ROI</div>
          </div>
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className={`text-2xl font-bold ${stats.totalProfit >= 0 ? "text-green-400" : "text-red-400"}`}>
              {stats.totalProfit >= 0 ? "+" : ""}{stats.totalProfit.toFixed(1)}u
            </div>
            <div className="text-[10px] text-zinc-500 uppercase">P&L</div>
          </div>
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-blue-400">{fmtPct(stats.avgCLV)}</div>
            <div className="text-[10px] text-zinc-500 uppercase">Avg CLV</div>
          </div>
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-white">{(stats.hitRate * 100).toFixed(0)}%</div>
            <div className="text-[10px] text-zinc-500 uppercase">Hit Rate</div>
            <div className="text-[10px] text-zinc-600">{stats.wins}W / {stats.losses}L</div>
          </div>
          <div className="rounded-lg bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-white">{fmtPct(stats.avgEdge)}</div>
            <div className="text-[10px] text-zinc-500 uppercase">Avg Edge</div>
          </div>
        </div>
      )}

      {/* Charts row */}
      {stats && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BankrollChart dailyPnL={stats.dailyPnL} />
          <RollingROI bets={activeBets} />
        </div>
      )}

      {/* Weekly digest */}
      <WeeklyDigest bets={activeBets} />

      {/* Bet Journal */}
      <BetJournal
        bets={activeBets}
        onLog={triggerLog}
        onSettle={triggerSettle}
        logging={logging}
        settling={settling}
      />
    </div>
  );
}
