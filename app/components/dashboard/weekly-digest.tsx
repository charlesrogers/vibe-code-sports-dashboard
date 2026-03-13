"use client";

interface PaperBet {
  matchDate: string;
  league: string;
  homeTeam: string;
  awayTeam: string;
  selection: string;
  marketType: string;
  status: string;
  profit?: number;
  clv?: number;
  edge: number;
}

const LEAGUE_LABELS: Record<string, string> = {
  epl: "EPL", "la-liga": "La Liga", bundesliga: "Bundesliga",
  "serie-a": "Serie A", "serie-b": "Serie B",
};

interface WeeklyDigestProps {
  bets: PaperBet[];
}

export default function WeeklyDigest({ bets }: WeeklyDigestProps) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400000);
  const weekAgoStr = weekAgo.toISOString().slice(0, 10);

  const recentSettled = bets.filter(b =>
    b.status !== "pending" && b.status !== "superseded" &&
    b.matchDate >= weekAgoStr
  );

  if (recentSettled.length === 0) return null;

  const wins = recentSettled.filter(b => b.status === "won").length;
  const losses = recentSettled.filter(b => b.status === "lost").length;
  const pnl = recentSettled.reduce((s, b) => s + (b.profit || 0), 0);
  const withCLV = recentSettled.filter(b => b.clv != null);
  const avgCLV = withCLV.length > 0
    ? withCLV.reduce((s, b) => s + (b.clv || 0), 0) / withCLV.length * 100
    : 0;

  // Best/worst bets
  const sorted = [...recentSettled].sort((a, b) => (b.profit || 0) - (a.profit || 0));
  const best = sorted.slice(0, 3).filter(b => (b.profit || 0) > 0);
  const worst = sorted.slice(-3).reverse().filter(b => (b.profit || 0) < 0);

  // Profitable leagues
  const leaguePnL: Record<string, number> = {};
  for (const b of recentSettled) {
    leaguePnL[b.league] = (leaguePnL[b.league] || 0) + (b.profit || 0);
  }
  const profitableLeagues = Object.entries(leaguePnL)
    .filter(([, p]) => p > 0)
    .map(([l]) => LEAGUE_LABELS[l] || l);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4">
      <h3 className="mb-3 text-sm font-semibold text-zinc-300">Last 7 Days</h3>

      {/* Summary */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        <div className="text-center">
          <div className="text-lg font-bold text-white">{recentSettled.length}</div>
          <div className="text-[10px] text-zinc-500">Bets</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-bold text-white">{wins}W / {losses}L</div>
          <div className="text-[10px] text-zinc-500">Record</div>
        </div>
        <div className="text-center">
          <div className={`text-lg font-bold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
            {pnl >= 0 ? "+" : ""}{pnl.toFixed(1)}u
          </div>
          <div className="text-[10px] text-zinc-500">P&L</div>
        </div>
        <div className="text-center">
          <div className={`text-lg font-bold ${avgCLV >= 0 ? "text-blue-400" : "text-red-400"}`}>
            {avgCLV >= 0 ? "+" : ""}{avgCLV.toFixed(1)}%
          </div>
          <div className="text-[10px] text-zinc-500">Avg CLV</div>
        </div>
      </div>

      {/* Best/Worst */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        {best.length > 0 && (
          <div>
            <div className="text-[10px] text-zinc-500 uppercase mb-1">Best Bets</div>
            {best.map((b, i) => (
              <div key={i} className="text-green-400">
                +{(b.profit || 0).toFixed(1)}u {b.homeTeam} vs {b.awayTeam} ({b.selection})
              </div>
            ))}
          </div>
        )}
        {worst.length > 0 && (
          <div>
            <div className="text-[10px] text-zinc-500 uppercase mb-1">Worst Bets</div>
            {worst.map((b, i) => (
              <div key={i} className="text-red-400">
                {(b.profit || 0).toFixed(1)}u {b.homeTeam} vs {b.awayTeam} ({b.selection})
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Profitable leagues */}
      {profitableLeagues.length > 0 && (
        <div className="mt-3 text-xs text-zinc-500">
          Profitable: {profitableLeagues.join(", ")}
        </div>
      )}
    </div>
  );
}
