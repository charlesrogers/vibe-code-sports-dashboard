"use client";

import { useState, useEffect, useCallback } from "react";
import ExperimentBoard from "../components/lab/experiment-board";
import BacktestViewer from "../components/lab/backtest-viewer";
import SignalExplorer from "../components/lab/signal-explorer";

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

type Tab = "experiments" | "results" | "signals";

export default function LabPage() {
  const [tab, setTab] = useState<Tab>("experiments");
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSignals = useCallback(async () => {
    try {
      const res = await fetch("/api/lab/signals");
      const data = await res.json();
      setSignals(data.signals || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadSignals(); }, [loadSignals]);

  const tabs: { key: Tab; label: string }[] = [
    { key: "experiments", label: "Experiments" },
    { key: "results", label: "Results" },
    { key: "signals", label: "Signals" },
  ];

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-zinc-200">Lab</h2>
        <p className="text-xs text-zinc-500">Find edges, test hypotheses, track signal performance.</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-800 mb-4">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-blue-500 text-white"
                : "border-transparent text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-12 text-center text-zinc-500 text-sm">Loading...</div>
      ) : (
        <>
          {tab === "experiments" && (
            <ExperimentBoard signals={signals} onRefresh={loadSignals} />
          )}
          {tab === "results" && (
            <BacktestViewer />
          )}
          {tab === "signals" && (
            <SignalExplorer signals={signals} />
          )}
        </>
      )}
    </div>
  );
}
