"use client";

import { BettingMarkets } from "@/lib/types";

function pct(p: number): string {
  return `${(p * 100).toFixed(1)}%`;
}

function odds(p: number): string {
  if (p <= 0) return "-";
  return (1 / p).toFixed(2);
}

interface Props {
  markets: BettingMarkets;
  homeTeam: string;
  awayTeam: string;
}

export default function BettingMarketsDisplay({ markets, homeTeam, awayTeam }: Props) {
  const { match1X2, overUnder, btts, correctScore, asianHandicap } = markets;

  return (
    <div className="space-y-4">
      {/* 1X2 */}
      <div className="rounded-xl bg-zinc-900 p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-400">Match Result (1X2)</h3>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-zinc-800 p-3">
            <div className="text-lg font-bold text-green-400">{pct(match1X2.home)}</div>
            <div className="text-xs text-zinc-500">{homeTeam}</div>
            <div className="mt-1 text-sm font-mono text-zinc-400">{odds(match1X2.home)}</div>
          </div>
          <div className="rounded-lg bg-zinc-800 p-3">
            <div className="text-lg font-bold text-yellow-400">{pct(match1X2.draw)}</div>
            <div className="text-xs text-zinc-500">Draw</div>
            <div className="mt-1 text-sm font-mono text-zinc-400">{odds(match1X2.draw)}</div>
          </div>
          <div className="rounded-lg bg-zinc-800 p-3">
            <div className="text-lg font-bold text-blue-400">{pct(match1X2.away)}</div>
            <div className="text-xs text-zinc-500">{awayTeam}</div>
            <div className="mt-1 text-sm font-mono text-zinc-400">{odds(match1X2.away)}</div>
          </div>
        </div>
        {/* Visual bar */}
        <div className="mt-3 flex h-3 overflow-hidden rounded-full">
          <div className="bg-green-500 transition-all" style={{ width: pct(match1X2.home) }} />
          <div className="bg-yellow-500 transition-all" style={{ width: pct(match1X2.draw) }} />
          <div className="bg-blue-500 transition-all" style={{ width: pct(match1X2.away) }} />
        </div>
      </div>

      {/* Over/Under */}
      <div className="rounded-xl bg-zinc-900 p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-400">Over/Under Goals</h3>
        <div className="space-y-2">
          {Object.entries(overUnder).map(([line, { over, under }]) => (
            <div key={line} className="flex items-center gap-2 text-sm">
              <span className="w-10 text-zinc-500">{line}</span>
              <div className="flex flex-1 h-5 overflow-hidden rounded-full">
                <div className="bg-emerald-600 flex items-center justify-center text-[10px] font-bold"
                  style={{ width: pct(over) }}>
                  {(over * 100).toFixed(0)}
                </div>
                <div className="bg-red-600 flex items-center justify-center text-[10px] font-bold"
                  style={{ width: pct(under) }}>
                  {(under * 100).toFixed(0)}
                </div>
              </div>
              <span className="w-12 text-right font-mono text-zinc-400 text-xs">{odds(over)}</span>
              <span className="w-12 text-right font-mono text-zinc-400 text-xs">{odds(under)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* BTTS + Correct Score row */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl bg-zinc-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-400">Both Teams to Score</h3>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-lg bg-zinc-800 p-3">
              <div className="text-lg font-bold text-green-400">{pct(btts.yes)}</div>
              <div className="text-xs text-zinc-500">Yes ({odds(btts.yes)})</div>
            </div>
            <div className="rounded-lg bg-zinc-800 p-3">
              <div className="text-lg font-bold text-red-400">{pct(btts.no)}</div>
              <div className="text-xs text-zinc-500">No ({odds(btts.no)})</div>
            </div>
          </div>
        </div>

        <div className="rounded-xl bg-zinc-900 p-4">
          <h3 className="mb-3 text-sm font-medium text-zinc-400">Correct Score (Top 5)</h3>
          <div className="space-y-1">
            {correctScore.slice(0, 5).map((cs) => (
              <div key={cs.score} className="flex justify-between text-sm">
                <span className="font-mono font-medium">{cs.score}</span>
                <span className="text-zinc-400">{pct(cs.probability)} ({odds(cs.probability)})</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Asian Handicap */}
      <div className="rounded-xl bg-zinc-900 p-4">
        <h3 className="mb-3 text-sm font-medium text-zinc-400">Asian Handicap</h3>
        <div className="space-y-1 text-sm">
          {asianHandicap.map((ah) => (
            <div key={ah.line} className="flex items-center gap-2">
              <span className="w-12 text-zinc-500">{ah.line > 0 ? `+${ah.line}` : ah.line}</span>
              <div className="flex flex-1 h-4 overflow-hidden rounded-full">
                <div className="bg-green-600" style={{ width: pct(ah.homeProb) }} />
                <div className="bg-blue-600" style={{ width: pct(ah.awayProb) }} />
              </div>
              <span className="w-20 text-right text-xs text-zinc-400">
                {pct(ah.homeProb)} / {pct(ah.awayProb)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
