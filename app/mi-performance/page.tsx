"use client";

import { useState, useEffect } from "react";

interface Stats {
  n: number; clv: number; roi: number; hitRate: number; avgOdds: number; profit: number;
}

interface PerfData {
  filters: { leagues: string[]; maxOdds: number; minEdge: number; markets: string; noDraws: boolean };
  overall: Stats;
  edgeTable: (Stats & { threshold: number })[];
  stability: Record<string, Record<string, Stats>>;
  bySeason: (Stats & { season: string })[];
  byOdds: (Stats & { label: string })[];
  byLeague: Record<string, Stats>;
}

const LEAGUE_LABELS: Record<string, string> = {
  epl: "EPL", "la-liga": "La Liga", bundesliga: "Bundesliga", "serie-a": "Serie A",
};

function fmtPct(v: number): string {
  return `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
      <div className={`text-2xl font-bold ${color || "text-white"}`}>{value}</div>
      <div className="text-[10px] text-zinc-500 uppercase">{label}</div>
      {sub && <div className="text-[10px] text-zinc-600 mt-0.5">{sub}</div>}
    </div>
  );
}

export default function MIPerformancePage() {
  const [data, setData] = useState<PerfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minEdge, setMinEdge] = useState("0.07");
  const [maxOdds, setMaxOdds] = useState("2.5");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/mi-performance?min-edge=${minEdge}&max-odds=${maxOdds}&markets=sides&no-draws=true`);
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setData(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return <div className="py-20 text-center text-zinc-500">Running backtest evaluation...</div>;
  if (error) return <div className="py-20 text-center text-red-400">{error}</div>;
  if (!data) return null;

  const { overall, edgeTable, stability, bySeason, byOdds, byLeague } = data;

  return (
    <div>
      <div className="mb-4 text-sm text-zinc-400">
        MI-BP model backtest: 4 leagues, 3 test seasons (2022-25), walk-forward with 7-day re-solve.
      </div>

      {/* Filter controls */}
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <label className="text-xs text-zinc-500">
          Min edge:
          <select value={minEdge} onChange={e => setMinEdge(e.target.value)}
            className="ml-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
            <option value="0.00">0%</option>
            <option value="0.03">3%</option>
            <option value="0.05">5%</option>
            <option value="0.07">7%</option>
            <option value="0.10">10%</option>
            <option value="0.15">15%</option>
          </select>
        </label>
        <label className="text-xs text-zinc-500">
          Max odds:
          <select value={maxOdds} onChange={e => setMaxOdds(e.target.value)}
            className="ml-1 rounded bg-zinc-800 border border-zinc-700 px-2 py-1 text-xs text-zinc-300">
            <option value="1.5">1.50</option>
            <option value="2.0">2.00</option>
            <option value="2.5">2.50</option>
            <option value="3.0">3.00</option>
            <option value="5.0">5.00</option>
            <option value="99">No cap</option>
          </select>
        </label>
        <button onClick={load}
          className="rounded bg-blue-900/50 border border-blue-700 px-3 py-1 text-xs text-blue-400 hover:bg-blue-900/70">
          Update
        </button>
      </div>

      {/* KPI cards */}
      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Total Bets" value={String(overall.n)} />
        <StatCard label="ROI" value={fmtPct(overall.roi)} color={overall.roi >= 0 ? "text-green-400" : "text-red-400"} />
        <StatCard label="CLV" value={fmtPct(overall.clv)} color="text-blue-400" />
        <StatCard label="Hit Rate" value={`${(overall.hitRate * 100).toFixed(1)}%`} />
        <StatCard label="Avg Odds" value={overall.avgOdds.toFixed(2)} />
        <StatCard label="P&L" value={`${overall.profit >= 0 ? "+" : ""}${overall.profit.toFixed(1)}u`}
          color={overall.profit >= 0 ? "text-green-400" : "text-red-400"} />
      </div>

      {/* Edge Threshold Table */}
      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-zinc-300">By Edge Threshold</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="py-2 text-left">Threshold</th>
                <th className="py-2 text-right">Bets</th>
                <th className="py-2 text-right">CLV</th>
                <th className="py-2 text-right">ROI</th>
                <th className="py-2 text-right">Hit%</th>
                <th className="py-2 text-right">Avg Odds</th>
                <th className="py-2 text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {edgeTable.map(r => (
                <tr key={r.threshold} className="border-b border-zinc-900 text-zinc-300">
                  <td className="py-1.5">{(r.threshold * 100).toFixed(0)}%</td>
                  <td className="py-1.5 text-right font-mono">{r.n}</td>
                  <td className="py-1.5 text-right font-mono text-blue-400">{fmtPct(r.clv)}</td>
                  <td className={`py-1.5 text-right font-mono ${r.roi >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtPct(r.roi)}</td>
                  <td className="py-1.5 text-right font-mono">{(r.hitRate * 100).toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-mono">{r.avgOdds.toFixed(2)}</td>
                  <td className={`py-1.5 text-right font-mono ${r.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {r.profit >= 0 ? "+" : ""}{r.profit.toFixed(1)}u
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* League Breakdown */}
      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-zinc-300">By League</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {Object.entries(byLeague).map(([lid, s]) => (
            <div key={lid} className="rounded bg-zinc-900 border border-zinc-800 p-3">
              <div className="text-xs text-zinc-500 mb-1">{LEAGUE_LABELS[lid] || lid}</div>
              <div className="flex items-baseline gap-2">
                <span className={`text-lg font-bold ${s.roi >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {fmtPct(s.roi)}
                </span>
                <span className="text-xs text-zinc-600">{s.n} bets</span>
              </div>
              <div className="text-[10px] text-zinc-600 mt-0.5">
                CLV: {fmtPct(s.clv)} | Hit: {(s.hitRate * 100).toFixed(0)}% | P&L: {s.profit >= 0 ? "+" : ""}{s.profit.toFixed(1)}u
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Season Trend */}
      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-zinc-300">By Season</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="py-2 text-left">Season</th>
                <th className="py-2 text-right">Bets</th>
                <th className="py-2 text-right">CLV</th>
                <th className="py-2 text-right">ROI</th>
                <th className="py-2 text-right">Hit%</th>
                <th className="py-2 text-right">Odds</th>
              </tr>
            </thead>
            <tbody>
              {bySeason.map(r => (
                <tr key={r.season} className="border-b border-zinc-900 text-zinc-300">
                  <td className="py-1.5">{r.season}</td>
                  <td className="py-1.5 text-right font-mono">{r.n}</td>
                  <td className="py-1.5 text-right font-mono text-blue-400">{fmtPct(r.clv)}</td>
                  <td className={`py-1.5 text-right font-mono ${r.roi >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtPct(r.roi)}</td>
                  <td className="py-1.5 text-right font-mono">{(r.hitRate * 100).toFixed(1)}%</td>
                  <td className="py-1.5 text-right font-mono">{r.avgOdds.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Odds Buckets */}
      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-zinc-300">By Odds Bucket</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="py-2 text-left">Odds</th>
                <th className="py-2 text-right">Bets</th>
                <th className="py-2 text-right">CLV</th>
                <th className="py-2 text-right">ROI</th>
                <th className="py-2 text-right">Hit%</th>
                <th className="py-2 text-right">P&L</th>
              </tr>
            </thead>
            <tbody>
              {byOdds.map(r => (
                <tr key={r.label} className="border-b border-zinc-900 text-zinc-300">
                  <td className="py-1.5">{r.label}</td>
                  <td className="py-1.5 text-right font-mono">{r.n}</td>
                  <td className="py-1.5 text-right font-mono text-blue-400">{fmtPct(r.clv)}</td>
                  <td className={`py-1.5 text-right font-mono ${r.roi >= 0 ? "text-green-400" : "text-red-400"}`}>{fmtPct(r.roi)}</td>
                  <td className="py-1.5 text-right font-mono">{(r.hitRate * 100).toFixed(1)}%</td>
                  <td className={`py-1.5 text-right font-mono ${r.profit >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {r.profit >= 0 ? "+" : ""}{r.profit.toFixed(1)}u
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Stability Matrix */}
      <div className="mb-6">
        <h3 className="mb-2 text-sm font-semibold text-zinc-300">Stability Matrix</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-500">
                <th className="py-2 text-left">Market</th>
                {Object.keys(byLeague).map(lid => (
                  <th key={lid} className="py-2 text-right">{LEAGUE_LABELS[lid] || lid}</th>
                ))}
                <th className="py-2 text-right">Overall</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(stability).map(([market, data]) => (
                <>
                  <tr key={`${market}-clv`} className="text-zinc-300">
                    <td className="py-1">{market.toUpperCase()} CLV</td>
                    {Object.keys(byLeague).map(lid => (
                      <td key={lid} className="py-1 text-right font-mono text-blue-400">
                        {data[lid]?.n > 0 ? fmtPct(data[lid].clv) : "—"}
                      </td>
                    ))}
                    <td className="py-1 text-right font-mono text-blue-400">{fmtPct(data.overall.clv)}</td>
                  </tr>
                  <tr key={`${market}-roi`} className="text-zinc-300">
                    <td className="py-1">{market.toUpperCase()} ROI</td>
                    {Object.keys(byLeague).map(lid => (
                      <td key={lid} className={`py-1 text-right font-mono ${(data[lid]?.roi || 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {data[lid]?.n > 0 ? fmtPct(data[lid].roi) : "—"}
                      </td>
                    ))}
                    <td className={`py-1 text-right font-mono ${data.overall.roi >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {fmtPct(data.overall.roi)}
                    </td>
                  </tr>
                  <tr key={`${market}-n`} className="border-b border-zinc-900 text-zinc-500">
                    <td className="py-1">{market.toUpperCase()} n</td>
                    {Object.keys(byLeague).map(lid => (
                      <td key={lid} className="py-1 text-right font-mono">{data[lid]?.n || 0}</td>
                    ))}
                    <td className="py-1 text-right font-mono">{data.overall.n}</td>
                  </tr>
                </>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-center text-[10px] text-zinc-700">
        Filters: sides, no draws, max odds {data.filters.maxOdds}, min edge {(data.filters.minEdge * 100).toFixed(0)}% | Walk-forward backtest with 7-day re-solve, 3-day embargo
      </div>
    </div>
  );
}
