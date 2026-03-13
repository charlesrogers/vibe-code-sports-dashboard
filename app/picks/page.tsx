"use client";

import { useState, useEffect, useCallback } from "react";

interface BookOddsEntry {
  book: string;
  bookKey: string;
  odds: number;
}

interface PickValueBet {
  marketType: "1X2" | "AH";
  selection: string;
  ahLine?: number;
  modelProb: number;
  marketProb: number;
  edge: number;
  fairOdds: number;
  marketOdds: number;
  bestBooks?: BookOddsEntry[];
}

interface VarianceSummary {
  isCandidate: boolean;
  gfGap: number;
  gaGap: number;
  direction: string;
}

interface Pick {
  matchId: string;
  league: string;
  leagueLabel: string;
  date: string;
  kickoff: string;
  homeTeam: string;
  awayTeam: string;
  prediction: {
    homeProb: number;
    drawProb: number;
    awayProb: number;
    expectedGoals: { home: number; away: number; total: number };
    mostLikelyScore: { home: number; away: number; prob: number };
  };
  pinnacleOdds: { home: number; draw: number; away: number } | null;
  fairOdds: { home: number; draw: number; away: number };
  valueBets: PickValueBet[];
  tedVerdict: "BET" | "PASS";
  tedReason: string | null;
  tedReasonLabel: string;
  grade: "A" | "B" | "C" | null;
  bestEdge: number;
  homeVariance: VarianceSummary | null;
  awayVariance: VarianceSummary | null;
  injuries?: {
    home: { severity: string; summary: string; totalOut: number } | null;
    away: { severity: string; summary: string; totalOut: number } | null;
    adjusted: boolean;
  };
  ensemble?: {
    dixonColes: { home: number; draw: number; away: number };
    elo: { home: number; draw: number; away: number; homeRating: number; awayRating: number };
    consensus: { home: number; draw: number; away: number };
    agreement: "strong" | "moderate" | "split";
  };
  tedAssessment?: {
    betGrade: "A" | "B" | "C" | null;
    confidence: number;
    edgeSide: "home" | "away" | "neutral";
    varianceEdge: number;
    positiveFactors: string[];
    passReasons: string[];
  };
  xg?: {
    home: { xGFor: number; xGAgainst: number; overperformance: number } | null;
    away: { xGFor: number; xGAgainst: number; overperformance: number } | null;
  };
  gkContext?: {
    home: { player: string; goalsPrevented: number; goalsPreventedPer90: number; matchesPlayed: number } | null;
    away: { player: string; goalsPrevented: number; goalsPreventedPer90: number; matchesPlayed: number } | null;
  };
  gkAdjustment?: {
    homeGKAdj: number;
    awayGKAdj: number;
  };
  strengthOfSchedule?: {
    home: { avgOpponentElo: number; last5Opponents: string[] } | null;
    away: { avgOpponentElo: number; last5Opponents: string[] } | null;
    leagueAvgElo: number;
  };
  managerContext?: {
    home: { name: string; isNewThisSeason: boolean; isMidSeasonChange: boolean; seasonRecord: { win: number; draw: number; loss: number } | null; previousManager: string | null } | null;
    away: { name: string; isNewThisSeason: boolean; isMidSeasonChange: boolean; seasonRecord: { win: number; draw: number; loss: number } | null; previousManager: string | null } | null;
    recentChanges: boolean;
  };
  activeSignals?: string[];
  isPostBreak?: boolean;
  isDerby?: boolean;
}

interface PicksSummary {
  generatedAt: string;
  leagues: string[];
  totalMatches: number;
  totalBets: number;
  avgEdge: number;
  byLeague: Record<string, { matches: number; bets: number; avgEdge: number }>;
  byGrade: Record<string, number>;
}

const LEAGUE_LABELS: Record<string, string> = {
  epl: "EPL",
  "la-liga": "La Liga",
  bundesliga: "Bundesliga",
  "serie-a": "Serie A",
  "serie-b": "Serie B",
  "ligue-1": "Ligue 1",
};

