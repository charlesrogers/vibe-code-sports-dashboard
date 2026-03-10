"use client";

import { useEffect, useState, useCallback } from "react";

interface CalibrationBucket {
  bucket: string;
  predicted: number;
  actual: number;
  count: number;
}

interface ModelScore {
  logLoss: number;
  brier: number;
  accuracy: number;
  calibration: CalibrationBucket[];
}

interface TedGrade {
  grade: string;
  bets: number;
  wins: number;
  hitRate: number;
}

interface TedScore {
  directionalAccuracy: number;
  betHitRate: number;
  totalSignals: number;
  totalBets: number;
  byGrade: TedGrade[];
}

interface MatchEval {
  date: string;
  round?: number;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  actualResult: "H" | "D" | "A";
  dixonColes: { home: number; draw: number; away: number };
  elo: { home: number; draw: number; away: number };
  bayesian: { home: number; draw: number; away: number };
  composite: { home: number; draw: number; away: number };
  ted: { edgeSide: string; hasBet: boolean; grade: string | null; confidence: number } | null;
  dcCorrect: boolean;
  eloCorrect: boolean;
  bayesCorrect: boolean;
  compositeCorrect: boolean;
  tedCorrect: boolean | null;
}

interface RankEntry {
  model: string;
  logLoss: number;
  brier: number;
  accuracy: number;
}

interface TedOverlayEntry {
  model: string;
  base: { logLoss: number; brier: number; accuracy: number };
  withTed: { logLoss: number; brier: number; accuracy: number };
  delta: { logLoss: number; brier: number; accuracy: number };
}

interface SeasonBreakdown {
  season: string;
  matches: number;
  logLoss: number;
  brier: number;
  accuracy: number;
}

interface EvalResponse {
  league: string;
  season: string;
  matchesEvaluated: number;
  xgSource: string;
  models: {
    dixonColes: ModelScore;
    elo: ModelScore;
    bayesian: ModelScore;
    composite: ModelScore;
    market?: ModelScore;
  };
  ted: TedScore;
  ranking: RankEntry[];
  gameLog: MatchEval[];
  methodology: {
    approach: string;
    training: string;
    compositeWeights: string;
    tedNote: string;
    metrics: Record<string, string>;
    sampleSizeWarning: string;
  };
  tedOverlay?: TedOverlayEntry[];
  seasonBreakdown?: SeasonBreakdown[];
  clv?: Record<string, { avgCLV: number; matchesWithOdds: number }>;
}

type Tab = "scorecard" | "calibration" | "gamelog" | "methodology";
type ProbModelKey = "dixonColes" | "elo" | "bayesian" | "composite" | "market";

const MODEL_LABELS: Record<ProbModelKey, string> = {
  composite: "Composite",
  dixonColes: "Dixon-Coles",
  bayesian: "Bayesian Poisson",
  elo: "ELO",
  market: "Market (Closing Line)",
};

const MODEL_DESCRIPTIONS: Record<ProbModelKey, string> = {
  dixonColes: "Poisson-based structural model — attack/defense ratings with time decay and tau correction for low scores",
  elo: "Form & momentum — K=32 with goal-difference multiplier and 65-point home advantage",
  bayesian: "Mack's log-linear Poisson with Gamma-Poisson shrinkage — pulls extreme ratings toward the mean to prevent overfitting",
  composite: "Weighted blend of DC (50%) + Bayesian (25%) + ELO (25%)",
  market: "Devigged Pinnacle closing odds — the benchmark all models must beat",
};

function pct(n: number): string {
  return n.toFixed(1) + "%";
}

function MetricCard({ label, value, sublabel, best }: { label: string; value: string; sublabel: string; best?: boolean }) {
  return (
    <div className={`rounded border p-3 text-center ${best ? "border-green-700 bg-green-950/30" : "border-zinc-800 bg-zinc-900"}`}>
      <div className={`text-xl font-bold font-mono ${best ? "text-green-400" : "text-white"}`}>{value}</div>
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="text-[10px] text-zinc-600 mt-1">{sublabel}</div>
    </div>
  );
}

