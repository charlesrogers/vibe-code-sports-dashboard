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

const ALL_MARKETS = [
  { key: "h2h", label: "1X2", desc: "Match winner — core market", available: true },
  { key: "totals", label: "O/U", desc: "Over/Under 2.5 goals", available: true },
  { key: "spreads", label: "AH", desc: "Asian Handicap", available: true },
  { key: "btts", label: "BTTS", desc: "Not available for Italian football", available: false },
  { key: "draw_no_bet", label: "DNB", desc: "Not available for Italian football", available: false },
];

export default function OddsTrackerPage() {
  const [league, setLeague] = useState("serieA");
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [matches, setMatches] = useState<MatchMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [collecting, setCollecting] = useState(false);
  const [collectResult, setCollectResult] = useState<string | null>(null);
  const [selectedMarkets, setSelectedMarkets] = useState<Set<string>>(new Set(["h2h", "totals", "spreads"]));

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

  function toggleMarket(key: string) {
    setSelectedMarkets((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // keep at least 1
      } else {
        next.add(key);
      }
      return next;
    });
  }

  const marketsParam = [...selectedMarkets].filter(k => ALL_MARKETS.find(m => m.key === k)?.available).join(",");

  async function collectNow(mode: "bulk" | "deep" = "bulk") {
    setCollecting(true);
    setCollectResult(null);
    try {
      const url = mode === "deep"
        ? `/api/collect-odds?league=${league}&mode=deep`
        : `/api/collect-odds?league=${league}&markets=${marketsParam}`;
      const res = await fetch(url, { method: "POST" });
      const data = await res.json();
      if (data.error) {
        setCollectResult(`Error: ${data.error}`);
      } else if (mode === "deep") {
        setCollectResult(`Deep: ${data.matchesCollected} matches (${data.deepEventsCollected} with BTTS/props), ${data.requestsUsed} req`);
      } else {
        setCollectResult(`Bulk: ${data.matchesCollected} matches (h2h+totals+spreads), ${data.requestsUsed} req`);
      }
      // Reload data
      const histRes = await fetch(`/api/odds-history?league=${league}`);
      const histData = await histRes.json();
      setStats(histData.collection);
      setMatches(histData.matchHistories || []);
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

        {/* Market Selector */}
        <div className="flex gap-1">
          {ALL_MARKETS.map((m) => (
            <button
              key={m.key}
              onClick={() => m.available && toggleMarket(m.key)}
              title={m.desc}
              disabled={!m.available}
              className={`rounded px-2 py-1.5 text-[10px] font-bold transition-colors ${
                !m.available
                  ? "bg-zinc-900 text-zinc-700 cursor-not-allowed line-through"
                  : selectedMarkets.has(m.key)
                  ? "bg-green-600 text-white"
                  : "bg-zinc-800 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => collectNow("bulk")}
          disabled={collecting || !apiStatus?.configured}
          title="All matches, h2h+totals+spreads, 59 bookmakers — 1 API request"
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            collecting
              ? "bg-zinc-700 text-zinc-500 cursor-wait"
              : apiStatus?.configured
              ? "bg-green-600 text-white hover:bg-green-500"
              : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
          }`}
        >
          {collecting ? "Collecting..." : "Bulk Collect (1 req)"}
        </button>

        <button
          onClick={() => collectNow("deep")}
          disabled={collecting || !apiStatus?.configured}
          title="Bulk + deep data (BTTS, alt totals, goalscorer props) for next 3 matches — 4 requests"
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            collecting
              ? "bg-zinc-700 text-zinc-500 cursor-wait"
              : apiStatus?.configured
              ? "bg-purple-600 text-white hover:bg-purple-500"
              : "bg-zinc-800 text-zinc-500 cursor-not-allowed"
          }`}
        >
          {collecting ? "..." : "Deep Collect (4 req)"}
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
                  The sharp playbook (Crane/Knutson): Track how odds <strong>move</strong> from opening to closing.
                  Most line movement happens in the final hours before kickoff — that&apos;s where sharp money acts.
                </p>
                <p>
                  <strong>Smart scheduler — polls concentrate around kickoffs:</strong>
                </p>
                <ul className="list-disc ml-4 space-y-1">
                  <li><strong>7-3 days out:</strong> 1x/day — capture opening line + early sharp action</li>
                  <li><strong>3-1 days:</strong> 2x/day — syndicate money, limits going up</li>
                  <li><strong>24-6h (match day):</strong> 3x/day — public money, parlay flows</li>
                  <li><strong>6-2h (pre-match):</strong> every 2h — final news, late syndicate hits</li>
                  <li><strong>2-0h (closing):</strong> every hour + deep collect (BTTS, goalscorer props)</li>
                </ul>
                <p>
                  Each bulk poll captures <strong>59 bookmakers</strong> (eu+uk+us+au) including Pinnacle,
                  all in <strong>1 API request</strong>. Budget: ~120 req/month, well within 500 free tier.
                </p>
                <p>
                  <strong>Automation:</strong>
                </p>
                <ul className="list-disc ml-4 space-y-1">
                  <li>Manual: Use the buttons above</li>
                  <li>Smart cron: Hit <code className="bg-zinc-800 px-1 rounded">/api/cron-odds</code> every 30-60min
                    (use <span className="text-blue-400">cron-job.org</span> free) — scheduler auto-decides when to actually poll</li>
                  <li>Vercel Cron: 1x/day fallback already configured</li>
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
