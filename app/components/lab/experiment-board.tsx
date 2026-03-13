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

interface ExperimentBoardProps {
  signals: Signal[];
  onRefresh: () => void;
}

const COLUMNS = [
  { key: "pending", label: "Backlog", color: "border-zinc-700" },
  { key: "testing", label: "Testing", color: "border-blue-700" },
  { key: "accepted", label: "Evaluated", color: "border-green-700" },
  { key: "deployed", label: "Deployed", color: "border-purple-700" },
  { key: "rejected", label: "Rejected", color: "border-red-700" },
] as const;

function SignalCard({ signal, onMove }: { signal: Signal; onMove: (id: string, status: string) => void }) {
  const hasStats = !!signal.backtestStats;
  const isDeployed = signal.status === "accepted" && !!signal.deployedIn;

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-3 text-xs space-y-1.5">
      <div className="font-semibold text-zinc-200">{signal.id}</div>
      <div className="text-zinc-500 leading-tight">{signal.hypothesis}</div>
      {hasStats && (
        <div className="flex gap-3 text-[10px] font-mono">
          <span className={signal.backtestStats!.standaloneROI >= 0 ? "text-green-400" : "text-red-400"}>
            ROI: {(signal.backtestStats!.standaloneROI * 100).toFixed(1)}%
          </span>
          <span className="text-blue-400">
            CLV: {(signal.backtestStats!.standaloneCLV * 100).toFixed(1)}%
          </span>
          <span className="text-zinc-500">
            n={signal.backtestStats!.standaloneN}
          </span>
        </div>
      )}
      {signal.result && (
        <div className="text-zinc-500 text-[10px] leading-tight">{signal.result}</div>
      )}
      {/* Move actions */}
      <div className="flex gap-1 pt-1">
        {signal.status === "pending" && (
          <button onClick={() => onMove(signal.id, "testing")}
            className="rounded bg-blue-900/30 border border-blue-800 px-2 py-0.5 text-[10px] text-blue-400 hover:bg-blue-900/50">
            Start Testing
          </button>
        )}
        {signal.status === "testing" && (
          <>
            <button onClick={() => onMove(signal.id, "accepted")}
              className="rounded bg-green-900/30 border border-green-800 px-2 py-0.5 text-[10px] text-green-400 hover:bg-green-900/50">
              Accept
            </button>
            <button onClick={() => onMove(signal.id, "rejected")}
              className="rounded bg-red-900/30 border border-red-800 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-900/50">
              Reject
            </button>
          </>
        )}
        {signal.status === "accepted" && !isDeployed && (
          <button onClick={() => onMove(signal.id, "graveyard")}
            className="rounded bg-zinc-800 border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-700">
            Retire
          </button>
        )}
      </div>
    </div>
  );
}

export default function ExperimentBoard({ signals, onRefresh }: ExperimentBoardProps) {
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formHypothesis, setFormHypothesis] = useState("");
  const [formMetric, setFormMetric] = useState("");
  const [formThreshold, setFormThreshold] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const moveSignal = async (id: string, status: string) => {
    await fetch("/api/lab/experiments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    onRefresh();
  };

  const addExperiment = async () => {
    if (!formName || !formHypothesis) return;
    setSubmitting(true);
    await fetch("/api/lab/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: formName,
        hypothesis: formHypothesis,
        metric: formMetric,
        threshold: formThreshold,
      }),
    });
    setFormName(""); setFormHypothesis(""); setFormMetric(""); setFormThreshold("");
    setShowForm(false);
    setSubmitting(false);
    onRefresh();
  };

  // Bucket signals into columns
  const buckets: Record<string, Signal[]> = {
    pending: [], testing: [], accepted: [], deployed: [], rejected: [],
  };
  for (const s of signals) {
    if (s.status === "accepted" && s.deployedIn) {
      buckets.deployed.push(s);
    } else if (s.status === "graveyard" || s.status === "rejected") {
      buckets.rejected.push(s);
    } else {
      buckets[s.status]?.push(s);
    }
  }

  return (
    <div>
      {/* Add button */}
      <div className="mb-4 flex justify-end">
        <button onClick={() => setShowForm(!showForm)}
          className="rounded bg-blue-900/50 border border-blue-700 px-3 py-1 text-xs text-blue-400 hover:bg-blue-900/70">
          {showForm ? "Cancel" : "+ Add Experiment"}
        </button>
      </div>

      {/* Add form */}
      {showForm && (
        <div className="mb-4 rounded border border-zinc-800 bg-zinc-900 p-4 space-y-2">
          <input value={formName} onChange={e => setFormName(e.target.value)}
            placeholder="Signal name (e.g., gk-regression-adj)"
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-white placeholder-zinc-600" />
          <textarea value={formHypothesis} onChange={e => setFormHypothesis(e.target.value)}
            placeholder="Hypothesis — what do you expect to happen and why?"
            rows={2}
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-white placeholder-zinc-600" />
          <div className="flex gap-2">
            <input value={formMetric} onChange={e => setFormMetric(e.target.value)}
              placeholder="Success metric (e.g., ROI delta)"
              className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-white placeholder-zinc-600" />
            <input value={formThreshold} onChange={e => setFormThreshold(e.target.value)}
              placeholder="Threshold (e.g., +1pp ROI)"
              className="flex-1 rounded bg-zinc-800 border border-zinc-700 px-3 py-1.5 text-sm text-white placeholder-zinc-600" />
          </div>
          <button onClick={addExperiment} disabled={submitting || !formName || !formHypothesis}
            className="rounded bg-green-900/50 border border-green-700 px-4 py-1.5 text-xs text-green-400 hover:bg-green-900/70 disabled:opacity-50">
            {submitting ? "Creating..." : "Register Hypothesis"}
          </button>
        </div>
      )}

      {/* Kanban columns */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {COLUMNS.map(col => (
          <div key={col.key} className={`rounded border-t-2 ${col.color} bg-zinc-900/30 p-2`}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-400">{col.label}</span>
              <span className="text-[10px] text-zinc-600">{buckets[col.key]?.length || 0}</span>
            </div>
            <div className="space-y-2">
              {(buckets[col.key] || []).map(s => (
                <SignalCard key={s.id} signal={s} onMove={moveSignal} />
              ))}
              {(buckets[col.key]?.length || 0) === 0 && (
                <div className="py-4 text-center text-[10px] text-zinc-700">Empty</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