function GradeBadge({ grade }: { grade: "A" | "B" | "C" | null }) {
  if (!grade) return null;
  const styles: Record<string, string> = {
    A: "bg-green-900/60 text-green-400 border-green-700",
    B: "bg-blue-900/60 text-blue-400 border-blue-700",
    C: "bg-zinc-800 text-zinc-400 border-zinc-700",
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-bold border ${styles[grade]}`}>
      {grade}
    </span>
  );
}

function VerdictBadge({ verdict }: { verdict: "BET" | "PASS" }) {
  return verdict === "BET" ? (
    <span className="inline-block rounded bg-green-900/50 px-2 py-0.5 text-xs font-bold text-green-400 border border-green-800">
      BET
    </span>
  ) : (
    <span className="inline-block rounded bg-zinc-800 px-2 py-0.5 text-xs font-medium text-zinc-500 border border-zinc-700">
      PASS
    </span>
  );
}

function ProbBar({ label, prob, fair, market }: { label: string; prob: number; fair: number; market?: number }) {
  const pct = Math.min(prob, 100);
  const color = prob > 50 ? "bg-blue-500" : prob > 35 ? "bg-blue-600" : "bg-zinc-600";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 text-zinc-500">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-zinc-800">
        <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-12 text-right font-mono text-zinc-300">{prob.toFixed(1)}%</span>
      <span className="w-10 text-right font-mono text-zinc-500">{fair.toFixed(2)}</span>
      {market !== undefined && (
        <span className="w-10 text-right font-mono text-zinc-600">{market.toFixed(2)}</span>
      )}
    </div>
  );
}

function VarianceTag({ variance, team }: { variance: VarianceSummary | null; team: string }) {
  if (!variance || !variance.isCandidate) return null;
  const isDefensive = variance.direction.includes("defensive");
  const color = isDefensive
    ? "text-amber-400 bg-amber-900/30 border-amber-800"
    : "text-purple-400 bg-purple-900/30 border-purple-800";
  return (
    <div className={`mt-1 rounded border px-2 py-1 text-[10px] ${color}`}>
      <span className="font-semibold">{team}</span>: {variance.direction}
      <span className="ml-1 text-zinc-500">
        (GF gap: {variance.gfGap > 0 ? "+" : ""}{variance.gfGap}, GA gap: {variance.gaGap > 0 ? "+" : ""}{variance.gaGap})
      </span>
    </div>
  );
}

function InjuryBadge({ severity, team, summary, totalOut }: { severity: string; team: string; summary: string; totalOut: number }) {
  if (severity === "none" || severity === "minor") return null;
  const styles: Record<string, string> = {
    moderate: "text-yellow-400 bg-yellow-900/30 border-yellow-800",
    major: "text-orange-400 bg-orange-900/30 border-orange-800",
    crisis: "text-red-400 bg-red-900/30 border-red-800",
  };
  return (
    <div className={`rounded border px-2 py-1 text-[10px] ${styles[severity] || styles.moderate}`}>
      <span className="font-semibold">{team}</span>: {totalOut} out
      <span className="ml-1 capitalize">({severity})</span>
      <div className="text-zinc-500 mt-0.5 truncate">{summary}</div>
    </div>
  );
}

function AgreementBadge({ agreement }: { agreement: "strong" | "moderate" | "split" }) {
  const styles = {
    strong: "bg-green-900/50 text-green-400 border-green-800",
    moderate: "bg-yellow-900/50 text-yellow-400 border-yellow-800",
    split: "bg-red-900/50 text-red-400 border-red-800",
  };
  const labels = { strong: "3/3 Agree", moderate: "2/3", split: "Split" };
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold border ${styles[agreement]}`}>
      {labels[agreement]}
    </span>
  );
}

function ConsensusRow({ pick }: { pick: Pick }) {
  if (!pick.ensemble) return null;
  const { dixonColes: dc, elo, consensus, agreement } = pick.ensemble;
  const mi = pick.prediction;
  const fav = consensus.home >= consensus.away ? "home" : "away";
  return (
    <div className="mb-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-zinc-500 font-semibold uppercase">Model Consensus</span>
        <AgreementBadge agreement={agreement} />
      </div>
      <div className="grid grid-cols-4 gap-1 text-[10px]">
        <div className="text-zinc-600" />
        <div className="text-center text-zinc-500">MI</div>
        <div className="text-center text-zinc-500">DC</div>
        <div className="text-center text-zinc-500">Elo</div>
        <div className="text-zinc-400">Home</div>
        <div className={`text-center font-mono ${fav === "home" ? "text-blue-400" : "text-zinc-400"}`}>{mi.homeProb.toFixed(0)}%</div>
        <div className={`text-center font-mono ${fav === "home" ? "text-blue-400" : "text-zinc-400"}`}>{(dc.home * 100).toFixed(0)}%</div>
        <div className={`text-center font-mono ${fav === "home" ? "text-blue-400" : "text-zinc-400"}`}>{(elo.home * 100).toFixed(0)}%</div>
        <div className="text-zinc-400">Draw</div>
        <div className="text-center font-mono text-zinc-500">{mi.drawProb.toFixed(0)}%</div>
        <div className="text-center font-mono text-zinc-500">{(dc.draw * 100).toFixed(0)}%</div>
        <div className="text-center font-mono text-zinc-500">{(elo.draw * 100).toFixed(0)}%</div>
        <div className="text-zinc-400">Away</div>
        <div className={`text-center font-mono ${fav === "away" ? "text-blue-400" : "text-zinc-400"}`}>{mi.awayProb.toFixed(0)}%</div>
        <div className={`text-center font-mono ${fav === "away" ? "text-blue-400" : "text-zinc-400"}`}>{(dc.away * 100).toFixed(0)}%</div>
        <div className={`text-center font-mono ${fav === "away" ? "text-blue-400" : "text-zinc-400"}`}>{(elo.away * 100).toFixed(0)}%</div>
      </div>
    </div>
  );
}

