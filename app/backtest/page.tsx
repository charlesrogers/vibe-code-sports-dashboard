"use client";

import { useState, useEffect } from "react";
import LeagueSelector from "../components/league-selector";
import SeasonSelector from "../components/season-selector";

interface Summary {
  totalMatches: number;
  brierScore: number;
  logLoss: number;
  accuracy: number;
  avgCLV: number;
  clvPositiveRate: number;
  totalBets: number;
  wins: number;
  losses: number;
  hitRate: number;
  flatStakeROI: number;
  kellyROI: number;
  avgEdge: number;
  firstHalfCLV: number;
  secondHalfCLV: number;
  edgeDecayRate: number;
}

interface CalBucket {
  range: string;
  midpoint: number;
  predicted: number;
  actual: number;
  count: number;
  deviation: number;
}

interface EdgePoint {
  matchday: number;
  cumulativeCLV: number;
  rollingCLV10: number;
  cumulativeROI: number;
}

interface ModelComp {
  brier: number;
  logLoss: number;
  clv: number;
}

interface BetRecord {
  date: string;
  homeTeam: string;
  awayTeam: string;
  modelHome: number;
  modelDraw: number;
  modelAway: number;
  dcHome: number;
  dcDraw: number;
  dcAway: number;
  eloHome: number;
  eloDraw: number;
  eloAway: number;
  closingHome: number;
  closingDraw: number;
  closingAway: number;
  clvHome: number;
  clvDraw: number;
  clvAway: number;
  closingOddsHome: number;
  closingOddsDraw: number;
  closingOddsAway: number;
  actualResult: string;
  homeGoals: number;
  awayGoals: number;
  bestBetMarket: string;
  bestBetEdge: number;
  bestBetOdds: number;
  bestBetWon: boolean;
  brierScore: number;
}