function TedOverlayTable({ overlay }: { overlay: TedOverlayEntry[] }) {
  return (
    <div className="mb-6 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Ted Overlay Comparison</h3>
      <p className="text-xs text-zinc-500 mb-3">
        How each model&apos;s metrics change when Ted variance signals are applied as an overlay.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="py-2 text-left">Model</th>
              <th className="py-2 text-right">Base LL</th>
              <th className="py-2 text-right">+Ted LL</th>
              <th className="py-2 text-right">Delta</th>
              <th className="py-2 text-right">Base Brier</th>
              <th className="py-2 text-right">+Ted Brier</th>
              <th className="py-2 text-right">Delta</th>
            </tr>
          </thead>
          <tbody>
            {overlay.map((entry) => (
              <tr key={entry.model} className="border-b border-zinc-800/30">
                <td className="py-1.5 font-medium text-zinc-300">{entry.model}</td>
                <td className="py-1.5 text-right font-mono text-zinc-400">{entry.base.logLoss.toFixed(3)}</td>
                <td className="py-1.5 text-right font-mono text-zinc-300">{entry.withTed.logLoss.toFixed(3)}</td>
                <td className={`py-1.5 text-right font-mono font-semibold ${entry.delta.logLoss < 0 ? "text-green-400" : entry.delta.logLoss > 0 ? "text-red-400" : "text-zinc-500"}`}>
                  {entry.delta.logLoss > 0 ? "+" : ""}{entry.delta.logLoss.toFixed(3)}
                </td>
                <td className="py-1.5 text-right font-mono text-zinc-400">{entry.base.brier.toFixed(4)}</td>
                <td className="py-1.5 text-right font-mono text-zinc-300">{entry.withTed.brier.toFixed(4)}</td>
                <td className={`py-1.5 text-right font-mono font-semibold ${entry.delta.brier < 0 ? "text-green-400" : entry.delta.brier > 0 ? "text-red-400" : "text-zinc-500"}`}>
                  {entry.delta.brier > 0 ? "+" : ""}{entry.delta.brier.toFixed(4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClvSection({ clv }: { clv: Record<string, { avgCLV: number; matchesWithOdds: number }> }) {
  return (
    <div className="mb-6 border border-zinc-800 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-zinc-400 mb-2 uppercase tracking-wide">CLV — Closing Line Value</h3>
      <p className="text-xs text-zinc-500 mb-3">
        Average edge vs closing market odds. Positive CLV = model finds real edges the market prices out by close.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(clv).map(([model, entry]) => {
          const v = entry.avgCLV;
          return (
            <div key={model} className={`rounded border p-3 text-center ${v > 0 ? "border-green-700 bg-green-950/30" : v < 0 ? "border-red-700 bg-red-950/30" : "border-zinc-800 bg-zinc-900"}`}>
              <div className={`text-xl font-bold font-mono ${v > 0 ? "text-green-400" : v < 0 ? "text-red-400" : "text-zinc-400"}`}>
                {v > 0 ? "+" : ""}{(v * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-zinc-400">{model}</div>
              <div className="text-[10px] text-zinc-600">{entry.matchesWithOdds} matches</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScorecardTab({ data }: { data: EvalResponse }) {
  const coreModels: ProbModelKey[] = ["composite", "dixonColes", "bayesian", "elo"];
  const models: ProbModelKey[] = data.models.market
    ? [...coreModels, "market"]
    : coreModels;
  const bestLL = Math.min(...models.map((m) => data.models[m]!.logLoss));
  const bestBrier = Math.min(...models.map((m) => data.models[m]!.brier));
  const bestAcc = Math.max(...models.map((m) => data.models[m]!.accuracy));

  return (
    <div>
      {/* Probability Model Ranking */}
      <div className="mb-6">
        <h3 className="text-sm font-semibold text-zinc-400 mb-2 uppercase tracking-wide">Probability Models — ranked by Log Loss (Mack&apos;s #1)</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
              <th className="py-2 text-left">#</th>
              <th className="py-2 text-left">Model</th>
              <th className="py-2 text-right">Log Loss</th>
              <th className="py-2 text-right">Brier</th>
              <th className="py-2 text-right">Accuracy</th>
              <th className="py-2 text-right">Matches</th>
            </tr>
          </thead>
          <tbody>
            {data.ranking.map((r, i) => (
              <tr key={r.model} className={`border-b border-zinc-800/50 ${i === 0 ? "bg-green-950/20" : ""}`}>
                <td className="py-2 text-zinc-500">{i + 1}</td>
                <td className="py-2 font-medium">{r.model} {i === 0 && <span className="text-green-500 text-xs ml-1">BEST</span>}</td>
                <td className={`py-2 text-right font-mono ${r.logLoss === bestLL ? "text-green-400" : ""}`}>{r.logLoss.toFixed(3)}</td>
                <td className={`py-2 text-right font-mono ${r.brier === bestBrier ? "text-green-400" : ""}`}>{r.brier.toFixed(4)}</td>
                <td className={`py-2 text-right font-mono ${r.accuracy === bestAcc ? "text-green-400" : ""}`}>{pct(r.accuracy)}</td>
                <td className="py-2 text-right text-zinc-500">{data.matchesEvaluated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ted Overlay Comparison Table */}
      {data.tedOverlay && data.tedOverlay.length > 0 && (
        <TedOverlayTable overlay={data.tedOverlay} />
      )}

      {/* Ted Variance — separate section since it's directional, not 1X2 */}
      <div className="mb-6 border border-zinc-800 rounded-lg p-4">
        <h3 className="font-semibold mb-1">Ted Variance (Directional Model)</h3>
        <p className="text-xs text-zinc-500 mb-3">
          Ted doesn&apos;t produce full 1X2 probabilities — it identifies which side regression favors.
          Scored on directional accuracy, not Log Loss.
          {data.xgSource === "unavailable" && (
            <span className="text-red-400 ml-1">(xG data unavailable — Ted could not run)</span>
          )}
        </p>
        {data.ted.totalSignals > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <MetricCard
              label="Directional Acc"
              value={pct(data.ted.directionalAccuracy)}
              sublabel={`${data.ted.totalSignals} signals`}
            />
            <MetricCard
              label="Bet Hit Rate"
              value={pct(data.ted.betHitRate)}
              sublabel={`${data.ted.totalBets} bets`}
            />
            {data.ted.byGrade.map((g) => (
              <MetricCard
                key={g.grade}
                label={`Grade ${g.grade}`}
                value={pct(g.hitRate)}
                sublabel={`${g.wins}/${g.bets} bets`}
                best={g.hitRate >= 50}
              />
            ))}
          </div>
        ) : (
          <div className="text-sm text-zinc-500">No Ted signals available — xG data required from Understat</div>
        )}
      </div>

      {/* CLV Summary */}
      {data.clv && Object.keys(data.clv).length > 0 && (
        <ClvSection clv={data.clv} />
      )}

      {/* Per-Model Detail Cards */}
      <div className="space-y-4">
        {models.map((key) => {
          const s = data.models[key];
          if (!s) return null;
          return (
            <div key={key} className="border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">{MODEL_LABELS[key]}</h3>
                {data.ranking[0].model === MODEL_LABELS[key] && (
                  <span className="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded">Top Model</span>
                )}
              </div>
              <p className="text-xs text-zinc-500 mb-3">{MODEL_DESCRIPTIONS[key]}</p>
              <div className="grid grid-cols-3 gap-3">
                <MetricCard label="Log Loss" value={s.logLoss.toFixed(3)} sublabel="lower = better" best={s.logLoss === bestLL} />
                <MetricCard label="Brier Score" value={s.brier.toFixed(4)} sublabel="lower = better calibration" best={s.brier === bestBrier} />
                <MetricCard label="Accuracy" value={pct(s.accuracy)} sublabel="classification rate" best={s.accuracy === bestAcc} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalibrationTab({ data }: { data: EvalResponse }) {
  const availableModels: ProbModelKey[] = data.models.market
    ? ["composite", "dixonColes", "bayesian", "elo", "market"]
    : ["composite", "dixonColes", "bayesian", "elo"];
  const [selectedModel, setSelectedModel] = useState<ProbModelKey>("composite");
  const modelData = data.models[selectedModel];
  const cal = modelData?.calibration;

  if (!cal) {
    return (
      <div className="text-sm text-zinc-500">No calibration data available for {MODEL_LABELS[selectedModel]}.</div>
    );
  }

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap">
        {availableModels.map((key) => (
          <button
            key={key}
            onClick={() => setSelectedModel(key)}
            className={`px-3 py-1 text-sm rounded ${selectedModel === key ? "bg-blue-900 text-blue-300" : "bg-zinc-900 text-zinc-500"}`}
          >
            {MODEL_LABELS[key]}
          </button>
        ))}
      </div>

      <p className="text-xs text-zinc-500 mb-3">
        Perfect calibration = predicted % equals actual %. Gap shows miscalibration.
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
            <th className="py-2 text-left">Bucket</th>
            <th className="py-2 text-right">Predicted</th>
            <th className="py-2 text-right">Actual</th>
            <th className="py-2 text-right">Gap</th>
            <th className="py-2 text-right">n</th>
            <th className="py-2 text-left pl-3">Visual</th>
          </tr>
        </thead>
        <tbody>
          {cal.map((b) => {
            const gap = Math.abs(b.predicted - b.actual);
            const gapColor = gap < 3 ? "text-green-400" : gap < 8 ? "text-yellow-400" : "text-red-400";
            return (
              <tr key={b.bucket} className="border-b border-zinc-800/50">
                <td className="py-1.5 text-zinc-400">{b.bucket}</td>
                <td className="py-1.5 text-right font-mono">{b.predicted.toFixed(1)}%</td>
                <td className="py-1.5 text-right font-mono">{b.actual.toFixed(1)}%</td>
                <td className={`py-1.5 text-right font-mono ${gapColor}`}>{gap.toFixed(1)}%</td>
                <td className="py-1.5 text-right text-zinc-500">{b.count}</td>
                <td className="py-1.5 pl-3">
                  <div className="flex items-center gap-1 h-3">
                    <div className="bg-blue-700 h-full rounded-sm" style={{ width: `${Math.min(b.predicted, 100)}px` }} title="Predicted" />
                    <div className="bg-green-600 h-full rounded-sm" style={{ width: `${Math.min(b.actual, 100)}px` }} title="Actual" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="flex gap-4 text-xs text-zinc-600 mt-2">
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-blue-700 rounded-sm inline-block" /> Predicted</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-green-600 rounded-sm inline-block" /> Actual</span>
      </div>
    </div>
  );
}

function GameLogTab({ data }: { data: EvalResponse }) {
  const [roundFilter, setRoundFilter] = useState<number | "all">("all");
  const rounds = [...new Set(data.gameLog.map((m) => m.round).filter((r): r is number => r != null))].sort((a, b) => a - b);

  let filtered = data.gameLog;
  if (roundFilter !== "all") {
    filtered = filtered.filter((m) => m.round === roundFilter);
  }
  filtered = [...filtered].reverse();

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <select
          value={roundFilter}
          onChange={(e) => setRoundFilter(e.target.value === "all" ? "all" : Number(e.target.value))}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
        >
          <option value="all">All Rounds ({data.gameLog.length})</option>
          {rounds.map((r) => (
            <option key={r} value={r}>Round {r}</option>
          ))}
        </select>
        <span className="text-xs text-zinc-500">Green = model predicted correctly</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="py-2 text-left">R</th>
              <th className="py-2 text-left">Match</th>
              <th className="py-2 text-center">Score</th>
              <th className="py-2 text-center" colSpan={3}>DC</th>
              <th className="py-2 text-center" colSpan={3}>ELO</th>
              <th className="py-2 text-center" colSpan={3}>Bayes</th>
              <th className="py-2 text-center" colSpan={3}>Comp</th>
              <th className="py-2 text-center">Ted</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const resultColors = { H: "text-blue-400", D: "text-zinc-400", A: "text-red-400" };
              const tedIcon = m.ted
                ? m.ted.edgeSide === "neutral" ? "—"
                  : m.tedCorrect ? "✓" : "✗"
                : "—";
              const tedColor = m.ted && m.ted.edgeSide !== "neutral"
                ? m.tedCorrect ? "text-green-400" : "text-red-400"
                : "text-zinc-600";

              return (
                <tr key={`${m.date}-${m.homeTeam}-${m.awayTeam}`} className="border-b border-zinc-800/30 hover:bg-zinc-900/50">
                  <td className="py-1.5 text-zinc-600">{m.round || "—"}</td>
                  <td className="py-1.5">
                    <span className="text-zinc-300">{m.homeTeam}</span>
                    <span className="text-zinc-600 mx-1">v</span>
                    <span className="text-zinc-300">{m.awayTeam}</span>
                  </td>
                  <td className={`py-1.5 text-center font-mono font-bold ${resultColors[m.actualResult]}`}>
                    {m.homeGoals}-{m.awayGoals}
                  </td>
                  {/* DC */}
                  {renderModelCells(m.dixonColes, m.dcCorrect, m.actualResult)}
                  {/* ELO */}
                  {renderModelCells(m.elo, m.eloCorrect, m.actualResult)}
                  {/* Bayesian */}
                  {renderModelCells(m.bayesian, m.bayesCorrect, m.actualResult)}
                  {/* Composite */}
                  {renderModelCells(m.composite, m.compositeCorrect, m.actualResult)}
                  {/* Ted */}
                  <td className={`py-1.5 text-center font-mono ${tedColor}`}>
                    {tedIcon}
                    {m.ted?.grade && <span className="text-[10px] ml-0.5">{m.ted.grade}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderModelCells(
  probs: { home: number; draw: number; away: number },
  correct: boolean,
  actual: "H" | "D" | "A"
) {
  const bg = correct ? "bg-green-950/40" : "";
  return (
    <>
      <td className={`py-1.5 text-center font-mono ${bg} ${actual === "H" ? "font-bold" : ""}`}>
        {(probs.home * 100).toFixed(0)}
      </td>
      <td className={`py-1.5 text-center font-mono ${bg} ${actual === "D" ? "font-bold" : ""}`}>
        {(probs.draw * 100).toFixed(0)}
      </td>
      <td className={`py-1.5 text-center font-mono ${bg} ${actual === "A" ? "font-bold" : ""}`}>
        {(probs.away * 100).toFixed(0)}
      </td>
    </>
  );
}

function SeasonBreakdownTable({ breakdown }: { breakdown: SeasonBreakdown[] }) {
  return (
    <div className="border border-zinc-800 rounded-lg p-4">
      <h3 className="font-semibold mb-2">Season-by-Season Breakdown</h3>
      <p className="text-xs text-zinc-500 mb-3">Performance across individual seasons in the multi-season evaluation.</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
            <th className="py-2 text-left">Season</th>
            <th className="py-2 text-right">Matches</th>
            <th className="py-2 text-right">Log Loss</th>
            <th className="py-2 text-right">Brier</th>
            <th className="py-2 text-right">Accuracy</th>
          </tr>
        </thead>
        <tbody>
          {breakdown.map((s) => (
            <tr key={s.season} className="border-b border-zinc-800/50">
              <td className="py-1.5 text-zinc-300 font-medium">{s.season}</td>
              <td className="py-1.5 text-right text-zinc-500">{s.matches}</td>
              <td className="py-1.5 text-right font-mono">{s.logLoss.toFixed(3)}</td>
              <td className="py-1.5 text-right font-mono">{s.brier.toFixed(4)}</td>
              <td className="py-1.5 text-right font-mono">{pct(s.accuracy)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MethodologyTab({ data }: { data: EvalResponse }) {
  return (
    <div className="space-y-4 text-sm text-zinc-300">
      <div className="border border-zinc-800 rounded-lg p-4">
        <h3 className="font-semibold mb-2">Testing Approach</h3>
        <p className="text-zinc-400 mb-3">
          {data.methodology.approach} — {data.methodology.training}
        </p>
        <ul className="space-y-2 text-zinc-400">
          <li><strong className="text-white">Holdout test:</strong> Train on all seasons before {data.season}, test on {data.season} completed matches. No data leakage.</li>
          <li><strong className="text-white">Composite:</strong> {data.methodology.compositeWeights}</li>
          <li><strong className="text-white">Ted Variance:</strong> {data.methodology.tedNote}</li>
          <li><strong className="text-white">xG Source:</strong> {data.xgSource}</li>
        </ul>
      </div>

      <div className="border border-zinc-800 rounded-lg p-4">
        <h3 className="font-semibold mb-2">Metrics (Mack&apos;s Hierarchy)</h3>
        <ol className="space-y-3 text-zinc-400">
          {Object.entries(data.methodology.metrics).map(([key, desc], i) => (
            <li key={key}>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${i === 0 ? "bg-green-900 text-green-300" : i === 1 ? "bg-yellow-900 text-yellow-300" : "bg-zinc-700 text-zinc-300"}`}>#{i + 1}</span>
                <strong className="text-white capitalize">{key.replace(/([A-Z])/g, " $1")}</strong>
              </div>
              <p className="ml-8 mt-1">{desc}</p>
            </li>
          ))}
        </ol>
      </div>

      <div className="border border-yellow-900/50 rounded-lg p-4 bg-yellow-950/10">
        <h3 className="font-semibold mb-2 text-yellow-400">Sample Size Warning</h3>
        <p className="text-zinc-400">{data.methodology.sampleSizeWarning}</p>
      </div>

      <div className="border border-zinc-800 rounded-lg p-4">
        <h3 className="font-semibold mb-2">Models Under Test</h3>
        <div className="space-y-2">
          {(Object.keys(MODEL_LABELS) as ProbModelKey[])
            .filter((key) => key !== "market" || data.models.market)
            .map((key) => (
              <div key={key}>
                <strong className="text-white">{MODEL_LABELS[key]}:</strong>{" "}
                <span className="text-zinc-400">{MODEL_DESCRIPTIONS[key]}</span>
              </div>
            ))}
          <div>
            <strong className="text-white">Ted Variance:</strong>{" "}
            <span className="text-zinc-400">xG regression signal — identifies which side variance favors based on Knutson&apos;s methodology. Conviction grades: A (3+ factors), B (2), C (1).</span>
          </div>
        </div>
      </div>

      {/* Season Breakdown — shown when multi-season data is available */}
      {data.seasonBreakdown && data.seasonBreakdown.length > 0 && (
        <SeasonBreakdownTable breakdown={data.seasonBreakdown} />
      )}
    </div>
  );
}

const SEASON_OPTIONS = [
  { value: "2025-26", label: "2025-26" },
  { value: "2024-25", label: "2024-25" },
  { value: "2023-24", label: "2023-24" },
  { value: "multi", label: "Multi-Season (2023-26)" },
];

export default function ModelsPage() {
  const [data, setData] = useState<EvalResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("scorecard");
  const [season, setSeason] = useState("2025-26");

  const fetchData = useCallback(async (selectedSeason: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/model-eval?league=serieA&season=${selectedSeason}`);
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

  useEffect(() => { fetchData(season); }, [fetchData, season]);

  const handleSeasonChange = (newSeason: string) => {
    setSeason(newSeason);
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-zinc-500">
        <div className="animate-pulse">Evaluating all models (DC + ELO + Bayesian + Ted)...</div>
        <div className="text-xs mt-2">Fitting models, fetching xG data from Understat, scoring predictions</div>
      </div>
    );
  }

  if (error) return <div className="p-8 text-center text-red-500">Error: {error}</div>;
  if (!data) return null;

  const tabs: { key: Tab; label: string }[] = [
    { key: "scorecard", label: "Scorecard" },
    { key: "calibration", label: "Calibration" },
    { key: "gamelog", label: `Game Log (${data.matchesEvaluated})` },
    { key: "methodology", label: "Methodology" },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold">Model Evaluation</h1>
          <select
            value={season}
            onChange={(e) => handleSeasonChange(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-3 py-1.5 text-sm font-medium"
          >
            {SEASON_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <p className="text-sm text-zinc-500">
          {data.models.market ? "6" : "5"} models tested out-of-sample on {data.matchesEvaluated} matches | {data.season} | xG: {data.xgSource}
        </p>
      </div>

      {/* Quick summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold">{data.matchesEvaluated}</div>
          <div className="text-xs text-zinc-500">Matches</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold text-green-400 font-mono">{data.ranking[0].logLoss.toFixed(3)}</div>
          <div className="text-xs text-zinc-500">Best Log Loss</div>
          <div className="text-[10px] text-zinc-600">{data.ranking[0].model}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold font-mono">{data.ranking[0].brier.toFixed(4)}</div>
          <div className="text-xs text-zinc-500">Best Brier</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold font-mono">{pct(data.ranking[0].accuracy)}</div>
          <div className="text-xs text-zinc-500">Best Accuracy</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
          <div className="text-2xl font-bold font-mono text-yellow-400">
            {data.ted.totalBets > 0 ? pct(data.ted.betHitRate) : "—"}
          </div>
          <div className="text-xs text-zinc-500">Ted Bet Hit%</div>
          <div className="text-[10px] text-zinc-600">{data.ted.totalBets} bets</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-zinc-800 mb-6 overflow-x-auto">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? "border-b-2 border-blue-500 text-white" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "scorecard" && <ScorecardTab data={data} />}
      {tab === "calibration" && <CalibrationTab data={data} />}
      {tab === "gamelog" && <GameLogTab data={data} />}
      {tab === "methodology" && <MethodologyTab data={data} />}
    </div>
  );
}
