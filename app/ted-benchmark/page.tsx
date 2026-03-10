"use client";

import { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GradeResult {
  grade: string;
  bets: number;
  wins: number;
  losses: number;
  draws: number;
  hitRate: number;
  roi: number | null;
}

interface GapEntry {
  metric: string;
  ours: number;
  teds: number;
  gap: number;
  interpretation: string;
}

interface TedBenchmarkRef {
  league: string;
  seasons: string;
  source: string;
  gradeA: { bets: number; hitRate: number; roi: number } | null;
  gradeB: { bets: number; hitRate: number; roi: number } | null;
  overall: { bets: number; hitRate: number; roi: number } | null;
  notes: string;
}

interface DeltaEntry {
  metric: string;
  v1: number;
  v2: number;
  delta: number;
  improved: boolean;
}

interface ModelVersionSummary {
  label: string;
  description: string;
  totalBets: number;
  betHitRate: number;
  drawsOnBets: number;
  byGrade: GradeResult[];
  homePicks: { total: number; wins: number; hitRate: number };
  awayPicks: { total: number; wins: number; hitRate: number };
}

interface BenchmarkData {
  league: string;
  leagueLabel: string;
  season: string;
  totalMatches: number;
  matchesWithXg: number;
  xgSource: string;
  ourResults: {
    totalSignals: number;
    totalBets: number;
    directionalAccuracy: number;
    betHitRate: number;
    byGrade: GradeResult[];
    homePicks: { total: number; wins: number; hitRate: number };
    awayPicks: { total: number; wins: number; hitRate: number };
  };
  modelComparison?: {
    v1: ModelVersionSummary;
    v2: ModelVersionSummary;
    deltas: DeltaEntry[];
  };
  tedBenchmark: TedBenchmarkRef | null;
  gaps: GapEntry[];
  xgQualityNote: string;
}

interface SavedVersion {
  version: string;
  league: string;
  season: string;
  savedAt: string;
  results: {
    totalBets: number;
    betHitRate: number;
    drawsOnBets: number;
    byGrade: GradeResult[];
    homePicks: { total: number; wins: number; hitRate: number };
    awayPicks: { total: number; wins: number; hitRate: number };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pct(n: number): string {
  return n.toFixed(1) + "%";
}

function GapColor({ gap }: { gap: number }) {
  const color = gap > 2 ? "text-green-400" : gap < -2 ? "text-red-400" : "text-yellow-400";
  const prefix = gap > 0 ? "+" : "";
  return <span className={`font-mono font-bold ${color}`}>{prefix}{gap.toFixed(1)}%</span>;
}

// ---------------------------------------------------------------------------
// Line chart component (pure SVG, no dependencies)
// ---------------------------------------------------------------------------

interface LinePoint {
  label: string;
  value: number;
}

interface LineSeriesData {
  points: LinePoint[];
  color: string;
  label: string;
}

function MetricsLineChart({ series, title, yLabel, tedLine }: {
  series: LineSeriesData[];
  title: string;
  yLabel: string;
  tedLine?: number;
}) {
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  if (tedLine !== undefined) allValues.push(tedLine);
  const maxVal = Math.max(...allValues, 1) * 1.1;
  const minVal = Math.min(...allValues.filter((v) => v > 0), tedLine ?? Infinity) * 0.8;
  const range = maxVal - minVal;

  const chartH = 200;
  const chartW = 400;
  const padL = 50;
  const padR = 20;
  const padT = 15;
  const padB = 50;

  // X positions based on number of points in first series
  const numPoints = series[0]?.points.length ?? 0;
  const xStep = numPoints > 1 ? chartW / (numPoints - 1) : chartW;

  function yPos(v: number): number {
    return padT + chartH - ((v - minVal) / range) * chartH;
  }

  // Y grid lines
  const gridSteps = 4;
  const gridValues: number[] = [];
  for (let i = 0; i <= gridSteps; i++) {
    gridValues.push(minVal + (range / gridSteps) * i);
  }

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <div className="overflow-x-auto">
        <svg
          width={padL + chartW + padR}
          height={chartH + padT + padB}
          className="text-zinc-400"
        >
          {/* Y axis grid + labels */}
          {gridValues.map((v, i) => {
            const y = yPos(v);
            return (
              <g key={i}>
                <line x1={padL} y1={y} x2={padL + chartW} y2={y} stroke="#333" strokeWidth={1} />
                <text x={padL - 5} y={y + 4} textAnchor="end" fontSize={10} fill="#777">
                  {v.toFixed(1)}{yLabel === "%" ? "%" : ""}
                </text>
              </g>
            );
          })}

          {/* Ted benchmark line */}
          {tedLine !== undefined && (
            <>
              <line
                x1={padL}
                y1={yPos(tedLine)}
                x2={padL + chartW}
                y2={yPos(tedLine)}
                stroke="#3b82f6"
                strokeWidth={2}
                strokeDasharray="6,4"
              />
              <text
                x={padL + chartW - 2}
                y={yPos(tedLine) - 5}
                textAnchor="end"
                fontSize={10}
                fill="#3b82f6"
                fontWeight="bold"
              >
                Ted {tedLine}%
              </text>
            </>
          )}

          {/* Lines + dots */}
          {series.map((s, si) => {
            const pathParts = s.points.map((p, pi) => {
              const x = padL + pi * xStep;
              const y = yPos(p.value);
              return `${pi === 0 ? "M" : "L"} ${x} ${y}`;
            });
            return (
              <g key={si}>
                <path
                  d={pathParts.join(" ")}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                />
                {s.points.map((p, pi) => {
                  const x = padL + pi * xStep;
                  const y = yPos(p.value);
                  return (
                    <g key={pi}>
                      <circle cx={x} cy={y} r={4} fill={s.color} />
                      <text
                        x={x}
                        y={y - 8}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#ccc"
                        fontWeight="bold"
                      >
                        {p.value.toFixed(1)}%
                      </text>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {/* X axis labels */}
          {(series[0]?.points ?? []).map((p, pi) => (
            <text
              key={pi}
              x={padL + pi * xStep}
              y={padT + chartH + 18}
              textAnchor="middle"
              fontSize={11}
              fill="#aaa"
            >
              {p.label}
            </text>
          ))}

          {/* Legend */}
          {series.map((s, i) => (
            <g key={i}>
              <line
                x1={padL + i * 90}
                y1={padT + chartH + 38}
                x2={padL + i * 90 + 16}
                y2={padT + chartH + 38}
                stroke={s.color}
                strokeWidth={2.5}
              />
              <text x={padL + i * 90 + 20} y={padT + chartH + 42} fontSize={10} fill="#999">{s.label}</text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version detail panel
// ---------------------------------------------------------------------------

function VersionDetailPanel({ version, label }: { version: SavedVersion; label: string }) {
  const r = version.results;
  return (
    <div className="border border-zinc-800 rounded-lg p-3">
      <div className="flex justify-between items-baseline mb-2">
        <h4 className="font-semibold text-sm">{label}</h4>
        <span className="text-[10px] text-zinc-600">{new Date(version.savedAt).toLocaleDateString()}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs mb-2">
        <div className="text-center">
          <div className="text-lg font-bold font-mono">{r.totalBets}</div>
          <div className="text-zinc-500">Bets</div>
        </div>
        <div className="text-center">
          <div className={`text-lg font-bold font-mono ${r.betHitRate >= 48 ? "text-green-400" : r.betHitRate >= 42 ? "text-yellow-400" : "text-red-400"}`}>
            {pct(r.betHitRate)}
          </div>
          <div className="text-zinc-500">Hit Rate</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold font-mono text-orange-400">{r.drawsOnBets}</div>
          <div className="text-zinc-500">Draws</div>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-zinc-800 text-zinc-500">
            <th className="py-1 text-left">Grade</th>
            <th className="py-1 text-right">Bets</th>
            <th className="py-1 text-right">Hit%</th>
            <th className="py-1 text-right">ROI</th>
          </tr>
        </thead>
        <tbody>
          {r.byGrade.map((g) => (
            <tr key={g.grade} className="border-b border-zinc-800/30">
              <td className="py-1">{g.grade}</td>
              <td className="py-1 text-right text-zinc-400">{g.bets}</td>
              <td className={`py-1 text-right font-mono font-bold ${g.hitRate >= 50 ? "text-green-400" : "text-red-400"}`}>
                {pct(g.hitRate)}
              </td>
              <td className={`py-1 text-right font-mono ${g.roi !== null && g.roi > 0 ? "text-green-400" : "text-red-400"}`}>
                {g.roi !== null ? `${g.roi > 0 ? "+" : ""}${g.roi}%` : "--"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex gap-3 text-[10px] text-zinc-500">
        <span>Home: {r.homePicks.wins}/{r.homePicks.total} ({pct(r.homePicks.hitRate)})</span>
        <span>Away: {r.awayPicks.wins}/{r.awayPicks.total} ({pct(r.awayPicks.hitRate)})</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function TedBenchmarkPage() {
  const [data, setData] = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [league, setLeague] = useState("epl");
  const [season, setSeason] = useState("2024-25");
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("all");

  const fetchData = useCallback(async (l: string, s: string) => {
    setLoading(true);
    setError(null);
    try {
      const [benchRes, versionsRes] = await Promise.all([
        fetch(`/api/ted-benchmark?league=${l}&season=${s}`),
        fetch(`/api/ted-benchmark/versions?league=${l}&season=${s}`),
      ]);
      if (!benchRes.ok) {
        const err = await benchRes.json();
        throw new Error(err.error || `HTTP ${benchRes.status}`);
      }
      setData(await benchRes.json());
      if (versionsRes.ok) {
        const v = await versionsRes.json();
        setVersions(v.versions || []);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(league, season); }, [fetchData, league, season]);

  // Build line chart data from versions
  const hitRateSeries: LineSeriesData[] = [];
  const gradeASeries: LineSeriesData[] = [];
  const gradeBSeries: LineSeriesData[] = [];

  if (versions.length >= 2) {
    // Sort versions for chronological line progression
    const sorted = [...versions].sort((a, b) => a.version.localeCompare(b.version));

    // Overall hit rate line
    hitRateSeries.push({
      label: "Hit Rate",
      color: "#22c55e",
      points: sorted.map((v) => ({
        label: v.version.toUpperCase(),
        value: v.results.betHitRate,
      })),
    });

    // Per-grade lines
    for (const [grade, color, target] of [
      ["A", "#f59e0b", gradeASeries],
      ["B", "#a855f7", gradeBSeries],
    ] as [string, string, LineSeriesData[]][]) {
      target.push({
        label: `Grade ${grade}`,
        color,
        points: sorted.map((v) => {
          const g = v.results.byGrade.find((bg) => bg.grade === grade);
          return { label: v.version.toUpperCase(), value: g?.hitRate ?? 0 };
        }),
      });
    }
  }

  // Filter versions for the detail panel
  const filteredVersions = selectedVersion === "all"
    ? versions
    : versions.filter((v) => v.version === selectedVersion);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">Ted Variance Benchmark</h1>
          <p className="text-sm text-zinc-500">
            Our model vs Knutson&apos;s published results — same methodology, different xG
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={league}
            onChange={(e) => setLeague(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
          >
            <option value="epl">Premier League</option>
            <option value="championship">Championship</option>
          </select>
          <select
            value={season}
            onChange={(e) => setSeason(e.target.value)}
            className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm"
          >
            <option value="2024-25">2024-25</option>
            <option value="2023-24">2023-24</option>
            <option value="2022-23">2022-23</option>
            <option value="multi">Multi-Season</option>
          </select>
        </div>
      </div>

      {loading && (
        <div className="p-8 text-center text-zinc-500">
          <div className="animate-pulse">Running Ted Variance on {league === "epl" ? "EPL" : "Championship"}...</div>
          <div className="text-xs mt-2">Fetching matches + Understat xG, walk-forward evaluation</div>
        </div>
      )}

      {error && <div className="p-8 text-center text-red-500">Error: {error}</div>}

      {data && !loading && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
              <div className="text-2xl font-bold">{data.totalMatches}</div>
              <div className="text-xs text-zinc-500">Matches</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
              <div className="text-2xl font-bold">{data.matchesWithXg}</div>
              <div className="text-xs text-zinc-500">With xG Data</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
              <div className="text-2xl font-bold">{data.ourResults.totalBets}</div>
              <div className="text-xs text-zinc-500">Bets Generated</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
              <div className="text-2xl font-bold font-mono text-yellow-400">{pct(data.ourResults.betHitRate)}</div>
              <div className="text-xs text-zinc-500">Our Hit Rate</div>
            </div>
            <div className="bg-zinc-900 border border-zinc-800 rounded p-3 text-center">
              <div className="text-2xl font-bold font-mono text-blue-400">
                {data.tedBenchmark?.overall ? pct(data.tedBenchmark.overall.hitRate) : "--"}
              </div>
              <div className="text-xs text-zinc-500">Ted&apos;s Hit Rate</div>
            </div>
          </div>

          {/* Gap Analysis vs Ted */}
          {data.gaps.length > 0 && (
            <div className="border border-zinc-800 rounded-lg p-4">
              <h2 className="font-semibold mb-3">Gap Analysis: Our Model vs Ted&apos;s</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                    <th className="py-2 text-left">Metric</th>
                    <th className="py-2 text-right">Ours</th>
                    <th className="py-2 text-right">Ted&apos;s</th>
                    <th className="py-2 text-right">Gap</th>
                    <th className="py-2 text-left pl-4">Interpretation</th>
                  </tr>
                </thead>
                <tbody>
                  {data.gaps.map((g) => (
                    <tr key={g.metric} className="border-b border-zinc-800/50">
                      <td className="py-2 font-medium">{g.metric}</td>
                      <td className="py-2 text-right font-mono">{typeof g.ours === "number" && g.metric.includes("Rate") ? pct(g.ours) : g.ours}</td>
                      <td className="py-2 text-right font-mono">{typeof g.teds === "number" && g.metric.includes("Rate") ? pct(g.teds) : g.teds}</td>
                      <td className="py-2 text-right"><GapColor gap={g.gap} /></td>
                      <td className="py-2 pl-4 text-xs text-zinc-400">{g.interpretation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Side-by-side: Our Model vs Ted */}
          <div className="grid md:grid-cols-2 gap-4">
            <div className="border border-zinc-800 rounded-lg p-4">
              <h2 className="font-semibold mb-1">Our Model (Understat xG)</h2>
              <p className="text-xs text-zinc-500 mb-3">
                {data.season} | {data.ourResults.totalBets} bets | xG: {data.xgSource}
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                    <th className="py-1 text-left">Grade</th>
                    <th className="py-1 text-right">Bets</th>
                    <th className="py-1 text-right">W-L-D</th>
                    <th className="py-1 text-right">Hit%</th>
                    <th className="py-1 text-right">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {data.ourResults.byGrade.map((g) => (
                    <tr key={g.grade} className="border-b border-zinc-800/30">
                      <td className="py-1.5 font-medium">Grade {g.grade}</td>
                      <td className="py-1.5 text-right text-zinc-400">{g.bets}</td>
                      <td className="py-1.5 text-right font-mono text-zinc-400">{g.wins}-{g.losses}-{g.draws}</td>
                      <td className={`py-1.5 text-right font-mono font-bold ${g.hitRate >= 50 ? "text-green-400" : "text-red-400"}`}>
                        {pct(g.hitRate)}
                      </td>
                      <td className={`py-1.5 text-right font-mono ${g.roi !== null && g.roi > 0 ? "text-green-400" : "text-red-400"}`}>
                        {g.roi !== null ? `${g.roi > 0 ? "+" : ""}${g.roi}%` : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div className="bg-zinc-900/50 rounded p-2">
                  <span className="text-zinc-500">Home picks:</span>{" "}
                  <span className="font-mono">{data.ourResults.homePicks.wins}/{data.ourResults.homePicks.total} ({pct(data.ourResults.homePicks.hitRate)})</span>
                </div>
                <div className="bg-zinc-900/50 rounded p-2">
                  <span className="text-zinc-500">Away picks:</span>{" "}
                  <span className="font-mono">{data.ourResults.awayPicks.wins}/{data.ourResults.awayPicks.total} ({pct(data.ourResults.awayPicks.hitRate)})</span>
                </div>
              </div>
            </div>

            <div className="border border-blue-900/50 rounded-lg p-4 bg-blue-950/10">
              <h2 className="font-semibold mb-1">Ted Knutson (StatsBomb xG)</h2>
              {data.tedBenchmark ? (
                <>
                  <p className="text-xs text-zinc-500 mb-3">
                    {data.tedBenchmark.seasons} | Source: {data.tedBenchmark.source}
                  </p>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                        <th className="py-1 text-left">Grade</th>
                        <th className="py-1 text-right">Bets</th>
                        <th className="py-1 text-right">Hit%</th>
                        <th className="py-1 text-right">ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.tedBenchmark.gradeA && (
                        <tr className="border-b border-zinc-800/30">
                          <td className="py-1.5 font-medium">Grade A</td>
                          <td className="py-1.5 text-right text-zinc-400">~{data.tedBenchmark.gradeA.bets}</td>
                          <td className="py-1.5 text-right font-mono font-bold text-green-400">{pct(data.tedBenchmark.gradeA.hitRate)}</td>
                          <td className="py-1.5 text-right font-mono text-green-400">+{data.tedBenchmark.gradeA.roi}%</td>
                        </tr>
                      )}
                      {data.tedBenchmark.gradeB && (
                        <tr className="border-b border-zinc-800/30">
                          <td className="py-1.5 font-medium">Grade B</td>
                          <td className="py-1.5 text-right text-zinc-400">~{data.tedBenchmark.gradeB.bets}</td>
                          <td className="py-1.5 text-right font-mono font-bold text-green-400">{pct(data.tedBenchmark.gradeB.hitRate)}</td>
                          <td className="py-1.5 text-right font-mono text-green-400">+{data.tedBenchmark.gradeB.roi}%</td>
                        </tr>
                      )}
                      {data.tedBenchmark.overall && (
                        <tr className="border-b border-zinc-800/30">
                          <td className="py-1.5 font-medium">Overall</td>
                          <td className="py-1.5 text-right text-zinc-400">~{data.tedBenchmark.overall.bets}</td>
                          <td className="py-1.5 text-right font-mono font-bold text-yellow-400">{pct(data.tedBenchmark.overall.hitRate)}</td>
                          <td className="py-1.5 text-right font-mono text-green-400">+{data.tedBenchmark.overall.roi}%</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-zinc-600 mt-2">{data.tedBenchmark.notes}</p>
                </>
              ) : (
                <p className="text-sm text-zinc-500">No published benchmark available for {data.leagueLabel}</p>
              )}
            </div>
          </div>

          {/* xG Quality Note */}
          <div className="border border-yellow-900/50 rounded-lg p-4 bg-yellow-950/10">
            <h3 className="font-semibold mb-2 text-yellow-400">xG Quality Gap</h3>
            <p className="text-sm text-zinc-400">{data.xgQualityNote}</p>
            <div className="mt-3 grid md:grid-cols-2 gap-3 text-xs">
              <div className="bg-zinc-900/50 rounded p-2">
                <div className="font-semibold text-zinc-300 mb-1">Our xG: Understat (Free)</div>
                <ul className="text-zinc-500 space-y-0.5">
                  <li>- Based on shot location only</li>
                  <li>- ~100K shots in training data</li>
                  <li>- No post-shot data (keeper position, body part)</li>
                  <li>- Updated after each matchday</li>
                </ul>
              </div>
              <div className="bg-zinc-900/50 rounded p-2">
                <div className="font-semibold text-blue-300 mb-1">Ted&apos;s xG: StatsBomb (Licensed)</div>
                <ul className="text-zinc-500 space-y-0.5">
                  <li>- Shot location + freeze frame (all players)</li>
                  <li>- 1M+ shots in training data</li>
                  <li>- Post-shot xG, goalkeeper positioning</li>
                  <li>- Generally ~2-5% more predictive</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Methodology */}
          <div className="border border-zinc-800 rounded-lg p-4 text-sm text-zinc-400">
            <h3 className="font-semibold text-white mb-2">Methodology</h3>
            <ul className="space-y-1">
              <li><strong className="text-zinc-300">Walk-forward:</strong> For each match, xG is aggregated only from matches played before that date (no look-ahead)</li>
              <li><strong className="text-zinc-300">Venue splits:</strong> Home team uses home xG, away team uses away xG (Knutson&apos;s method)</li>
              <li><strong className="text-zinc-300">Match results:</strong> football-data.co.uk (includes Pinnacle closing odds for ROI calc)</li>
              <li><strong className="text-zinc-300">xG source:</strong> Understat ({data.xgSource})</li>
              <li><strong className="text-zinc-300">Ted&apos;s benchmarks:</strong> Approximate figures from public posts and presentations — update with exact numbers when available</li>
            </ul>
          </div>

          {/* ============================================================= */}
          {/* Model Version Improvement — bottom section */}
          {/* ============================================================= */}
          {versions.length >= 2 && (
            <div className="border border-purple-900/50 rounded-lg p-4 bg-purple-950/10">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Model Improvement Tracker</h2>
                <select
                  value={selectedVersion}
                  onChange={(e) => setSelectedVersion(e.target.value)}
                  className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs"
                >
                  <option value="all">All Versions</option>
                  {versions.map((v) => (
                    <option key={v.version} value={v.version}>
                      {v.version.toUpperCase()} — {v.results.betHitRate.toFixed(1)}% hit rate
                    </option>
                  ))}
                </select>
              </div>

              {/* Line charts row */}
              <div className="grid md:grid-cols-2 gap-4 mb-4">
                {hitRateSeries.length > 0 && (
                  <MetricsLineChart
                    title="Overall Hit Rate by Version"
                    yLabel="%"
                    tedLine={data.tedBenchmark?.overall?.hitRate}
                    series={hitRateSeries}
                  />
                )}
                {gradeASeries.length > 0 && gradeBSeries.length > 0 && (
                  <MetricsLineChart
                    title="Hit Rate by Grade"
                    yLabel="%"
                    tedLine={data.tedBenchmark?.gradeA?.hitRate}
                    series={[...gradeASeries, ...gradeBSeries]}
                  />
                )}
              </div>

              {/* Version summary cards */}
              <div className="grid md:grid-cols-3 gap-3 mb-4">
                {versions.map((v) => {
                  const drawPct = v.results.totalBets > 0
                    ? ((v.results.drawsOnBets / v.results.totalBets) * 100)
                    : 0;
                  return (
                    <div key={v.version} className="bg-zinc-900/50 rounded p-3 text-center">
                      <div className="text-xs text-zinc-500 mb-1">{v.version.toUpperCase()}</div>
                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div>
                          <div className="text-lg font-bold font-mono">{v.results.totalBets}</div>
                          <div className="text-zinc-600">Bets</div>
                        </div>
                        <div>
                          <div className={`text-lg font-bold font-mono ${v.results.betHitRate >= 48 ? "text-green-400" : "text-yellow-400"}`}>
                            {pct(v.results.betHitRate)}
                          </div>
                          <div className="text-zinc-600">Hit%</div>
                        </div>
                        <div>
                          <div className={`text-lg font-bold font-mono ${drawPct > 25 ? "text-red-400" : "text-orange-400"}`}>
                            {drawPct.toFixed(0)}%
                          </div>
                          <div className="text-zinc-600">Draws</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {data.tedBenchmark?.overall && (
                  <div className="bg-blue-950/30 border border-blue-900/30 rounded p-3 text-center">
                    <div className="text-xs text-blue-400 mb-1">TED (Target)</div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <div className="text-lg font-bold font-mono text-blue-300">~{data.tedBenchmark.overall.bets}</div>
                        <div className="text-zinc-600">Bets</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold font-mono text-blue-300">{pct(data.tedBenchmark.overall.hitRate)}</div>
                        <div className="text-zinc-600">Hit%</div>
                      </div>
                      <div>
                        <div className="text-lg font-bold font-mono text-blue-300">+{data.tedBenchmark.overall.roi}%</div>
                        <div className="text-zinc-600">ROI</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* V1 vs V2 Delta Table */}
              {data.modelComparison && (
                <div className="border border-zinc-800 rounded-lg p-4 mb-4">
                  <h3 className="font-semibold mb-1 text-sm">V1 vs V2 Delta</h3>
                  <div className="flex gap-4 text-xs text-zinc-500 mb-3">
                    <span><strong className="text-zinc-300">V1:</strong> {data.modelComparison.v1.description}</span>
                    <span><strong className="text-zinc-300">V2:</strong> {data.modelComparison.v2.description}</span>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-zinc-800 text-zinc-500 text-xs">
                        <th className="py-2 text-left">Metric</th>
                        <th className="py-2 text-right">V1 (Old)</th>
                        <th className="py-2 text-right">V2 (New)</th>
                        <th className="py-2 text-right">Delta</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.modelComparison.deltas.map((d) => (
                        <tr key={d.metric} className="border-b border-zinc-800/30">
                          <td className="py-1.5 font-medium">{d.metric}</td>
                          <td className="py-1.5 text-right font-mono text-zinc-400">
                            {d.metric.includes("Rate") ? pct(d.v1) : d.v1}
                          </td>
                          <td className="py-1.5 text-right font-mono text-zinc-300">
                            {d.metric.includes("Rate") ? pct(d.v2) : d.v2}
                          </td>
                          <td className="py-1.5 text-right">
                            <span className={`font-mono font-bold ${
                              d.delta === 0 ? "text-zinc-500" :
                              d.improved ? "text-green-400" : "text-red-400"
                            }`}>
                              {d.delta > 0 ? "+" : ""}{d.metric.includes("Rate") ? `${d.delta.toFixed(1)}%` : d.delta}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Version detail cards */}
              {selectedVersion !== "all" ? (
                <div className="grid md:grid-cols-1 gap-3">
                  {filteredVersions.map((v) => (
                    <VersionDetailPanel key={v.version} version={v} label={`${v.version.toUpperCase()} — ${v.results.betHitRate.toFixed(1)}% hit rate`} />
                  ))}
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-3">
                  {versions.map((v) => (
                    <VersionDetailPanel key={v.version} version={v} label={v.version.toUpperCase()} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
