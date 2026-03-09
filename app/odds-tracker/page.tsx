"use client";

import { useState, useEffect } from "react";
import LeagueSelector from "../components/league-selector";

interface ApiStatus {
  configured: boolean;
  remaining?: number;
  used?: number;
}

interface CollectionStats {
  totalSnapshots: number;
  uniqueMatches: number;
  dateRange: { from: string; to: string } | null;
  avgSnapshotsPerMatch: number;
}

interface MatchMovement {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  snapshotCount: number;
  opening: { home: number; draw: number; away: number };
  closing: { home: number; draw: number; away: number };
  movement: { home: number; draw: number; away: number };
}

export default function OddsTrackerPage() {
  const [league, setLeague] = useState("serieA");
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [matches, setMatches] = useState<MatchMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [collectResult, setCollectResult] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/odds-history?league=${league}`);
        const data = await res.json();
        setApiStatus(data.apiStatus);
        setStats(data.collection);
        setMatches(data.matchHistories || []);
      } catch {
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [league]);

  async function collectNow() {
    setCollecting(true);
    setCollectResult(null);
    try {
      const res = await fetch(`/api/collect-odds?league=${league}`, { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setCollectResult(`Error: ${data.error}`);
      } else {
        setCollectResult(`Collected odds for ${data.matchesCollected} matches`);
        // Reload data
        const histRes = await fetch(`/api/odds-history?league=${league}`);
        const histData = await histRes.json();
        setStats(histData.collection);
        setMatches(histData.matchHistories || []);
      }
    } catch (e: any) {
      setCollectResult(`Error: ${e.message}`);
    } finally {
      setCollecting(false);
    }
  }

  return (
    <div>
      <div className="mb-4 text-sm text-zinc-400">
        Build your own odds database by collecting snapshots over time.
        Track line movement from opening to closing — the sharpest signal in sports betting.
      </div>

      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <LeagueSelector value={league} onChange={setLeague} />
        <button
          onClick={collectNow}
          disabled={collecting || !apiStatus?.configured}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            collecting
              ? "bg-zinc-700 text-zinc-500 cursor-wait"
              : apiStatus?.configured
              ? "bg-green-600 text-white hover:bg-green-500"
              : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
          }`}
        >
          {collecting ? "Collecting..." : "Collect Odds Now"}
        </button>
        {collectResult && (
          <span className={`text-xs ${collectResult.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>
            {collectResult}
          </span>
        )}
      </div>

      {loading && <div className="py-20 text-center text-zinc-500">Loading odds tracker...</div>}

      {!loading && (
        <>
          {/* API Status */}
          <div className="mb-6 rounded-xl bg-zinc-900 p-4">
            <h3 className="mb-3 text-sm font-medium text-zinc-300">The Odds API Status</h3>
            {!apiStatus?.configured ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                  <span className="text-sm text-red-400">API key not configured</span>
                </div>
                <div className="rounded-lg bg-zinc-800 p-3 text-xs text-zinc-400">
                  <p className="font-medium text-zinc-300 mb-1">Setup (free, no credit card):</p>
                  <ol className="list-decimal ml-4 space-y-1">
                    <li>Sign up at <span className="text-blue-400">the-odds-api.com</span> (500 free requests/month)</li>
                    <li>Copy your API key</li>
                    <li>Add to <code className="bg-zinc-900 px-1 rounded">.env.local</code>: <code className="bg-zinc-900 px-1 rounded">ODDS_API_KEY=your_key_here</code></li>
                    <li>Restart the dev server</li>
                  </ol>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="flex items-center justify-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="text-sm text-green-400">Connected</span>
                  </div>
                </div>
                <div>
                  <div className="text-xl font-bold text-blue-400">{apiStatus.remaining ?? "?"}</div>
                  <div className="text-[10px] text-zinc-500">Requests Remaining</div>
                </div>
                <div>
                  <div className="text-xl font-bold text-zinc-400">{apiStatus.used ?? "?"}</div>
                  <div className="text-[10px] text-zinc-500">Used This Month</div>
                </div>
              </div>
            )}
          </div>

          {/* Collection Stats */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-blue-400">{stats?.totalSnapshots || 0}</div>
              <div className="text-[10px] text-zinc-500">Total Snapshots</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-green-400">{stats?.uniqueMatches || 0}</div>
              <div className="text-[10px] text-zinc-500">Matches Tracked</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-purple-400">{stats?.avgSnapshotsPerMatch || 0}</div>
              <div className="text-[10px] text-zinc-500">Avg Snapshots/Match</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-yellow-400">{matches.length}</div>
              <div className="text-[10px] text-zinc-500">With Line Movement</div>
            </div>
          </div>

          {/* How It Works */}
          {(stats?.totalSnapshots || 0) === 0 && (
            <div className="mb-6 rounded-xl bg-zinc-900 p-4">
              <h3 className="mb-2 text-sm font-medium text-zinc-300">How Odds Collection Works</h3>
              <div className="text-xs text-zinc-400 space-y-2">
                <p>
                  The sharp playbook (Crane/Knutson): You need to track how odds <strong>move</strong> from opening to closing.
                  Closing line value (CLV) is the gold standard, but to measure it properly you need to know what price you
                  could have gotten when your model first identified value.
                </p>
                <p>
                  <strong>Collection strategy (within 500 free calls/month):</strong>
                </p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Poll Serie A 3x/day (morning, afternoon, evening) = ~90 calls/month</li>
                  <li>Poll Serie B 2x/day = ~60 calls/month</li>
                  <li>Each poll captures odds from 15+ bookmakers including Pinnacle</li>
                  <li>Over time, you build a line movement database for every match</li>
                  <li>After ~2 weeks you have enough data to see real patterns</li>
                </ul>
                <p>
                  <strong>Automation options:</strong>
                </p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Manual: Click &quot;Collect Odds Now&quot; button above</li>
                  <li>Cron job: Set up a free cron at cron-job.org to hit <code className="bg-zinc-800 px-1 rounded">/api/collect-odds?league=serieA</code></li>
                  <li>Vercel Cron: Add to vercel.json for automatic collection</li>
                </ul>
              </div>
            </div>
          )}

          {/* Line Movement Table */}
          {matches.length > 0 && (
            <div className="rounded-xl bg-zinc-900 overflow-hidden">
              <h3 className="px-4 py-3 text-sm font-medium text-zinc-300 border-b border-zinc-800">
                Line Movement Tracker
              </h3>
              <table className="w-full text-xs sm:text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="px-3 py-2 text-left">Match</th>
                    <th className="px-3 py-2 text-center">Kickoff</th>
                    <th className="px-3 py-2 text-center">Snaps</th>
                    <th className="px-3 py-2 text-center">Open H/D/A</th>
                    <th className="px-3 py-2 text-center">Close H/D/A</th>
                    <th className="px-3 py-2 text-center">Move</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.slice(0, 50).map((m) => {
                    const bigMove = Math.max(
                      Math.abs(m.movement.home),
                      Math.abs(m.movement.draw),
                      Math.abs(m.movement.away)
                    );
                    return (
                      <tr key={m.matchId} className={`border-b border-zinc-800/50 ${bigMove > 0.3 ? "bg-yellow-500/5" : ""}`}>
                        <td className="px-3 py-2 font-medium">
                          {m.homeTeam} v {m.awayTeam}
                        </td>
                        <td className="px-3 py-2 text-center text-zinc-500">
                          {new Date(m.commenceTime).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-center text-zinc-400">{m.snapshotCount}</td>
                        <td className="px-3 py-2 text-center font-mono text-zinc-400">
                          {m.opening.home.toFixed(2)} / {m.opening.draw.toFixed(2)} / {m.opening.away.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center font-mono">
                          {m.closing.home.toFixed(2)} / {m.closing.draw.toFixed(2)} / {m.closing.away.toFixed(2)}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <span className={`font-mono text-xs ${bigMove > 0.2 ? "text-yellow-400 font-bold" : "text-zinc-500"}`}>
                            {m.movement.home > 0 ? "+" : ""}{m.movement.home.toFixed(2)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="mt-4 text-xs text-zinc-600">
            Line movement = closing odds minus opening odds. Negative movement on a team = market getting sharper money
            on that side. Big moves (&gt;0.30) highlighted — these are where sharp action lives.
            Per Harry Crane: track where YOU would have bet vs where the line closed. That&apos;s your true CLV.
          </p>
        </>
      )}
    </div>
  );
}