function XgRow({ pick }: { pick: Pick }) {
  if (!pick.xg) return null;
  const { home, away } = pick.xg;
  if (!home && !away) return null;
  return (
    <div className="mb-2 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 text-[10px]">
      <span className="text-zinc-500 font-semibold uppercase">xG</span>
      <div className="flex-1 flex items-center gap-1">
        {home ? (
          <span className="font-mono text-zinc-300">
            {home.xGFor.toFixed(1)}/{home.xGAgainst.toFixed(1)}
            <span className={`ml-0.5 ${home.overperformance > 0 ? "text-green-500" : "text-red-500"}`}>
              {home.overperformance > 0 ? "+" : ""}{home.overperformance.toFixed(1)}
            </span>
          </span>
        ) : <span className="text-zinc-700">—</span>}
        <span className="text-zinc-700">vs</span>
        {away ? (
          <span className="font-mono text-zinc-300">
            {away.xGFor.toFixed(1)}/{away.xGAgainst.toFixed(1)}
            <span className={`ml-0.5 ${away.overperformance > 0 ? "text-green-500" : "text-red-500"}`}>
              {away.overperformance > 0 ? "+" : ""}{away.overperformance.toFixed(1)}
            </span>
          </span>
        ) : <span className="text-zinc-700">—</span>}
      </div>
    </div>
  );
}

function GKIndicator({ gk, team }: { gk: { player: string; goalsPrevented: number; goalsPreventedPer90: number; matchesPlayed: number }; team: string }) {
  const gp = gk.goalsPrevented;
  const color = gp > 2 ? "text-green-400" : gp < -2 ? "text-red-400" : "text-zinc-400";
  const label = gp > 2 ? "Elite" : gp < -2 ? "Poor" : "Avg";
  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="text-zinc-500">{team}:</span>
      <span className={`font-mono ${color}`}>{gp > 0 ? "+" : ""}{gp.toFixed(1)}</span>
      <span className="text-zinc-600">({label})</span>
    </span>
  );
}

function GKRow({ pick }: { pick: Pick }) {
  if (!pick.gkContext) return null;
  const { home, away } = pick.gkContext;
  if (!home && !away) return null;
  const adj = pick.gkAdjustment;
  return (
    <div className="mb-2 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 text-[10px]">
      <span className="text-zinc-500 font-semibold uppercase">GK</span>
      <div className="flex-1 flex items-center gap-3">
        {home ? <GKIndicator gk={home} team={pick.homeTeam.split(" ")[0]} /> : <span className="text-zinc-700">--</span>}
        {away ? <GKIndicator gk={away} team={pick.awayTeam.split(" ")[0]} /> : <span className="text-zinc-700">--</span>}
      </div>
      {adj && (adj.homeGKAdj !== 1 || adj.awayGKAdj !== 1) && (
        <span className="text-amber-500/80 font-mono" title="Lambda adjustment from GK quality (homeGKAdj affects home scoring, awayGKAdj affects away scoring)">
          xG adj: {adj.homeGKAdj !== 1 ? `H×${adj.homeGKAdj.toFixed(2)}` : ""}{adj.homeGKAdj !== 1 && adj.awayGKAdj !== 1 ? " " : ""}{adj.awayGKAdj !== 1 ? `A×${adj.awayGKAdj.toFixed(2)}` : ""}
        </span>
      )}
    </div>
  );
}

