"use client";

import { useState, useEffect } from "react";
import LeagueSelector from "../components/league-selector";

interface TeamVariance {
  team: string;
  matches: number;
  xG: number;
  goals: number;
  xGA: number;
  goalsConceded: number;
  xGD: number;
  actualGD: number;
  attackVariance: number;
  defenseVariance: number;
  totalVariance: number;
  attackVariancePct: number;
  defenseVariancePct: number;
  signal:
    | "strong_positive"
    | "weak_positive"
    | "neutral"
    | "weak_negative"
    | "strong_negative";
  dominantType: string;
  regressionConfidence: number;
  regressionDirection: "improve" | "decline" | "stable";
  explanation: string;
}

interface MatchAssessment {
  homeTeam: string;
  awayTeam: string;
  homeVariance: TeamVariance;
  awayVariance: TeamVariance;
  varianceEdge: number;
  edgeSide: "home" | "away" | "neutral";
  edgeMagnitude: "strong" | "moderate" | "weak" | "none";
  hasBet: boolean;
  betSide: string | null;
  betReasoning: string;
  confidence: number;
}

interface TedData {
  league: string;
  teams: TeamVariance[];
  assessments: MatchAssessment[];
  bets: MatchAssessment[];
  summary: {
    teamsAnalyzed: number;
    matchesAssessed: number;
    betsFound: number;
    selectivity: number;
  };
}

