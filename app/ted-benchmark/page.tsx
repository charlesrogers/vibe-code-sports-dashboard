"use client";

import { useEffect, useState, useCallback } from "react";

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
  tedBenchmark: TedBenchmarkRef | null;
  gaps: GapEntry[];
  xgQualityNote: string;
}

function pct(n: number): string {
  return n.toFixed(1) + "%";
}

function GapColor({ gap }: { gap: number }) {
  const color = gap > 2 ? "text-green-400" : gap < -2 ? "text-red-400" : "text-yellow-400";
  const prefix = gap > 0 ? "+" : "";
  return <span className={`font-mono font-bold ${color}`}>{prefix}{gap.toFixed(1)}%</span>;
}

export default function TedBenchmarkPage() {
  const [data, setData] = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [league, setLeague] = useState("epl");
  const [season, setSeason] = useState("2024-25");

  const fetchData = useCallback(async (l: string, s: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ted-benchmark?league=${l}&season=${s}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(league, season); }, [fetchData, league, season]);

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
                {data.tedBenchmark?.overall ? pct(data.tedBenchmark.overall.hitRate) : "—"}
              </div>
              <div className="text-xs text-zinc-500">Ted&apos;s Hit Rate</div>
            </div>
          </div>

          {/* Gap Analysis */}
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

          {/* Side-by-side grade comparison */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Our results */}
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
                        {g.roi !== null ? `${g.roi > 0 ? "+" : ""}${g.roi}%` : "—"}
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

            {/* Ted's benchmarks */}
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
        </div>
      )}
    </div>
  );
}