function SoSRow({ pick }: { pick: Pick }) {
  if (!pick.strengthOfSchedule) return null;
  const { home, away, leagueAvgElo } = pick.strengthOfSchedule;
  if (!home && !away) return null;

  function sosLabel(avgElo: number, leagueAvg: number) {
    const diff = avgElo - leagueAvg;
    if (diff > 40) return { label: "Hard", color: "text-red-400" };
    if (diff > 15) return { label: "Above avg", color: "text-orange-400" };
    if (diff < -40) return { label: "Easy", color: "text-green-400" };
    if (diff < -15) return { label: "Below avg", color: "text-blue-400" };
    return { label: "Avg", color: "text-zinc-400" };
  }

  return (
    <div className="mb-2 flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5 text-[10px]">
      <span className="text-zinc-500 font-semibold uppercase">SoS</span>
      <div className="flex-1 flex items-center gap-3">
        {home ? (() => {
          const s = sosLabel(home.avgOpponentElo, leagueAvgElo);
          return (
            <span className="inline-flex items-center gap-0.5">
              <span className="text-zinc-500">{pick.homeTeam.split(" ")[0]}:</span>
              <span className={`font-mono ${s.color}`}>{home.avgOpponentElo}</span>
              <span className="text-zinc-600">({s.label})</span>
            </span>
          );
        })() : <span className="text-zinc-700">--</span>}
        {away ? (() => {
          const s = sosLabel(away.avgOpponentElo, leagueAvgElo);
          return (
            <span className="inline-flex items-center gap-0.5">
              <span className="text-zinc-500">{pick.awayTeam.split(" ")[0]}:</span>
              <span className={`font-mono ${s.color}`}>{away.avgOpponentElo}</span>
              <span className="text-zinc-600">({s.label})</span>
            </span>
          );
        })() : <span className="text-zinc-700">--</span>}
        <span className="text-zinc-700">avg {leagueAvgElo}</span>
      </div>
    </div>
  );
}

function ManagerTag({ mgr, team }: { mgr: { name: string; isNewThisSeason: boolean; isMidSeasonChange: boolean; seasonRecord: { win: number; draw: number; loss: number } | null; previousManager: string | null }; team: string }) {
  if (!mgr.isNewThisSeason && !mgr.isMidSeasonChange) return null;
  const label = mgr.isMidSeasonChange ? "Mid-season change" : "New this season";
  const record = mgr.seasonRecord ? `W${mgr.seasonRecord.win} D${mgr.seasonRecord.draw} L${mgr.seasonRecord.loss}` : "";
  return (
    <div className="rounded border border-amber-800 bg-amber-900/30 px-2 py-1 text-[10px] text-amber-400">
      <span className="font-semibold">{team}</span>: {mgr.name} ({label})
      {mgr.previousManager && <span className="text-zinc-500 ml-1">replaced {mgr.previousManager}</span>}
      {record && <span className="text-zinc-500 ml-1">{record}</span>}
    </div>
  );
}