function SignalBadge({ signal }: { signal: TeamVariance["signal"] }) {
  const config: Record<string, { label: string; className: string }> = {
    strong_positive: {
      label: "Strong +",
      className: "bg-red-900/50 text-red-400 border border-red-800",
    },
    weak_positive: {
      label: "Weak +",
      className: "bg-red-900/30 text-red-300 border border-red-900",
    },
    neutral: {
      label: "Neutral",
      className: "bg-zinc-800 text-zinc-400 border border-zinc-700",
    },
    weak_negative: {
      label: "Weak -",
      className: "bg-green-900/30 text-green-300 border border-green-900",
    },
    strong_negative: {
      label: "Strong -",
      className: "bg-green-900/50 text-green-400 border border-green-800",
    },
  };
  const c = config[signal] || config.neutral;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.className}`}
    >
      {c.label}
    </span>
  );
}

function DirectionArrow({
  direction,
}: {
  direction: TeamVariance["regressionDirection"];
}) {
  if (direction === "improve")
    return <span className="text-green-400 font-bold">&uarr;</span>;
  if (direction === "decline")
    return <span className="text-red-400 font-bold">&darr;</span>;
  return <span className="text-zinc-500">&mdash;</span>;
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 70
      ? "bg-green-500"
      : pct >= 50
        ? "bg-yellow-500"
        : "bg-zinc-600";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-16 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="font-mono text-[10px] text-zinc-400">{pct}%</span>
    </div>
  );
}

function VarianceColor({ value, inverted }: { value: number; inverted?: boolean }) {
  // For attack: positive = overperforming (will regress DOWN = bad = red)
  // For defense: positive = conceding more than expected (bad = red), negative = conceding less (good = green)
  // inverted flips the color logic (used for defense where negative is good)
  const effective = inverted ? -value : value;
  const color =
    Math.abs(value) < 1
      ? "text-zinc-400"
      : effective > 0
        ? "text-red-400"
        : "text-green-400";
  return (
    <span className={`font-mono ${color}`}>
      {value > 0 ? "+" : ""}
      {value.toFixed(1)}
    </span>
  );
}

export default function TedPage() {
  const [data, setData] = useState<TedData | null>(null);
  const [league, setLeague] = useState("serieA");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/ted?league=${league}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        const json = await res.json();
        setData(json);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [league]);

  if (loading) {
    return (
      <div className="py-20 text-center text-zinc-500">
        Running variance analysis...
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center text-red-400">
        Error: {error}
      </div>
    );
  }

  if (!data) return null;

  const leagueLabel = league === "serieB" ? "Serie B" : "Serie A";

  return (
    <div>
      <div className="mb-4 text-sm text-zinc-400">
        Ted Knutson&apos;s variance betting model for {leagueLabel} 2025-26.
        Identifies regression-to-mean opportunities by decomposing attack and
        defense variance from xG expectations.
      </div>

      {/* Controls */}
      <div className="mb-6">
        <LeagueSelector value={league} onChange={setLeague} />
      </div>

      {/* Section 1: Model Summary */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xl font-bold text-blue-400">
            {data.summary.teamsAnalyzed}
          </div>
          <div className="text-[10px] text-zinc-500">Teams Analyzed</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xl font-bold text-purple-400">
            {data.summary.matchesAssessed}
          </div>
          <div className="text-[10px] text-zinc-500">Matches Assessed</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xl font-bold text-green-400">
            {data.summary.betsFound}
          </div>
          <div className="text-[10px] text-zinc-500">Bets Found</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xl font-bold text-yellow-400">
            {data.summary.selectivity}%
          </div>
          <div className="text-[10px] text-zinc-500">Selectivity</div>
        </div>
      </div>

      {/* Section 2: Smart Bet Cards */}
      {data.bets.length > 0 && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">
            Variance Bets
          </h2>
          <div className="space-y-3">
            {data.bets.map((bet, i) => (
              <div key={i} className="rounded-xl bg-zinc-900 p-4">
                {/* Teams header */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex-1 text-right">
                    <span
                      className={`text-lg font-medium ${
                        bet.betSide === "home"
                          ? "text-green-400"
                          : "text-zinc-300"
                      }`}
                    >
                      {bet.homeTeam}
                    </span>
                  </div>
                  <div className="mx-4 text-sm text-zinc-500">vs</div>
                  <div className="flex-1">
                    <span
                      className={`text-lg font-medium ${
                        bet.betSide === "away"
                          ? "text-green-400"
                          : "text-zinc-300"
                      }`}
                    >
                      {bet.awayTeam}
                    </span>
                  </div>
                </div>

                {/* Variance breakdown */}
                <div className="mb-3 grid grid-cols-2 gap-4 text-xs">
                  <div>
                    <div className="mb-1 text-zinc-500">{bet.homeTeam}</div>
                    <div className="flex gap-3">
                      <div>
                        <span className="text-zinc-500">Atk: </span>
                        <VarianceColor value={bet.homeVariance.attackVariance} />
                      </div>
                      <div>
                        <span className="text-zinc-500">Def: </span>
                        <VarianceColor
                          value={bet.homeVariance.defenseVariance}
                          inverted
                        />
                      </div>
                    </div>
                    <div className="mt-1">
                      <SignalBadge signal={bet.homeVariance.signal} />
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-zinc-500">{bet.awayTeam}</div>
                    <div className="flex gap-3">
                      <div>
                        <span className="text-zinc-500">Atk: </span>
                        <VarianceColor value={bet.awayVariance.attackVariance} />
                      </div>
                      <div>
                        <span className="text-zinc-500">Def: </span>
                        <VarianceColor
                          value={bet.awayVariance.defenseVariance}
                          inverted
                        />
                      </div>
                    </div>
                    <div className="mt-1">
                      <SignalBadge signal={bet.awayVariance.signal} />
                    </div>
                  </div>
                </div>

                {/* Confidence & Edge */}
                <div className="mb-3 flex items-center gap-4 text-xs">
                  <div>
                    <span className="text-zinc-500">Edge: </span>
                    <span
                      className={`font-mono font-bold ${
                        bet.edgeMagnitude === "strong"
                          ? "text-green-400"
                          : bet.edgeMagnitude === "moderate"
                            ? "text-yellow-400"
                            : "text-zinc-300"
                      }`}
                    >
                      {(Math.abs(bet.varianceEdge) * 100).toFixed(1)}%
                    </span>
                    <span
                      className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        bet.edgeMagnitude === "strong"
                          ? "bg-green-900/50 text-green-400"
                          : bet.edgeMagnitude === "moderate"
                            ? "bg-yellow-900/50 text-yellow-400"
                            : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {bet.edgeMagnitude}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-zinc-500">Confidence:</span>
                    <ConfidenceBar value={bet.confidence} />
                  </div>
                </div>

                {/* Reasoning */}
                <div className="rounded-lg bg-zinc-800/50 p-3 text-xs leading-relaxed text-zinc-300">
                  {bet.betReasoning}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data.bets.length === 0 && (
        <div className="mb-8 rounded-xl bg-zinc-900 p-6 text-center">
          <div className="text-lg font-medium text-zinc-400">
            No variance bets found
          </div>
          <div className="mt-1 text-xs text-zinc-500">
            Discipline is the edge. Only ~30% of matches should have a bet.
          </div>
        </div>
      )}

      {/* Section 3: Team Variance Table */}
      <div className="mb-4">
        <h2 className="mb-3 text-sm font-medium text-zinc-400">
          Team Variance Table
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-left text-zinc-500">
                <th className="pb-2 pr-3">Team</th>
                <th className="pb-2 px-2 text-right">xG</th>
                <th className="pb-2 px-2 text-right">G</th>
                <th className="pb-2 px-2 text-right">xGA</th>
                <th className="pb-2 px-2 text-right">GA</th>
                <th className="pb-2 px-2 text-right">Atk Var</th>
                <th className="pb-2 px-2 text-right">Def Var</th>
                <th className="pb-2 px-2 text-right">Total</th>
                <th className="pb-2 px-2 text-center">Signal</th>
                <th className="pb-2 px-2 text-center">Dir</th>
                <th className="pb-2 px-2">Confidence</th>
              </tr>
            </thead>
            <tbody>
              {data.teams.map((t) => (
                <tr
                  key={t.team}
                  className="border-b border-zinc-800/50 hover:bg-zinc-800/30"
                >
                  <td className="py-2 pr-3 font-medium text-zinc-200 whitespace-nowrap">
                    {t.team}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-zinc-400">
                    {t.xG.toFixed(1)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-zinc-300">
                    {t.goals}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-zinc-400">
                    {t.xGA.toFixed(1)}
                  </td>
                  <td className="py-2 px-2 text-right font-mono text-zinc-300">
                    {t.goalsConceded}
                  </td>
                  <td className="py-2 px-2 text-right">
                    <VarianceColor value={t.attackVariance} />
                  </td>
                  <td className="py-2 px-2 text-right">
                    <VarianceColor value={t.defenseVariance} inverted />
                  </td>
                  <td className="py-2 px-2 text-right">
                    <span
                      className={`font-mono font-bold ${
                        Math.abs(t.totalVariance) < 3
                          ? "text-zinc-400"
                          : t.totalVariance > 0
                            ? "text-red-400"
                            : "text-green-400"
                      }`}
                    >
                      {t.totalVariance > 0 ? "+" : ""}
                      {t.totalVariance.toFixed(1)}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center">
                    <SignalBadge signal={t.signal} />
                  </td>
                  <td className="py-2 px-2 text-center">
                    <DirectionArrow direction={t.regressionDirection} />
                  </td>
                  <td className="py-2 px-2">
                    <ConfidenceBar value={t.regressionConfidence} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-zinc-600">
        Based on Ted Knutson&apos;s variance model. Attack variance: goals minus
        xG (red = overperforming, will regress down). Defense variance:
        goals conceded minus xGA (red = underperforming defensively, reliable
        regression signal). Signal colors: green = regression favorable
        (results should improve), red = regression unfavorable (results should
        decline).
      </p>
    </div>
  );
}
