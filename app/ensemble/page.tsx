"use client";

import { useEffect, useState, useCallback } from "react";

interface ModelOutput {
  home: number;
  draw: number;
  away: number;
  [key: string]: unknown;
}

interface TedVariance {
  edge: number;
  edgeSide: "home" | "away" | "neutral";
  hasBet: boolean;
  betGrade: "A" | "B" | "C" | null;
  confidence: number;
  positiveFactors: string[];
  passReasons: string[];
}

interface Prediction {
  matchId: string;
  date: string;
  round?: number;
  homeTeam: string;
  awayTeam: string;
  models: {
    dixonColes: ModelOutput & { expHome: number; expAway: number };
    elo: ModelOutput & { homeRating: number; awayRating: number };
    market?: ModelOutput;
    tedVariance: TedVariance;
  };
  ensemble: {
    home: number;
    draw: number;
    away: number;
    over25: number;
    under25: number;
    bttsYes: number;
    predictedScore: { home: number; away: number };
  };
  tedOverlay: {
    approved: boolean;
    grade: "A" | "B" | "C" | null;
    reasoning: string;
  };
}

interface ModelVersionSummary {
  hash: string;
  label: string;
  timestamp: string;
  matchCount: number;
  brierScore: number | null;
  accuracy: number | null;
  tedApprovalRate: number;
  avgEdge: number | null;
}

interface EnsembleResponse {
  league: string;
  modelVersion: { hash: string; label: string; timestamp: string };
  xgSource: string;
  usingVenueSplits: boolean;
  predictions: Prediction[];
  modelComparison: { versions: ModelVersionSummary[] };
  summary: {
    fixturesPredicted: number;
    tedApproved: number;
    gradeA: number;
    gradeB: number;
    gradeC: number;
    modelVersions: number;
  };
}

function pct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