function TedAssessmentPanel({ pick }: { pick: Pick }) {
  const [expanded, setExpanded] = useState(false);
  if (!pick.tedAssessment) return null;
  const { betGrade, confidence, positiveFactors, passReasons } = pick.tedAssessment;
  const gradeStyles: Record<string, string> = {
    A: "bg-green-900/60 text-green-400 border-green-700",
    B: "bg-blue-900/60 text-blue-400 border-blue-700",
    C: "bg-zinc-800 text-zinc-400 border-zinc-700",
  };
  return (
    <div className="mb-2 rounded border border-zinc-800 bg-zinc-900/50 px-2 py-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between text-[10px]"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-zinc-500 font-semibold uppercase">Ted</span>
          {betGrade && (
            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold border ${gradeStyles[betGrade]}`}>
              {betGrade}
            </span>
          )}
          <span className="font-mono text-zinc-400">{(confidence * 100).toFixed(0)}%</span>
        </div>
        <span className="text-zinc-600">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-0.5 text-[10px]">
          {positiveFactors.map((f, i) => (
            <div key={i} className="text-green-500">+ {f}</div>
          ))}
          {passReasons.map((r, i) => (
            <div key={i} className="text-red-400">− {r}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function CLVBadge({ clv, status, profit }: { clv?: number; status: string; profit?: number }) {
  if (status === "pending") return null;
  return (
    <div className="mt-1 flex items-center gap-2 text-[10px]">
      <span className={`rounded px-1.5 py-0.5 font-bold border ${
        status === "won" ? "bg-green-900/30 text-green-400 border-green-800" :
        status === "lost" ? "bg-red-900/30 text-red-400 border-red-800" :
        "bg-zinc-800 text-zinc-400 border-zinc-700"
      }`}>{status.toUpperCase()}</span>
      {profit != null && (
        <span className={`font-mono ${profit >= 0 ? "text-green-400" : "text-red-400"}`}>
          {profit >= 0 ? "+" : ""}{profit.toFixed(1)}u
        </span>
      )}
      {clv != null && (
        <span className={`font-mono ${clv >= 0 ? "text-blue-400" : "text-red-400"}`}>
          CLV: {clv >= 0 ? "+" : ""}{(clv * 100).toFixed(1)}%
        </span>
      )}
    </div>
  );
}

interface PickCardProps {
  pick: Pick;
  onLogBet?: (pick: Pick, vb: PickValueBet) => void;
  loggingId?: string | null;
  isLogged?: (pick: Pick, vb: PickValueBet) => boolean;
  clvLookup?: Map<string, { clv?: number; status: string; profit?: number }>;
}

function PickCard({ pick, onLogBet, loggingId, isLogged, clvLookup }: PickCardProps) {
  const kickoff = new Date(pick.kickoff);
  const timeStr = kickoff.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className={`rounded-lg border p-4 ${
      pick.tedVerdict === "BET"
        ? "border-green-800/50 bg-zinc-900"
        : "border-zinc-800 bg-zinc-950"
    }`}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <VerdictBadge verdict={pick.tedVerdict} />
          {pick.grade && <GradeBadge grade={pick.grade} />}
          <span className="text-xs text-zinc-500">{LEAGUE_LABELS[pick.league] || pick.league}</span>
          {pick.isPostBreak && (
            <span className="inline-block rounded px-1.5 py-0.5 text-[9px] font-bold bg-amber-900/50 text-amber-400 border border-amber-800">
              Intl Break
            </span>
          )}
          {pick.isDerby && (
            <span className="inline-block rounded px-1.5 py-0.5 text-[9px] font-bold bg-red-900/50 text-red-400 border border-red-800">
              Derby
            </span>
          )}
        </div>
        <span className="text-xs text-zinc-600">{timeStr}</span>
      </div>

      {/* Teams */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-200">{pick.homeTeam}</div>
          <div className="text-sm text-zinc-400">vs {pick.awayTeam}</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500">
            xG{pick.injuries?.adjusted && <span className="text-orange-400 ml-1">(inj-adj)</span>}
          </div>
          <div className="font-mono text-sm text-zinc-300">
            {pick.prediction.expectedGoals.home.toFixed(1)} - {pick.prediction.expectedGoals.away.toFixed(1)}
          </div>
          <div className="text-[10px] text-zinc-600">
            Score: {pick.prediction.mostLikelyScore.home}-{pick.prediction.mostLikelyScore.away} ({pick.prediction.mostLikelyScore.prob.toFixed(1)}%)
          </div>
        </div>
      </div>

      {/* Probability bars */}
      <div className="mb-3 space-y-1">
        <div className="flex text-[10px] text-zinc-600 mb-0.5">
          <span className="w-10" />
          <span className="flex-1" />
          <span className="w-12 text-right">Model</span>
          <span className="w-10 text-right">Fair</span>
          {pick.pinnacleOdds && <span className="w-10 text-right">Mkt</span>}
        </div>
        <ProbBar
          label="H" prob={pick.prediction.homeProb} fair={pick.fairOdds.home}
          market={pick.pinnacleOdds?.home}
        />
        <ProbBar
          label="D" prob={pick.prediction.drawProb} fair={pick.fairOdds.draw}
          market={pick.pinnacleOdds?.draw}
        />
        <ProbBar
          label="A" prob={pick.prediction.awayProb} fair={pick.fairOdds.away}
          market={pick.pinnacleOdds?.away}
        />
      </div>

      {/* Ensemble consensus */}
      <ConsensusRow pick={pick} />

      {/* xG stats */}
      <XgRow pick={pick} />

      {/* GK PSxG+/- */}
      <GKRow pick={pick} />

      {/* Strength of Schedule */}
      <SoSRow pick={pick} />

      {/* Manager changes */}
      {pick.managerContext?.recentChanges && (
        <div className="mb-2 space-y-1">
          {pick.managerContext.home && <ManagerTag mgr={pick.managerContext.home} team={pick.homeTeam} />}
          {pick.managerContext.away && <ManagerTag mgr={pick.managerContext.away} team={pick.awayTeam} />}
        </div>
      )}

      {/* Ted assessment */}
      <TedAssessmentPanel pick={pick} />

      {/* Value bets with best books */}
      {pick.valueBets.length > 0 && (
        <div className="mb-2">
          {pick.valueBets.map((vb, i) => {
            const betKey = `${pick.matchId}_${vb.marketType}_${vb.selection}`;
            const logged = isLogged?.(pick, vb);
            const clvKey = `${pick.homeTeam}_${pick.awayTeam}_${pick.date}_${vb.marketType}_${vb.selection}`;
            const clvData = clvLookup?.get(clvKey);
            return (
            <div key={i} className="rounded bg-green-900/20 border border-green-900/30 px-2 py-1.5 mb-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-block rounded px-1 py-0.5 text-[9px] font-bold ${
                    vb.marketType === "AH"
                      ? "bg-purple-900/50 text-purple-400 border border-purple-800"
                      : "bg-zinc-800 text-zinc-500 border border-zinc-700"
                  }`}>
                    {vb.marketType}
                  </span>
                  <span className="font-semibold text-green-400">{vb.selection}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-zinc-400">
                    Edge: <span className="text-green-400 font-mono">+{(vb.edge * 100).toFixed(1)}%</span>
                    <span className="ml-2 text-zinc-600">Pinnacle: {vb.marketOdds.toFixed(2)}</span>
                  </span>
                  {pick.tedVerdict === "BET" && onLogBet && (
                    logged ? (
                      <span className="rounded bg-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 border border-zinc-700">
                        Logged
                      </span>
                    ) : (
                      <button
                        onClick={() => onLogBet(pick, vb)}
                        disabled={loggingId === betKey}
                        className="rounded bg-blue-900/50 border border-blue-700 px-2 py-0.5 text-[10px] text-blue-400 hover:bg-blue-900/70 disabled:opacity-50"
                      >
                        {loggingId === betKey ? "..." : "Log Bet"}
                      </button>
                    )
                  )}
                </div>
              </div>
              {/* Best books for this bet */}
              {vb.bestBooks && vb.bestBooks.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {vb.bestBooks.slice(0, 5).map((bb, j) => {
                    const isBest = j === 0;
                    const beatsPinnacle = bb.odds > vb.marketOdds;
                    return (
                      <span key={j} className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-mono ${
                        isBest
                          ? "bg-yellow-900/30 text-yellow-400 border border-yellow-800"
                          : beatsPinnacle
                            ? "bg-green-900/20 text-green-500 border border-green-900/40"
                            : "bg-zinc-900 text-zinc-500 border border-zinc-800"
                      }`}>
                        {bb.book} <span className="font-bold">{bb.odds.toFixed(2)}</span>
                      </span>
                    );
                  })}
                </div>
              )}
              {/* CLV feedback after settlement */}
              {clvData && <CLVBadge clv={clvData.clv} status={clvData.status} profit={clvData.profit} />}
              {/* Active signal tags */}
              {pick.activeSignals && pick.activeSignals.length > 0 && pick.tedVerdict === "BET" && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {pick.activeSignals.map((sig, j) => (
                    <span key={j} className="inline-block rounded px-1 py-0.5 text-[9px] font-mono bg-zinc-800 text-zinc-400 border border-zinc-700">
                      {sig}
                    </span>
                  ))}
                </div>
              )}
            </div>
            );
          })}
        </div>
      )}

      {/* Variance info */}
      <VarianceTag variance={pick.homeVariance} team={pick.homeTeam} />
      <VarianceTag variance={pick.awayVariance} team={pick.awayTeam} />

      {/* Injury info */}
      {pick.injuries && (
        <div className="mt-1 space-y-1">
          {pick.injuries.home && (
            <InjuryBadge severity={pick.injuries.home.severity} team={pick.homeTeam} summary={pick.injuries.home.summary} totalOut={pick.injuries.home.totalOut} />
          )}
          {pick.injuries.away && (
            <InjuryBadge severity={pick.injuries.away.severity} team={pick.awayTeam} summary={pick.injuries.away.summary} totalOut={pick.injuries.away.totalOut} />
          )}
        </div>
      )}

      {/* Ted reason (for PASS) */}
      {pick.tedVerdict === "PASS" && pick.tedReasonLabel && (
        <div className="mt-2 text-[10px] text-zinc-600 italic">
          {pick.tedReasonLabel}
        </div>
      )}
    </div>
  );
}

interface LedgerBet {
  homeTeam: string;
  awayTeam: string;
  matchDate: string;
  marketType: string;
  selection: string;
  status: string;
  clv?: number;
  profit?: number;
}

export default function PicksPage() {
  const [picks, setPicks] = useState<Pick[]>([]);
  const [summary, setSummary] = useState<PicksSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leagueFilter, setLeagueFilter] = useState<string>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [marketFilter, setMarketFilter] = useState<string>("all");
  const [consensusFilter, setConsensusFilter] = useState<string>("all");
  const [showPass, setShowPass] = useState(false);
  const [ledger, setLedger] = useState<LedgerBet[]>([]);
  const [loggingId, setLoggingId] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const showAction = useCallback((text: string, type: "success" | "error") => {
    setActionMsg({ text, type });
    setTimeout(() => setActionMsg(null), 4000);
  }, []);

  const loadLedger = useCallback(async () => {
    try {
      const res = await fetch("/api/paper-trade");
      const data = await res.json();
      setLedger((data.ledger || []).filter((b: LedgerBet) => b.status !== "superseded"));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [picksRes] = await Promise.all([
          fetch("/api/mi-picks"),
          loadLedger(),
        ]);
        const data = await picksRes.json();
        if (data.error) throw new Error(data.error);
        setPicks(data.picks || []);
        setSummary(data.summary || null);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [loadLedger]);

  const logBet = async (pick: Pick, vb: PickValueBet) => {
    const key = `${pick.matchId}_${vb.marketType}_${vb.selection}`;
    setLoggingId(key);
    try {
      const res = await fetch("/api/paper-trade/log-single", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeTeam: pick.homeTeam,
          awayTeam: pick.awayTeam,
          league: pick.league,
          matchDate: pick.date,
          marketType: vb.marketType,
          selection: vb.selection,
          ahLine: vb.ahLine,
          odds: vb.bestBooks?.[0]?.odds || vb.marketOdds,
          modelProb: vb.modelProb,
          edge: vb.edge,
          grade: pick.grade,
          bestBook: vb.bestBooks?.[0]?.book,
          bestBookOdds: vb.bestBooks?.[0]?.odds,
          activeSignals: pick.activeSignals,
        }),
      });
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();
      if (data.error) {
        showAction(data.error, "error");
      } else if (data.added > 0) {
        showAction("Bet logged!", "success");
        await loadLedger();
      } else {
        showAction("Already logged (skipped)", "success");
      }
    } catch (e: unknown) {
      showAction(e instanceof Error ? e.message : "Unknown error", "error");
    } finally {
      setLoggingId(null);
    }
  };

  // Build CLV lookup: homeTeam+awayTeam+matchDate+marketType+selection → {clv, status, profit}
  const clvLookup = new Map<string, { clv?: number; status: string; profit?: number }>();
  for (const b of ledger) {
    const key = `${b.homeTeam}_${b.awayTeam}_${b.matchDate}_${b.marketType}_${b.selection}`;
    if (b.status !== "pending") {
      clvLookup.set(key, { clv: b.clv, status: b.status, profit: b.profit });
    }
  }

  // Check if a bet is already logged
  const isLogged = (pick: Pick, vb: PickValueBet) => {
    return ledger.some(b =>
      b.homeTeam === pick.homeTeam &&
      b.awayTeam === pick.awayTeam &&
      b.matchDate === pick.date &&
      b.marketType === vb.marketType &&
      b.selection === vb.selection
    );
  };

  const filtered = picks.filter(p => {
    if (leagueFilter !== "all" && p.league !== leagueFilter) return false;
    if (!showPass && p.tedVerdict === "PASS") return false;
    if (gradeFilter !== "all" && p.grade !== gradeFilter) return false;
    if (marketFilter !== "all") {
      const hasMarket = p.valueBets.some(vb => vb.marketType === marketFilter);
      if (!hasMarket) return false;
    }
    if (consensusFilter !== "all") {
      if (!p.ensemble || p.ensemble.agreement !== consensusFilter) return false;
    }
    return true;
  });

  const betCount = filtered.filter(p => p.tedVerdict === "BET").length;
  const passCount = filtered.filter(p => p.tedVerdict === "PASS").length;

  if (loading) {
    return (
      <div className="py-20 text-center text-zinc-500">
        Loading MI model picks...
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <div className="text-red-400 mb-2">Error loading picks</div>
        <div className="text-sm text-zinc-500">{error}</div>
      </div>
    );
  }

  return (
    <div>
      {/* Action feedback toast */}
      {actionMsg && (
        <div className={`mb-4 rounded-lg border px-4 py-2 text-sm ${actionMsg.type === "success" ? "border-green-800 bg-green-900/30 text-green-400" : "border-red-800 bg-red-900/30 text-red-400"}`}>
          {actionMsg.text}
        </div>
      )}

      <div className="mb-4 text-sm text-zinc-400">
        MI-BP model picks with Ted variance filters. Backtest: +2.8% ROI across 4 leagues, 3 seasons.
      </div>

      {/* Summary bar */}
      {summary && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-white">{summary.totalBets}</div>
            <div className="text-[10px] text-zinc-500 uppercase">Bets</div>
          </div>
          <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-white">{summary.totalMatches}</div>
            <div className="text-[10px] text-zinc-500 uppercase">Matches</div>
          </div>
          <div className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
            <div className="text-2xl font-bold text-green-400">{summary.avgEdge}%</div>
            <div className="text-[10px] text-zinc-500 uppercase">Avg Edge</div>
          </div>
          {Object.entries(summary.byLeague).map(([lid, data]) => (
            <div key={lid} className="rounded bg-zinc-900 border border-zinc-800 p-3 text-center">
              <div className="text-lg font-bold text-zinc-300">{data.bets}<span className="text-zinc-600 text-sm">/{data.matches}</span></div>
              <div className="text-[10px] text-zinc-500 uppercase">{LEAGUE_LABELS[lid] || lid}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-500 mr-1">League:</span>
          {["all", "epl", "la-liga", "bundesliga", "serie-a", "serie-b", "ligue-1"].map(l => (
            <button
              key={l}
              onClick={() => setLeagueFilter(l)}
              className={`rounded px-2 py-1 text-xs ${
                leagueFilter === l
                  ? "bg-blue-900/50 text-blue-400 border border-blue-700"
                  : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300"
              }`}
            >
              {l === "all" ? "All" : LEAGUE_LABELS[l] || l}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-2">
          <span className="text-xs text-zinc-500 mr-1">Grade:</span>
          {["all", "A", "B", "C"].map(g => (
            <button
              key={g}
              onClick={() => setGradeFilter(g)}
              className={`rounded px-2 py-1 text-xs ${
                gradeFilter === g
                  ? "bg-blue-900/50 text-blue-400 border border-blue-700"
                  : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300"
              }`}
            >
              {g === "all" ? "All" : g}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-2">
          <span className="text-xs text-zinc-500 mr-1">Market:</span>
          {["all", "1X2", "AH"].map(m => (
            <button
              key={m}
              onClick={() => setMarketFilter(m)}
              className={`rounded px-2 py-1 text-xs ${
                marketFilter === m
                  ? "bg-blue-900/50 text-blue-400 border border-blue-700"
                  : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300"
              }`}
            >
              {m === "all" ? "All" : m}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1 ml-2">
          <span className="text-xs text-zinc-500 mr-1">Consensus:</span>
          {["all", "strong", "moderate", "split"].map(c => (
            <button
              key={c}
              onClick={() => setConsensusFilter(c)}
              className={`rounded px-2 py-1 text-xs ${
                consensusFilter === c
                  ? "bg-blue-900/50 text-blue-400 border border-blue-700"
                  : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:text-zinc-300"
              }`}
            >
              {c === "all" ? "All" : c.charAt(0).toUpperCase() + c.slice(1)}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowPass(!showPass)}
          className={`ml-2 rounded px-2 py-1 text-xs border ${
            showPass
              ? "bg-zinc-800 text-zinc-300 border-zinc-700"
              : "bg-zinc-900 text-zinc-600 border-zinc-800"
          }`}
        >
          {showPass ? `Hide PASS (${passCount})` : `Show PASS (${passCount})`}
        </button>
      </div>

      {/* Picks grid */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center text-zinc-600">
          {picks.length === 0
            ? "No upcoming matches found. Make sure live odds are collected and solve-latest has been run."
            : "No picks match current filters."}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map(pick => (
            <PickCard
              key={pick.matchId}
              pick={pick}
              onLogBet={logBet}
              loggingId={loggingId}
              isLogged={isLogged}
              clvLookup={clvLookup}
            />
          ))}
        </div>
      )}

      {/* Footer */}
      {summary && (
        <div className="mt-6 text-center text-[10px] text-zinc-700">
          Generated {new Date(summary.generatedAt).toLocaleString()} | Filters: no draws, max odds 2.5, min edge 7%, Ted variance + congestion + defiance
        </div>
      )}
    </div>
  );
}