export default function BacktestPage() {
  const [league, setLeague] = useState("serieA");
  const [season, setSeason] = useState("2025-26");
  const [dcW, setDcW] = useState(45);
  const [eloW, setEloW] = useState(20);
  const [mktW, setMktW] = useState(35);
  const [minEdge, setMinEdge] = useState(3);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [calibration, setCalibration] = useState<CalBucket[]>([]);
  const [edgeDecay, setEdgeDecay] = useState<EdgePoint[]>([]);
  const [modelComp, setModelComp] = useState<Record<string, ModelComp> | null>(null);
  const [bets, setBets] = useState<BetRecord[]>([]);
  const [tab, setTab] = useState<"overview" | "clv" | "calibration" | "bets">("overview");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/backtest?season=${season}&league=${league}&minEdge=${minEdge / 100}&dc=${dcW}&elo=${eloW}&mkt=${mktW}`
        );
        const data = await res.json();
        if (data.error) {
          setSummary(null);
          return;
        }
        setSummary(data.summary);
        setCalibration(data.calibration || []);
        setEdgeDecay(data.edgeDecay || []);
        setModelComp(data.modelComparison || null);
        setBets(data.bets || []);
      } catch {
        setSummary(null);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [league, season, dcW, eloW, mktW, minEdge]);

  const pct = (n: number) => `${n.toFixed(1)}%`;

  return (
    <div>
      <div className="mb-2 text-sm text-zinc-400">
        Walk-forward backtest: model trained only on data before each match. CLV = edge vs closing line (Pinnacle).
      </div>

      {/* Controls */}
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <LeagueSelector value={league} onChange={setLeague} />
          <SeasonSelector value={season} onChange={setSeason} />
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500">Min Edge:</label>
            <input type="range" min={1} max={15} value={minEdge}
              onChange={(e) => setMinEdge(parseInt(e.target.value))} className="w-20" />
            <span className="text-sm font-mono text-blue-400">{minEdge}%</span>
          </div>
        </div>

        {/* Model weights */}
        <div className="flex flex-wrap items-center gap-4 rounded-lg bg-zinc-900 p-3">
          <span className="text-xs font-medium text-zinc-400">Model Weights:</span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500">DC:</span>
            <input type="range" min={0} max={100} value={dcW}
              onChange={(e) => setDcW(parseInt(e.target.value))} className="w-16" />
            <span className="text-xs font-mono text-green-400">{dcW}%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500">ELO:</span>
            <input type="range" min={0} max={100} value={eloW}
              onChange={(e) => setEloW(parseInt(e.target.value))} className="w-16" />
            <span className="text-xs font-mono text-purple-400">{eloW}%</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-zinc-500">Market:</span>
            <input type="range" min={0} max={100} value={mktW}
              onChange={(e) => setMktW(parseInt(e.target.value))} className="w-16" />
            <span className="text-xs font-mono text-yellow-400">{mktW}%</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1">
          {(["overview", "clv", "calibration", "bets"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 text-xs font-medium ${
                tab === t ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400"
              }`}
            >
              {t === "overview" ? "Overview" : t === "clv" ? "CLV & Edge" : t === "calibration" ? "Calibration" : "Bet Log"}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="py-20 text-center text-zinc-500">Running walk-forward backtest for {season}...</div>}

      {!loading && !summary && (
        <div className="py-20 text-center text-zinc-500">No backtest data available for this season/league.</div>
      )}

      {!loading && summary && tab === "overview" && (
        <>
          {/* Key Metrics */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {/* CLV — the gold standard */}
            <div className="rounded-xl bg-zinc-900 p-4 text-center ring-1 ring-yellow-500/20">
              <div className={`text-2xl font-bold ${summary.avgCLV > 0 ? "text-green-400" : "text-red-400"}`}>
                {summary.avgCLV > 0 ? "+" : ""}{summary.avgCLV}%
              </div>
              <div className="text-[10px] text-yellow-400 font-medium">AVG CLV (Gold Standard)</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-2xl font-bold text-blue-400">{pct(summary.clvPositiveRate)}</div>
              <div className="text-[10px] text-zinc-500">CLV+ Rate</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-2xl font-bold text-zinc-300">{summary.brierScore}</div>
              <div className="text-[10px] text-zinc-500">Brier Score</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-2xl font-bold text-zinc-300">{summary.logLoss}</div>
              <div className="text-[10px] text-zinc-500">Log Loss</div>
            </div>
          </div>

          {/* P&L (secondary) */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-blue-400">{summary.totalBets}</div>
              <div className="text-[10px] text-zinc-500">Bets ({minEdge}%+ edge)</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-green-400">{pct(summary.hitRate)}</div>
              <div className="text-[10px] text-zinc-500">Hit Rate</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className={`text-xl font-bold ${summary.flatStakeROI >= 0 ? "text-green-400" : "text-red-400"}`}>
                {summary.flatStakeROI > 0 ? "+" : ""}{summary.flatStakeROI}%
              </div>
              <div className="text-[10px] text-zinc-500">Flat Stake ROI</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className={`text-xl font-bold ${summary.kellyROI >= 0 ? "text-green-400" : "text-red-400"}`}>
                {summary.kellyROI > 0 ? "+" : ""}{summary.kellyROI}%
              </div>
              <div className="text-[10px] text-zinc-500">1/4 Kelly ROI</div>
            </div>
            <div className="rounded-xl bg-zinc-900 p-3 text-center">
              <div className="text-xl font-bold text-purple-400">{summary.avgEdge}%</div>
              <div className="text-[10px] text-zinc-500">Avg Edge</div>
            </div>
          </div>

          {/* Edge Stability */}
          <div className="mb-6 rounded-xl bg-zinc-900 p-4">
            <h3 className="mb-3 text-sm font-medium text-zinc-300">Edge Stability (CLV Decay)</h3>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <div className={`text-lg font-bold ${summary.firstHalfCLV > 0 ? "text-green-400" : "text-red-400"}`}>
                  {summary.firstHalfCLV > 0 ? "+" : ""}{summary.firstHalfCLV}%
                </div>
                <div className="text-[10px] text-zinc-500">First Half CLV</div>
              </div>
              <div>
                <div className={`text-lg font-bold ${summary.secondHalfCLV > 0 ? "text-green-400" : "text-red-400"}`}>
                  {summary.secondHalfCLV > 0 ? "+" : ""}{summary.secondHalfCLV}%
                </div>
                <div className="text-[10px] text-zinc-500">Second Half CLV</div>
              </div>
              <div>
                <div className={`text-lg font-bold ${summary.edgeDecayRate >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {summary.edgeDecayRate >= 0 ? "+" : ""}{summary.edgeDecayRate}%
                </div>
                <div className="text-[10px] text-zinc-500">
                  {summary.edgeDecayRate >= 0 ? "Edge Growing" : "Edge Decaying"}
                </div>
              </div>
            </div>
          </div>

          {/* Model Comparison */}
          {modelComp && (
            <div className="mb-6 rounded-xl bg-zinc-900 overflow-hidden">
              <h3 className="px-4 py-3 text-sm font-medium text-zinc-300 border-b border-zinc-800">
                Model Comparison (lower Brier/Log Loss = better)
              </h3>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-400">
                    <th className="px-4 py-2 text-left">Model</th>
                    <th className="px-4 py-2 text-center">Brier</th>
                    <th className="px-4 py-2 text-center">Log Loss</th>
                    <th className="px-4 py-2 text-center">Avg CLV</th>
                  </tr>
                </thead>
                <tbody>
                  {(["composite", "dixonColes", "elo", "market"] as const).map((m) => {
                    const d = modelComp[m];
                    const label = m === "composite" ? "Composite (Ours)"
                      : m === "dixonColes" ? "Dixon-Coles Only"
                      : m === "elo" ? "ELO Only"
                      : "Market (Closing Line)";
                    const isBest = m === "composite";
                    return (
                      <tr key={m} className={`border-b border-zinc-800/50 ${isBest ? "bg-blue-500/5" : ""}`}>
                        <td className={`px-4 py-2 ${isBest ? "font-bold text-blue-400" : ""}`}>{label}</td>
                        <td className="px-4 py-2 text-center font-mono">{d.brier}</td>
                        <td className="px-4 py-2 text-center font-mono">{d.logLoss}</td>
                        <td className={`px-4 py-2 text-center font-mono ${d.clv > 0 ? "text-green-400" : d.clv < 0 ? "text-red-400" : "text-zinc-400"}`}>
                          {m === "market" ? "baseline" : `${d.clv > 0 ? "+" : ""}${d.clv}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <p className="text-xs text-zinc-600">
            Backtest methodology: Walk-forward (no lookahead). Model retrained monthly on prior data only.
            CLV measured vs Pinnacle closing line (sharpest book). Positive CLV = your model saw value the market later confirmed.
            Per Harry Crane: CLV stabilizes in ~200 bets vs thousands needed for P&L convergence.
          </p>
        </>
      )}

      {!loading && summary && tab === "clv" && (
        <>
          {/* Edge Decay Chart (ASCII-style) */}
          <div className="mb-6 rounded-xl bg-zinc-900 p-4">
            <h3 className="mb-3 text-sm font-medium text-zinc-300">CLV Over Time (cumulative avg, %)</h3>
            <div className="overflow-x-auto">
              <div className="flex items-end gap-0.5 h-40 min-w-[600px]">
                {edgeDecay.map((p, i) => {
                  const maxAbs = Math.max(1, ...edgeDecay.map((e) => Math.abs(e.cumulativeCLV)));
                  const h = Math.abs(p.cumulativeCLV) / maxAbs * 60;
                  return (
                    <div key={i} className="flex flex-col items-center flex-1 min-w-[3px]"
                      style={{ height: "100%", justifyContent: p.cumulativeCLV >= 0 ? "flex-end" : "flex-start" }}>
                      {p.cumulativeCLV >= 0 ? (
                        <div className="w-full bg-green-500 rounded-t-sm" style={{ height: `${h}%` }} />
                      ) : (
                        <div className="w-full bg-red-500 rounded-b-sm" style={{ height: `${h}%` }} />
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between text-[9px] text-zinc-600 mt-1 min-w-[600px]">
                <span>Match 1</span>
                <span>Match {summary.totalMatches}</span>
              </div>
            </div>
          </div>

          {/* Rolling CLV */}
          <div className="mb-6 rounded-xl bg-zinc-900 p-4">
            <h3 className="mb-3 text-sm font-medium text-zinc-300">10-Match Rolling CLV (%)</h3>
            <div className="overflow-x-auto">
              <div className="flex items-center gap-0.5 h-32 min-w-[600px]" style={{ position: "relative" }}>
                <div className="absolute left-0 right-0" style={{ top: "50%", borderTop: "1px dashed #333" }} />
                {edgeDecay.map((p, i) => {
                  const maxAbs = Math.max(1, ...edgeDecay.map((e) => Math.abs(e.rollingCLV10)));
                  const pct = p.rollingCLV10 / maxAbs * 45;
                  return (
                    <div key={i} className="flex flex-col items-center flex-1 min-w-[3px]" style={{ height: "100%" }}>
                      <div className="w-full relative" style={{ height: "100%" }}>
                        <div
                          className={`absolute w-full ${p.rollingCLV10 >= 0 ? "bg-green-500/80" : "bg-red-500/80"}`}
                          style={{
                            height: `${Math.abs(pct)}%`,
                            top: p.rollingCLV10 >= 0 ? `${50 - Math.abs(pct)}%` : "50%",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <p className="text-xs text-zinc-600">
            Green bars = positive CLV (model beating the market). Red = negative.
            Consistent green across time = real edge, not noise. Decaying green = market adapting.
            Per Ted Knutson: target 4-8% edge, manage through aggressive line shopping.
          </p>
        </>
      )}

      {!loading && summary && tab === "calibration" && (
        <>
          {/* Calibration Table */}
          <div className="mb-6 rounded-xl bg-zinc-900 overflow-hidden">
            <h3 className="px-4 py-3 text-sm font-medium text-zinc-300 border-b border-zinc-800">
              Calibration: Does our model mean what it says?
            </h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="px-4 py-2 text-left">Bucket</th>
                  <th className="px-4 py-2 text-center">Predicted</th>
                  <th className="px-4 py-2 text-center">Actual</th>
                  <th className="px-4 py-2 text-center">Deviation</th>
                  <th className="px-4 py-2 text-center">n</th>
                  <th className="px-4 py-2 text-left">Visual</th>
                </tr>
              </thead>
              <tbody>
                {calibration.map((b) => {
                  const dev = Math.abs(b.predicted - b.actual);
                  const color = dev < 0.03 ? "text-green-400" : dev < 0.06 ? "text-yellow-400" : "text-red-400";
                  return (
                    <tr key={b.range} className="border-b border-zinc-800/50">
                      <td className="px-4 py-2 font-mono text-zinc-400">{b.range}</td>
                      <td className="px-4 py-2 text-center font-mono">{(b.predicted * 100).toFixed(1)}%</td>
                      <td className="px-4 py-2 text-center font-mono">{(b.actual * 100).toFixed(1)}%</td>
                      <td className={`px-4 py-2 text-center font-mono font-bold ${color}`}>
                        {(dev * 100).toFixed(1)}%
                      </td>
                      <td className="px-4 py-2 text-center text-zinc-500">{b.count}</td>
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-1 w-32">
                          <div className="h-2 bg-blue-500 rounded" style={{ width: `${b.predicted * 100}%` }} />
                          <div className="h-2 bg-green-500 rounded" style={{ width: `${b.actual * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-zinc-600">
            Perfect calibration = predicted % matches actual hit rate.
            Green deviation (&lt;3%) = well calibrated. Yellow = slight bias. Red = model is miscalibrated for this range.
            Blue bar = predicted rate, green bar = actual hit rate. They should be similar lengths.
          </p>
        </>
      )}

      {!loading && summary && tab === "bets" && (
        <>
          <div className="mb-2 text-xs text-zinc-500">
            Showing {bets.filter((b) => b.bestBetEdge >= minEdge / 100).length} bets with {minEdge}%+ edge. CLV = our model prob minus closing line prob.
          </div>
          <div className="rounded-xl bg-zinc-900 overflow-hidden">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-400">
                  <th className="px-2 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Match</th>
                  <th className="px-2 py-2 text-center">Bet</th>
                  <th className="px-2 py-2 text-center">Model</th>
                  <th className="px-2 py-2 text-center">Close</th>
                  <th className="px-2 py-2 text-center">CLV</th>
                  <th className="px-2 py-2 text-center">Odds</th>
                  <th className="px-2 py-2 text-center">Score</th>
                  <th className="px-2 py-2 text-center">W/L</th>
                </tr>
              </thead>
              <tbody>
                {bets
                  .filter((b) => b.bestBetEdge >= minEdge / 100)
                  .slice(0, 150)
                  .map((b, i) => (
                    <tr key={i} className={`border-b border-zinc-800/50 ${b.bestBetWon ? "bg-green-500/5" : "bg-red-500/5"}`}>
                      <td className="px-2 py-1.5 text-zinc-500">{b.date.slice(5)}</td>
                      <td className="px-2 py-1.5 font-medium">
                        {b.homeTeam} v {b.awayTeam}
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${
                          b.bestBetMarket === "Home" ? "bg-green-900/50 text-green-400"
                          : b.bestBetMarket === "Away" ? "bg-blue-900/50 text-blue-400"
                          : "bg-yellow-900/50 text-yellow-400"
                        }`}>{b.bestBetMarket}</span>
                      </td>
                      <td className="px-2 py-1.5 text-center font-mono text-green-400">
                        {(getBetProb(b) * 100).toFixed(0)}%
                      </td>
                      <td className="px-2 py-1.5 text-center font-mono text-zinc-400">
                        {(getClosingProb(b) * 100).toFixed(0)}%
                      </td>
                      <td className={`px-2 py-1.5 text-center font-mono font-bold ${
                        b.bestBetEdge > 0 ? "text-green-400" : "text-red-400"
                      }`}>
                        {b.bestBetEdge > 0 ? "+" : ""}{(b.bestBetEdge * 100).toFixed(1)}%
                      </td>
                      <td className="px-2 py-1.5 text-center font-mono">{b.bestBetOdds.toFixed(2)}</td>
                      <td className="px-2 py-1.5 text-center text-zinc-400">{b.homeGoals}-{b.awayGoals}</td>
                      <td className="px-2 py-1.5 text-center">
                        <span className={`font-bold ${b.bestBetWon ? "text-green-400" : "text-red-400"}`}>
                          {b.bestBetWon ? "W" : "L"}
                        </span>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function getBetProb(b: BetRecord): number {
  return b.bestBetMarket === "Home" ? b.modelHome
    : b.bestBetMarket === "Away" ? b.modelAway : b.modelDraw;
}

function getClosingProb(b: BetRecord): number {
  return b.bestBetMarket === "Home" ? b.closingHome
    : b.bestBetMarket === "Away" ? b.closingAway : b.closingDraw;
}