function GradeBadge({ grade }: { grade: "A" | "B" | "C" | null }) {
  if (!grade) return null;
  const colors = {
    A: "bg-green-900 text-green-300 border-green-700",
    B: "bg-yellow-900 text-yellow-300 border-yellow-700",
    C: "bg-orange-900 text-orange-300 border-orange-700",
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-bold rounded border ${colors[grade]}`}>
      Grade {grade}
    </span>
  );
}

function ModelBar({ label, home, draw, away }: { label: string; home: number; draw: number; away: number }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-zinc-500 text-right">{label}</span>
      <div className="flex-1 flex h-4 rounded overflow-hidden">
        <div className="bg-blue-700" style={{ width: `${home * 100}%` }} title={`H: ${pct(home)}`} />
        <div className="bg-zinc-600" style={{ width: `${draw * 100}%` }} title={`D: ${pct(draw)}`} />
        <div className="bg-red-700" style={{ width: `${away * 100}%` }} title={`A: ${pct(away)}`} />
      </div>
      <div className="flex gap-1 text-zinc-400 w-36">
        <span className="text-blue-400">{pct(home)}</span>
        <span>/</span>
        <span>{pct(draw)}</span>
        <span>/</span>
        <span className="text-red-400">{pct(away)}</span>
      </div>
    </div>
  );
}

function PredictionCard({ p }: { p: Prediction }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`border rounded-lg p-4 ${p.tedOverlay.approved ? "border-green-800 bg-green-950/20" : "border-zinc-800 bg-zinc-900/50"}`}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">{p.homeTeam}</span>
            <span className="text-zinc-500">vs</span>
            <span className="font-semibold">{p.awayTeam}</span>
            {p.round && <span className="text-xs text-zinc-600">R{p.round}</span>}
          </div>
          <div className="text-xs text-zinc-500">{p.date}</div>
        </div>
        <div className="flex items-center gap-2">
          {p.tedOverlay.approved && <GradeBadge grade={p.tedOverlay.grade} />}
          {p.tedOverlay.approved && (
            <span className="text-xs text-green-500 font-medium">TED BET</span>
          )}
        </div>
      </div>

      {/* Ensemble prediction */}
      <div className="mb-3">
        <ModelBar label="Ensemble" home={p.ensemble.home} draw={p.ensemble.draw} away={p.ensemble.away} />
      </div>

      {/* Predicted score + key markets */}
      <div className="flex gap-4 text-xs text-zinc-400 mb-3">
        <span>Score: {p.ensemble.predictedScore.home} - {p.ensemble.predictedScore.away}</span>
        <span>O2.5: {pct(p.ensemble.over25)}</span>
        <span>BTTS: {pct(p.ensemble.bttsYes)}</span>
      </div>

      {/* Expand for individual models */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-zinc-500 hover:text-zinc-300"
      >
        {expanded ? "Hide" : "Show"} individual models
      </button>

      {expanded && (
        <div className="mt-3 space-y-1">
          <ModelBar label="DC" home={p.models.dixonColes.home} draw={p.models.dixonColes.draw} away={p.models.dixonColes.away} />
          <ModelBar label="ELO" home={p.models.elo.home} draw={p.models.elo.draw} away={p.models.elo.away} />
          {p.models.market && (
            <ModelBar label="Market" home={p.models.market.home} draw={p.models.market.draw} away={p.models.market.away} />
          )}
          <div className="mt-2 text-xs text-zinc-500">
            <div>ELO: {p.models.elo.homeRating} vs {p.models.elo.awayRating}</div>
            <div>xG: {p.models.dixonColes.expHome} - {p.models.dixonColes.expAway}</div>
            <div>
              Ted: {p.models.tedVariance.edgeSide !== "neutral"
                ? `${pct(Math.abs(p.models.tedVariance.edge))} edge → ${p.models.tedVariance.edgeSide}`
                : "neutral"}
              {p.models.tedVariance.confidence > 0 && ` (${pct(p.models.tedVariance.confidence)} conf)`}
            </div>
          </div>
          {p.tedOverlay.approved && p.models.tedVariance.positiveFactors.length > 0 && (
            <div className="mt-2 text-xs">
              <div className="text-green-500 font-medium mb-1">Positive factors:</div>
              <ul className="list-disc list-inside text-zinc-400 space-y-0.5">
                {p.models.tedVariance.positiveFactors.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}
          {!p.tedOverlay.approved && p.models.tedVariance.passReasons.length > 0 && (
            <div className="mt-2 text-xs">
              <div className="text-red-500 font-medium mb-1">Pass reasons:</div>
              <ul className="list-disc list-inside text-zinc-400 space-y-0.5">
                {p.models.tedVariance.passReasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EnsemblePage() {
  const [data, setData] = useState<EnsembleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "ted-only">("all");
  const [selectedRound, setSelectedRound] = useState<number | "all">("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ensemble?league=serieA");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="p-8 text-center text-zinc-500">
        Running ensemble predictions across all models...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-red-500">
        Error: {error}
      </div>
    );
  }

  if (!data) return null;

  const rounds = [...new Set(data.predictions.map((p) => p.round).filter((r): r is number => r !== undefined && r !== null))].sort((a, b) => a - b);

  let filtered = data.predictions;
  if (filter === "ted-only") {
    filtered = filtered.filter((p) => p.tedOverlay.approved);
  }
  if (selectedRound !== "all") {
    filtered = filtered.filter((p) => p.round === selectedRound);
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-1">Ensemble Predictions</h1>
        <p className="text-sm text-zinc-500">
          4 models: Dixon-Coles + ELO + Market + Ted Variance | Version: {data.modelVersion.label}
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold">{data.summary.fixturesPredicted}</div>
          <div className="text-xs text-zinc-500">Fixtures</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold text-green-400">{data.summary.tedApproved}</div>
          <div className="text-xs text-zinc-500">Ted Bets</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold text-green-500">{data.summary.gradeA}</div>
          <div className="text-xs text-zinc-500">Grade A</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold text-yellow-500">{data.summary.gradeB}</div>
          <div className="text-xs text-zinc-500">Grade B</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold text-orange-500">{data.summary.gradeC}</div>
          <div className="text-xs text-zinc-500">Grade C</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold text-blue-400">{data.summary.modelVersions}</div>
          <div className="text-xs text-zinc-500">Versions</div>
        </div>
      </div>

      {/* Model info */}
      <div className="bg-zinc-900 border border-zinc-800 rounded p-3 mb-6 flex flex-wrap gap-4 text-xs text-zinc-400">
        <span>xG Source: <span className="text-white">{data.xgSource}</span></span>
        <span>Venue Splits: <span className={data.usingVenueSplits ? "text-green-400" : "text-red-400"}>{data.usingVenueSplits ? "Yes" : "No"}</span></span>
        <span>Version: <span className="text-white font-mono">{data.modelVersion.hash}</span></span>
      </div>

      {/* Model Version History */}
      {data.modelComparison.versions.length > 1 && (
        <div className="mb-6">
          <h2 className="text-lg font-semibold mb-2">Model Version History</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-zinc-800">
              <thead>
                <tr className="bg-zinc-900 text-zinc-400 text-xs">
                  <th className="p-2 text-left">Version</th>
                  <th className="p-2 text-right">Matches</th>
                  <th className="p-2 text-right">Brier</th>
                  <th className="p-2 text-right">Accuracy</th>
                  <th className="p-2 text-right">Ted %</th>
                  <th className="p-2 text-right">Avg Edge</th>
                  <th className="p-2 text-left">When</th>
                </tr>
              </thead>
              <tbody>
                {data.modelComparison.versions.map((v) => (
                  <tr key={v.hash} className={`border-t border-zinc-800 ${v.hash === data.modelVersion.hash ? "bg-blue-950/30" : ""}`}>
                    <td className="p-2 font-mono text-xs">{v.label}</td>
                    <td className="p-2 text-right">{v.matchCount}</td>
                    <td className="p-2 text-right">{v.brierScore !== null ? v.brierScore.toFixed(4) : "—"}</td>
                    <td className="p-2 text-right">{v.accuracy !== null ? v.accuracy + "%" : "—"}</td>
                    <td className="p-2 text-right">{v.tedApprovalRate}%</td>
                    <td className="p-2 text-right">{v.avgEdge !== null ? v.avgEdge + "%" : "—"}</td>
                    <td className="p-2 text-xs text-zinc-500">{new Date(v.timestamp).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="flex gap-1">
          <button
            onClick={() => setFilter("all")}
            className={`px-3 py-1 text-sm rounded ${filter === "all" ? "bg-zinc-700" : "bg-zinc-900 text-zinc-500"}`}
          >
            All ({data.predictions.length})
          </button>
          <button
            onClick={() => setFilter("ted-only")}
            className={`px-3 py-1 text-sm rounded ${filter === "ted-only" ? "bg-green-900 text-green-300" : "bg-zinc-900 text-zinc-500"}`}
          >
            Ted Bets ({data.summary.tedApproved})
          </button>
        </div>
        <select
          value={selectedRound}
          onChange={(e) => setSelectedRound(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
        >
          <option value="all">All Rounds</option>
          {rounds.map((r) => (
            <option key={r} value={r}>Round {r}</option>
          ))}
        </select>
      </div>

      {/* Predictions */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center text-zinc-500 py-8">
            No predictions match the current filter.
          </div>
        ) : (
          filtered.map((p) => <PredictionCard key={p.matchId} p={p} />)
        )}
      </div>
    </div>
  );
}
