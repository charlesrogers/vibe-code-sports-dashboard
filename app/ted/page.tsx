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
  xGDPerMatch: number;
  qualityTier: "elite" | "good" | "average" | "poor" | "bad";
  persistentDefiance: boolean;
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
  betGrade: "A" | "B" | "C" | null;
  passReasons: string[];
  positiveFactors: string[];
  round: number | null;
  date: string;
}

interface TedData {
  league: string;
  usingVenueSplits: boolean;
  scrapedAt: string | null;
  teams: TeamVariance[];
  assessments: MatchAssessment[];
  bets: MatchAssessment[];
  rounds: number[];
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
      label: "Overperforming",
      className: "bg-red-900/50 text-red-400 border border-red-800",
    },
    weak_positive: {
      label: "Slightly Over",
      className: "bg-red-900/30 text-red-300 border border-red-900",
    },
    neutral: {
      label: "Fair",
      className: "bg-zinc-800 text-zinc-400 border border-zinc-700",
    },
    weak_negative: {
      label: "Slightly Under",
      className: "bg-green-900/30 text-green-300 border border-green-900",
    },
    strong_negative: {
      label: "Underperforming",
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
    return <span className="text-green-400 font-bold" title="Results should improve">&uarr;</span>;
  if (direction === "decline")
    return <span className="text-red-400 font-bold" title="Results should decline">&darr;</span>;
  return <span className="text-zinc-500" title="Stable">&mdash;</span>;
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

function QualityBadge({ tier }: { tier: TeamVariance["qualityTier"] }) {
  const config: Record<string, { label: string; className: string }> = {
    elite: { label: "Elite", className: "text-purple-400 bg-purple-900/30" },
    good: { label: "Good", className: "text-blue-400 bg-blue-900/30" },
    average: { label: "Avg", className: "text-zinc-400 bg-zinc-800" },
    poor: { label: "Poor", className: "text-orange-400 bg-orange-900/30" },
    bad: { label: "Bad", className: "text-red-400 bg-red-900/30" },
  };
  const c = config[tier] || config.average;
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-semibold ${c.className}`}>
      {c.label}
    </span>
  );
}

function VarianceColor({ value, inverted }: { value: number; inverted?: boolean }) {
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

function MatchCard({ match, showVerdict }: { match: MatchAssessment; showVerdict: boolean }) {
  const edgeAbs = Math.abs(match.varianceEdge);
  const edgePct = (edgeAbs * 100).toFixed(1);

  return (
    <div className={`rounded-xl p-4 ${match.hasBet ? "bg-zinc-900 ring-1 ring-green-900/50" : "bg-zinc-900/60"}`}>
      {/* Date */}
      <div className="mb-2 text-[10px] text-zinc-500">{match.date}</div>

      {/* Teams */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex-1 text-right flex items-center justify-end gap-1.5">
          <QualityBadge tier={match.homeVariance.qualityTier} />
          <span className={`font-medium ${match.betSide === "home" ? "text-green-400" : "text-zinc-200"}`}>
            {match.homeTeam}
          </span>
        </div>
        <div className="mx-3 text-xs text-zinc-600">vs</div>
        <div className="flex-1 flex items-center gap-1.5">
          <span className={`font-medium ${match.betSide === "away" ? "text-green-400" : "text-zinc-200"}`}>
            {match.awayTeam}
          </span>
          <QualityBadge tier={match.awayVariance.qualityTier} />
        </div>
      </div>

      {/* Variance bars side by side */}
      <div className="mb-3 grid grid-cols-2 gap-3 text-[11px]">
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-zinc-500">Atk variance</span>
            <VarianceColor value={match.homeVariance.attackVariance} />
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Def variance</span>
            <VarianceColor value={match.homeVariance.defenseVariance} inverted />
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Total</span>
            <span className={`font-mono font-bold ${Math.abs(match.homeVariance.totalVariance) < 3 ? "text-zinc-400" : match.homeVariance.totalVariance > 0 ? "text-red-400" : "text-green-400"}`}>
              {match.homeVariance.totalVariance > 0 ? "+" : ""}{match.homeVariance.totalVariance.toFixed(1)}
            </span>
          </div>
          <SignalBadge signal={match.homeVariance.signal} />
        </div>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-zinc-500">Atk variance</span>
            <VarianceColor value={match.awayVariance.attackVariance} />
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Def variance</span>
            <VarianceColor value={match.awayVariance.defenseVariance} inverted />
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-500">Total</span>
            <span className={`font-mono font-bold ${Math.abs(match.awayVariance.totalVariance) < 3 ? "text-zinc-400" : match.awayVariance.totalVariance > 0 ? "text-red-400" : "text-green-400"}`}>
              {match.awayVariance.totalVariance > 0 ? "+" : ""}{match.awayVariance.totalVariance.toFixed(1)}
            </span>
          </div>
          <SignalBadge signal={match.awayVariance.signal} />
        </div>
      </div>

      {/* Verdict */}
      {showVerdict && (
        <div className={`rounded-lg p-3 text-xs leading-relaxed ${match.hasBet ? "bg-green-950/30 border border-green-900/40" : "bg-zinc-800/50"}`}>
          {match.hasBet ? (
            <>
              <div className="mb-1 flex items-center gap-2 flex-wrap">
                <span className="rounded bg-green-900/60 px-2 py-0.5 text-[10px] font-bold text-green-400">
                  BET {match.betSide?.toUpperCase()}
                </span>
                {match.betGrade && (
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    match.betGrade === "A" ? "bg-purple-900/50 text-purple-400"
                      : match.betGrade === "B" ? "bg-blue-900/50 text-blue-400"
                      : "bg-zinc-800 text-zinc-400"
                  }`}>
                    Grade {match.betGrade}
                  </span>
                )}
                <span className="font-mono text-green-400">{edgePct}% edge</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                  match.edgeMagnitude === "strong" ? "bg-green-900/50 text-green-400"
                    : match.edgeMagnitude === "moderate" ? "bg-yellow-900/50 text-yellow-400"
                    : "bg-zinc-800 text-zinc-400"
                }`}>
                  {match.edgeMagnitude}
                </span>
                <ConfidenceBar value={match.confidence} />
              </div>
              {match.positiveFactors && match.positiveFactors.length > 0 && (
                <ul className="mb-2 space-y-0.5 text-[11px]">
                  {match.positiveFactors.map((factor, i) => (
                    <li key={i} className="text-green-400/70">+ {factor}</li>
                  ))}
                </ul>
              )}
              <p className="text-zinc-300">{match.betReasoning}</p>
            </>
          ) : (
            <div className="text-zinc-500">
              <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] font-semibold text-zinc-400 mr-2">PASS</span>
              {match.passReasons && match.passReasons.length > 0 ? (
                <ul className="mt-1 ml-2 space-y-0.5 text-[11px]">
                  {match.passReasons.map((reason, i) => (
                    <li key={i} className="text-zinc-500">&bull; {reason}</li>
                  ))}
                </ul>
              ) : (
                match.betReasoning
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function TedPage() {
  const [data, setData] = useState<TedData | null>(null);
  const [league, setLeague] = useState("serieA");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [showTable, setShowTable] = useState(false);

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
        const json: TedData = await res.json();
        setData(json);
        // Auto-select first round
        if (json.rounds.length > 0) {
          setSelectedRound(json.rounds[0]);
        }
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

  // Filter to selected round
  const roundMatches = selectedRound
    ? data.assessments.filter((a) => a.round === selectedRound)
    : data.assessments;
  const roundBets = roundMatches.filter((a) => a.hasBet);

  // Navigate rounds
  const roundIdx = data.rounds.indexOf(selectedRound ?? -1);
  const prevRound = roundIdx > 0 ? data.rounds[roundIdx - 1] : null;
  const nextRound = roundIdx < data.rounds.length - 1 ? data.rounds[roundIdx + 1] : null;

  return (
    <div>
      {/* Header */}
      <div className="mb-2 flex items-start justify-between">
        <div>
          <div className="mb-1 text-sm text-zinc-400">
            Variance Betting Model for {leagueLabel} 2025-26
          </div>
          <div className="text-[11px] text-zinc-600">
            Identifies regression-to-mean opportunities. Green = underperforming xG (due to improve). Red = overperforming (due to decline).
          </div>
          {data.usingVenueSplits ? (
            <div className="mt-1 text-[10px] text-green-600">
              Using home/away xG splits (scraped {data.scrapedAt ? new Date(data.scrapedAt).toLocaleDateString() : "recently"})
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-yellow-600">
              Using overall xG (run scrape-understat.js for venue splits)
            </div>
          )}
        </div>
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="shrink-0 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
        >
          {showGuide ? "Hide" : "How to use"}
        </button>
      </div>

      {/* How to use guide */}
      {showGuide && (
        <div className="mb-6 rounded-xl bg-zinc-900 p-4 text-xs leading-relaxed text-zinc-300 space-y-3 border border-zinc-800">
          <h3 className="text-sm font-medium text-white">How to Read This Page</h3>
          <div>
            <span className="font-medium text-blue-400">1. Pick a matchday</span> using the arrows or dropdown below. Each matchday shows the actual fixtures for that round.
          </div>
          <div>
            <span className="font-medium text-blue-400">2. Read the variance numbers.</span> Each team has attack variance (goals vs xG) and defense variance (goals conceded vs xGA):
            <ul className="mt-1 ml-4 space-y-1 text-zinc-400">
              <li><span className="text-green-400">Green negative</span> = underperforming (scoring fewer than xG, or conceding fewer than xGA). Results should <strong>improve</strong>.</li>
              <li><span className="text-red-400">Red positive</span> = overperforming (scoring more than xG, or conceding more than xGA). Results should <strong>decline</strong>.</li>
              <li><span className="text-zinc-400">Grey</span> = within normal range, no signal.</li>
            </ul>
          </div>
          <div>
            <span className="font-medium text-blue-400">3. Look at the verdict.</span> Each match gets BET or PASS:
            <ul className="mt-1 ml-4 space-y-1 text-zinc-400">
              <li><span className="text-green-400 font-bold">BET</span> = edge {"\u2265"} 4%, confidence high. The favored side is due for positive regression while their opponent is due for negative regression.</li>
              <li><span className="text-zinc-400">PASS</span> = no meaningful edge, or both teams have similar variance profiles.</li>
            </ul>
          </div>
          <div>
            <span className="font-medium text-blue-400">4. Bet grades</span> tell you how many positive factors align:
            <ul className="mt-1 ml-4 space-y-1 text-zinc-400">
              <li><span className="text-purple-400 font-bold">Grade A</span> = 3+ factors align (classic Ted bet — good team, reliable signal type, opponent regressing too)</li>
              <li><span className="text-blue-400 font-bold">Grade B</span> = 2 factors (solid bet)</li>
              <li><span className="text-zinc-400 font-bold">Grade C</span> = 1 factor (marginal — be cautious)</li>
            </ul>
          </div>
          <div>
            <span className="font-medium text-blue-400">5. Key insight from Ted Knutson:</span> Defensive underperformance (conceding way more than xGA) is the <strong>most reliable</strong> regression signal. Attack overperformance (scoring way more than xG) is <strong>fragile</strong> and regresses fast. Only bet ~30% of matches. A bad team with bad xG AND bad results isn&apos;t unlucky — they&apos;re just bad.
          </div>
        </div>
      )}

      {/* Controls row */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <LeagueSelector value={league} onChange={setLeague} />

        {/* Round navigator */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => prevRound && setSelectedRound(prevRound)}
            disabled={!prevRound}
            className="rounded-lg bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            &larr;
          </button>
          <select
            value={selectedRound ?? ""}
            onChange={(e) => setSelectedRound(parseInt(e.target.value))}
            className="rounded-lg bg-zinc-800 px-3 py-1.5 text-sm text-white outline-none"
          >
            {data.rounds.map((r) => {
              const rMatches = data.assessments.filter((a) => a.round === r);
              const rBets = rMatches.filter((a) => a.hasBet);
              return (
                <option key={r} value={r}>
                  Matchday {r} ({rMatches.length} matches{rBets.length > 0 ? `, ${rBets.length} bet${rBets.length > 1 ? "s" : ""}` : ""})
                </option>
              );
            })}
          </select>
          <button
            onClick={() => nextRound && setSelectedRound(nextRound)}
            disabled={!nextRound}
            className="rounded-lg bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-400 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            &rarr;
          </button>
        </div>

        <button
          onClick={() => setShowTable(!showTable)}
          className="ml-auto rounded-lg bg-zinc-800 px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
        >
          {showTable ? "Hide table" : "Show full table"}
        </button>
      </div>

      {/* Round summary */}
      <div className="mb-4 grid grid-cols-3 gap-3">
        <div className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xl font-bold text-purple-400">{roundMatches.length}</div>
          <div className="text-[10px] text-zinc-500">Matches This Round</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xl font-bold text-green-400">{roundBets.length}</div>
          <div className="text-[10px] text-zinc-500">Variance Bets</div>
        </div>
        <div className="rounded-xl bg-zinc-900 p-3 text-center">
          <div className="text-xl font-bold text-yellow-400">
            {roundMatches.length > 0 ? Math.round((roundBets.length / roundMatches.length) * 100) : 0}%
          </div>
          <div className="text-[10px] text-zinc-500">Selectivity</div>
        </div>
      </div>

      {/* Bet cards first (if any) */}
      {roundBets.length > 0 && (
        <div className="mb-4">
          <h2 className="mb-2 text-sm font-medium text-green-400">
            Variance Bets &mdash; Matchday {selectedRound}
          </h2>
          <div className="space-y-3">
            {roundBets.map((match, i) => (
              <MatchCard key={i} match={match} showVerdict />
            ))}
          </div>
        </div>
      )}

      {/* All matches for the round */}
      <div className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-zinc-400">
          {roundBets.length > 0 ? "Other Matches" : "All Matches"} &mdash; Matchday {selectedRound}
        </h2>
        <div className="space-y-2">
          {roundMatches
            .filter((m) => !m.hasBet)
            .map((match, i) => (
              <MatchCard key={i} match={match} showVerdict />
            ))}
        </div>
        {roundMatches.filter((m) => !m.hasBet).length === 0 && roundBets.length > 0 && (
          <div className="rounded-xl bg-zinc-900/40 p-4 text-center text-xs text-zinc-500">
            Every match this round has a variance bet. Unusual selectivity &mdash; consider being more cautious.
          </div>
        )}
      </div>

      {/* Team variance table (collapsible) */}
      {showTable && (
        <div className="mb-4">
          <h2 className="mb-3 text-sm font-medium text-zinc-400">
            Full Team Variance Table
          </h2>
          <div className="overflow-x-auto rounded-xl bg-zinc-900 p-3">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-zinc-500">
                  <th className="pb-2 pr-3">Team</th>
                  <th className="pb-2 px-2 text-center">Quality</th>
                  <th className="pb-2 px-2 text-right">xGD/m</th>
                  <th className="pb-2 px-2 text-right">Atk Var</th>
                  <th className="pb-2 px-2 text-right">Def Var</th>
                  <th className="pb-2 px-2 text-right">Total</th>
                  <th className="pb-2 px-2 text-center">Signal</th>
                  <th className="pb-2 px-2 text-center">Dir</th>
                  <th className="pb-2 px-2">Confidence</th>
                  <th className="pb-2 px-2 text-center">Flags</th>
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
                    <td className="py-2 px-2 text-center">
                      <QualityBadge tier={t.qualityTier} />
                    </td>
                    <td className="py-2 px-2 text-right font-mono text-zinc-400">
                      {t.xGDPerMatch > 0 ? "+" : ""}{t.xGDPerMatch.toFixed(2)}
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
                    <td className="py-2 px-2 text-center text-[10px]">
                      {t.persistentDefiance && (
                        <span className="text-yellow-500" title="15+ matches without correction">PD</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-600">
        Variance model based on Ted Knutson&apos;s methodology. xG data from Fotmob.
        Attack variance = goals minus xG. Defense variance = goals conceded minus xGA.
        Green = regression favorable (results should improve). Red = regression unfavorable (results should decline).
      </p>
    </div>
  );
}
