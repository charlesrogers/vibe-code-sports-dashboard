"use client";

import { useState, useEffect } from "react";
import SeasonSelector from "../components/season-selector";

interface ValueBet {
  date: string;
  homeTeam: string;
  awayTeam: string;
  market: string;
  modelProb: number;
  marketOdds: number;
  impliedProb: number;
  edge: number;
  kellyStake: number;
  result?: "W" | "L" | "P";
}

interface Summary {
  totalBets: number;
  settledBets: number;
  wins: number;
  losses: number;
  hitRate: number;
  roi: number;
  avgEdge: number;
}

export default function ValueBetsPage() {
  const [season, setSeason] = useState("2024-25");
  const [minEdge, setMinEdge] = useState(5);
  const [bets, setBets] = useState<ValueBet[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "W" | "L">("all");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/value?season=${season}&minEdge=${minEdge / 100}`);
        const data = await res.json();
        setBets(data.valueBets || []);
        setSummary(data.summary || null);
      } catch {
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [season, minEdge]);

  const filtered = filter === "all" ? bets : bets.filter((b) => b.result === filter);

  function pct(p: number): string { return `${(p * 100).toFixed(1)}%`; }

  return (
    <div>
      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <SeasonSelector value={season} onChange={setSeason} />
        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-500">Min Edge %:</label>
          <input
            type="range"
            min={1}
            max={20}
            value={minEdge}
            onChange={(e) => setMinEdge(parseInt(e.target.value))}
            className="w-24"
          />
          <span className="text-sm font-mono text-blue-400">{minEdge}%</span>
        </div>
        <div className="flex gap-1 ml-auto">
          {(["all", "W", "L"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                filter === f ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {f === "all" ? "All" : f === "W" ? "Winners" : "Losers"}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="py-20 text-center text-zinc-500">Scanning {season} for value bets...</div>}

      {!loading && summary && (
        <>
          {/* P&L Summary */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-blue-400">{summary.totalBets}</div>
              <div className="text-[10px] text-zinc-500">Value Bets Found</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-zinc-300">{summary.settledBets}</div>
              <div className="text-[10px] text-zinc-500">Settled</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-green-400">{summary.wins}</div>
              <div className="text-[10px] text-zinc-500">Wins</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-red-400">{summary.losses}</div>
              <div className="text-[10px] text-zinc-500">Losses</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-yellow-400">{summary.hitRate}%</div>
              <div className="text-[10px] text-zinc-500">Hit Rate</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className={`text-xl font-bold ${summary.roi >= 0 ? "text-green-400" : "text-red-400"}`}>
                {summary.roi > 0 ? "+" : ""}{summary.roi}%
              </div>
              <div className="text-[10px] text-zinc-500">ROI</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-purple-400">{summary.avgEdge}%</div>
              <div className="text-[10px] text-zinc-500">Avg Edge</div>
            </div>
          </div>

          {/* Value Bets Table */}
          <div className="rounded-xl bg-zinc-900 overflow-hidden">
            <table className="w-full text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="px-3 py-2 text-left">Date</th>
                  <th className="px-3 py-2 text-left">Match</th>
                  <th className="px-3 py-2 text-center">Market</th>
                  <th className="px-3 py-2 text-center">Model</th>
                  <th className="px-3 py-2 text-center">Market Odds</th>
                  <th className="px-3 py-2 text-center">Implied</th>
                  <th className="px-3 py-2 text-center">Edge</th>
                  <th className="px-3 py-2 text-center">Kelly %</th>
                  <th className="px-3 py-2 text-center">Result</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 100).map((bet, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-3 py-2 text-zinc-500">{bet.date}</td>
                    <td className="px-3 py-2 font-medium">
                      {bet.homeTeam} v {bet.awayTeam}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                        bet.market === "Home" ? "bg-green-900/50 text-green-400" :
                        bet.market === "Away" ? "bg-blue-900/50 text-blue-400" :
                        bet.market === "Draw" ? "bg-yellow-900/50 text-yellow-400" :
                        "bg-purple-900/50 text-purple-400"
                      }`}>
                        {bet.market}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-green-400">
                      {pct(bet.modelProb)}
                    </td>
                    <td className="px-3 py-2 text-center font-mono">{bet.marketOdds.toFixed(2)}</td>
                    <td className="px-3 py-2 text-center font-mono text-zinc-400">
                      {pct(bet.impliedProb)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`font-mono font-bold ${bet.edge > 0.1 ? "text-green-400" : "text-yellow-400"}`}>
                        +{(bet.edge * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center font-mono text-zinc-400">
                      {bet.kellyStake.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2 text-center">
                      {bet.result === "W" && <span className="font-bold text-green-400">W</span>}
                      {bet.result === "L" && <span className="font-bold text-red-400">L</span>}
                      {!bet.result && <span className="text-zinc-600">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtered.length === 0 && (
            <div className="py-12 text-center text-zinc-500">
              No value bets found with {minEdge}%+ edge. Try lowering the threshold.
            </div>
          )}

          <p className="mt-4 text-xs text-zinc-600">
            Edge = model probability minus implied market probability. Kelly % = optimal stake as percentage of bankroll.
            Odds from Pinnacle (or market average). ROI is flat-stake (1 unit per bet).
          </p>
        </>
      )}
    </div>
  );
}
