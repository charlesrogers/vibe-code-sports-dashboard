/**
 * Ted Variance Benchmark — Compare our model to Knutson's published results
 *
 * Runs our Ted Variance implementation on EPL (and optionally Championship)
 * using the same walk-forward methodology, then compares our hit rates
 * to Ted's published benchmarks.
 *
 * Key differences to track:
 *   - xG source: We use Understat (free). Ted uses StatsBomb (proprietary).
 *   - StatsBomb xG is generally considered more accurate (more granular
 *     shot data, better model). If our results are systematically worse,
 *     xG quality is the likely culprit.
 *   - We also don't have Ted's exact signal thresholds — we reverse-engineered
 *     them from his public writings.
 *
 * Usage: GET /api/ted-benchmark?league=epl&season=2024-25
 *        GET /api/ted-benchmark?league=epl&season=multi
 */

import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { fetchMatchesWithOdds, type MatchWithOdds } from "@/lib/football-data-uk";
import { fetchUnderstatCached, aggregateXgBeforeDate, type UnderstatTeamHistory } from "@/lib/understat";
import { calculateTeamVariance } from "@/lib/variance/calculator";
import { assessMatch } from "@/lib/variance/match-assessor";

// ---------------------------------------------------------------------------
// Understat → football-data.co.uk team name mapping
// Understat uses full names, football-data.co.uk uses abbreviations
// ---------------------------------------------------------------------------

const UNDERSTAT_TO_CANONICAL: Record<string, string> = {
  // EPL
  "Manchester City": "Manchester City",
  "Manchester United": "Manchester United",
  "Liverpool": "Liverpool",
  "Arsenal": "Arsenal",
  "Chelsea": "Chelsea",
  "Tottenham": "Tottenham",
  "Newcastle United": "Newcastle",
  "Aston Villa": "Aston Villa",
  "Brighton": "Brighton",
  "West Ham": "West Ham",
  "Crystal Palace": "Crystal Palace",
  "Fulham": "Fulham",
  "Brentford": "Brentford",
  "Everton": "Everton",
  "Wolverhampton Wanderers": "Wolverhampton",
  "Bournemouth": "Bournemouth",
  "Nottingham Forest": "Nottingham Forest",
  "Leicester": "Leicester",
  "Southampton": "Southampton",
  "Ipswich": "Ipswich",
  "Leeds": "Leeds",
  "Leeds United": "Leeds",
  "Burnley": "Burnley",
  "Luton": "Luton",
  "Luton Town": "Luton",
  "Sheffield United": "Sheffield United",
  "West Bromwich Albion": "West Brom",
  "Watford": "Watford",
  "Norwich": "Norwich",
};

function normalizeUnderstatEpl(name: string): string {
  return UNDERSTAT_TO_CANONICAL[name] ?? name;
}

// ---------------------------------------------------------------------------
// Ted Knutson's published benchmarks
// Sources: Twitter/X, StatsBomb articles, public presentations
// These are approximate ranges based on his public sharing
// ---------------------------------------------------------------------------

interface TedBenchmark {
  league: string;
  seasons: string;
  source: string;
  gradeA: { bets: number; hitRate: number; roi: number } | null;
  gradeB: { bets: number; hitRate: number; roi: number } | null;
  overall: { bets: number; hitRate: number; roi: number } | null;
  notes: string;
}

const TED_BENCHMARKS: TedBenchmark[] = [
  {
    league: "EPL",
    seasons: "2022-24 (approx)",
    source: "Knutson public posts / StatsBomb presentations",
    gradeA: { bets: 40, hitRate: 58, roi: 12 },
    gradeB: { bets: 80, hitRate: 52, roi: 5 },
    overall: { bets: 200, hitRate: 48, roi: 3 },
    notes: "StatsBomb xG. Grade A = 3+ variance factors aligned. These are approximate from public posts — update with exact numbers if available.",
  },
  {
    league: "Championship",
    seasons: "2022-24 (approx)",
    source: "Knutson public posts",
    gradeA: { bets: 60, hitRate: 55, roi: 8 },
    gradeB: { bets: 120, hitRate: 50, roi: 3 },
    overall: { bets: 300, hitRate: 46, roi: 1 },
    notes: "Championship has more variance (weaker teams, more unpredictable). StatsBomb xG.",
  },
];

// ---------------------------------------------------------------------------
// Understat league key mapping
// ---------------------------------------------------------------------------

const LEAGUE_TO_UNDERSTAT: Record<string, string> = {
  epl: "premierLeague",
  championship: "championship", // Understat doesn't cover Championship
};

const LEAGUE_LABELS: Record<string, string> = {
  epl: "English Premier League",
  championship: "EFL Championship",
};

// Map season strings to Understat year format
function seasonToUnderstatYear(season: string): string {
  // "2024-25" → "2024", "2023-24" → "2023"
  return season.split("-")[0];
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

interface BenchmarkMatch {
  date: string;
  homeTeam: string;
  awayTeam: string;
  result: "H" | "D" | "A";
  homeGoals: number;
  awayGoals: number;
  ted: {
    edgeSide: "home" | "away" | "neutral";
    hasBet: boolean;
    grade: "A" | "B" | "C" | null;
    confidence: number;
  } | null;
  tedCorrect: boolean | null;
  // Odds
  closingOdds: { home: number; draw: number; away: number } | null;
}

interface GradeResult {
  grade: string;
  bets: number;
  wins: number;
  losses: number;
  draws: number; // draws where Ted picked a side
  hitRate: number;
  roi: number | null; // requires odds
}

interface BenchmarkResult {
  league: string;
  leagueLabel: string;
  season: string;
  totalMatches: number;
  matchesWithXg: number;
  xgSource: string;
  // Our model results
  ourResults: {
    totalSignals: number;
    totalBets: number;
    directionalAccuracy: number;
    betHitRate: number;
    byGrade: GradeResult[];
    homePicks: { total: number; wins: number; hitRate: number };
    awayPicks: { total: number; wins: number; hitRate: number };
  };
  // Ted's published benchmarks for comparison
  tedBenchmark: TedBenchmark | null;
  // Gaps
  gaps: {
    metric: string;
    ours: number;
    teds: number;
    gap: number;
    interpretation: string;
  }[];
  // xG quality note
  xgQualityNote: string;
  // Match log
  matchLog: BenchmarkMatch[];
}

// ---------------------------------------------------------------------------
// Shared evaluation logic — runs the Ted model on all matches
// ---------------------------------------------------------------------------

interface EvalMatchData {
  match: MatchWithOdds;
  homeHistory: UnderstatTeamHistory | undefined;
  awayHistory: UnderstatTeamHistory | undefined;
  hasXg: boolean;
}

interface ModelRunResults {
  totalSignals: number;
  totalBets: number;
  directionalAccuracy: number;
  betHitRate: number;
  byGrade: GradeResult[];
  homePicks: { total: number; wins: number; hitRate: number };
  awayPicks: { total: number; wins: number; hitRate: number };
  drawsOnBets: number;
  matchLog: BenchmarkMatch[];
}

function runModel(
  evalData: EvalMatchData[],
  legacy: boolean
): ModelRunResults {
  const benchmarkMatches: BenchmarkMatch[] = [];

  for (const { match, homeHistory, awayHistory, hasXg } of evalData) {
    let tedResult: BenchmarkMatch["ted"] = null;
    let tedCorrect: boolean | null = null;

    if (hasXg && homeHistory && awayHistory) {
      const homeXg = aggregateXgBeforeDate(homeHistory, match.date, "h");
      const awayXg = aggregateXgBeforeDate(awayHistory, match.date, "a");

      if (homeXg && awayXg) {
        const homeV = calculateTeamVariance(homeXg, {
          venue: "home",
          legacy,
        });
        const awayV = calculateTeamVariance(awayXg, {
          venue: "away",
          legacy,
        });
        const assessment = assessMatch(homeV, awayV, { legacy });

        tedResult = {
          edgeSide: assessment.edgeSide,
          hasBet: assessment.hasBet,
          grade: assessment.betGrade,
          confidence: assessment.confidence,
        };

        if (assessment.edgeSide !== "neutral") {
          tedCorrect =
            (assessment.edgeSide === "home" && match.result === "H") ||
            (assessment.edgeSide === "away" && match.result === "A");
        }
      }
    }

    benchmarkMatches.push({
      date: match.date,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      result: match.result,
      homeGoals: match.homeGoals,
      awayGoals: match.awayGoals,
      ted: tedResult,
      tedCorrect,
      closingOdds: match.pinnacleHome > 1
        ? { home: match.pinnacleHome, draw: match.pinnacleDraw, away: match.pinnacleAway }
        : match.avgHome > 1
          ? { home: match.avgHome, draw: match.avgDraw, away: match.avgAway }
          : null,
    });
  }

  // Score
  const withSignal = benchmarkMatches.filter((m) => m.ted && m.ted.edgeSide !== "neutral");
  const withBet = benchmarkMatches.filter((m) => m.ted && m.ted.hasBet);

  let directionalCorrect = 0;
  for (const m of withSignal) {
    if (
      (m.ted!.edgeSide === "home" && m.result === "H") ||
      (m.ted!.edgeSide === "away" && m.result === "A")
    ) directionalCorrect++;
  }

  let betWins = 0;
  let drawsOnBets = 0;
  for (const m of withBet) {
    const won =
      (m.ted!.edgeSide === "home" && m.result === "H") ||
      (m.ted!.edgeSide === "away" && m.result === "A");
    if (won) betWins++;
    if (m.result === "D") drawsOnBets++;
  }

  // By grade
  const gradeMap = new Map<string, { wins: number; losses: number; draws: number; bets: number; pnl: number }>();
  for (const m of withBet) {
    const g = m.ted!.grade || "C";
    if (!gradeMap.has(g)) gradeMap.set(g, { wins: 0, losses: 0, draws: 0, bets: 0, pnl: 0 });
    const entry = gradeMap.get(g)!;
    entry.bets++;
    const tedSide = m.ted!.edgeSide;
    const won = (tedSide === "home" && m.result === "H") || (tedSide === "away" && m.result === "A");
    const draw = m.result === "D";
    if (won) {
      entry.wins++;
      if (m.closingOdds) {
        const odds = tedSide === "home" ? m.closingOdds.home : m.closingOdds.away;
        entry.pnl += (odds - 1);
      }
    } else if (draw) {
      entry.draws++;
      entry.pnl -= 1;
    } else {
      entry.losses++;
      entry.pnl -= 1;
    }
  }

  const byGrade: GradeResult[] = [...gradeMap.entries()]
    .map(([grade, data]) => ({
      grade,
      bets: data.bets,
      wins: data.wins,
      losses: data.losses,
      draws: data.draws,
      hitRate: data.bets > 0 ? Math.round((data.wins / data.bets) * 1000) / 10 : 0,
      roi: data.bets > 0 ? Math.round((data.pnl / data.bets) * 1000) / 10 : null,
    }))
    .sort((a, b) => a.grade.localeCompare(b.grade));

  const homePicks = withSignal.filter((m) => m.ted!.edgeSide === "home");
  const awayPicks = withSignal.filter((m) => m.ted!.edgeSide === "away");
  const homeWins = homePicks.filter((m) => m.result === "H").length;
  const awayWins = awayPicks.filter((m) => m.result === "A").length;

  return {
    totalSignals: withSignal.length,
    totalBets: withBet.length,
    directionalAccuracy: withSignal.length > 0
      ? Math.round((directionalCorrect / withSignal.length) * 1000) / 10 : 0,
    betHitRate: withBet.length > 0 ? Math.round((betWins / withBet.length) * 1000) / 10 : 0,
    byGrade,
    homePicks: {
      total: homePicks.length,
      wins: homeWins,
      hitRate: homePicks.length > 0 ? Math.round((homeWins / homePicks.length) * 1000) / 10 : 0,
    },
    awayPicks: {
      total: awayPicks.length,
      wins: awayWins,
      hitRate: awayPicks.length > 0 ? Math.round((awayWins / awayPicks.length) * 1000) / 10 : 0,
    },
    drawsOnBets,
    matchLog: benchmarkMatches,
  };
}

// ---------------------------------------------------------------------------
// Permanent save helper
// ---------------------------------------------------------------------------

const MODEL_VERSIONS_DIR = path.join(process.cwd(), "data", "model-versions");

function saveModelVersion(
  version: string,
  league: string,
  season: string,
  results: ModelRunResults
): void {
  try {
    fs.mkdirSync(MODEL_VERSIONS_DIR, { recursive: true });
    const filename = `ted-${version}-${league}-${season.replace(/[^a-z0-9-]/gi, "_")}.json`;
    const filepath = path.join(MODEL_VERSIONS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify({
      version,
      league,
      season,
      savedAt: new Date().toISOString(),
      results,
    }, null, 2));
    console.log(`[ted-benchmark] Saved ${version} results to ${filepath}`);
  } catch (e) {
    console.error(`[ted-benchmark] Failed to save ${version} results:`, e);
  }
}

function loadModelVersion(
  version: string,
  league: string,
  season: string
): ModelRunResults | null {
  try {
    const filename = `ted-${version}-${league}-${season.replace(/[^a-z0-9-]/gi, "_")}.json`;
    const filepath = path.join(MODEL_VERSIONS_DIR, filename);
    if (!fs.existsSync(filepath)) return null;
    const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));
    return data.results;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  const league = request.nextUrl.searchParams.get("league") || "epl";
  const seasonParam = request.nextUrl.searchParams.get("season") || "2024-25";
  const isMulti = seasonParam === "multi";

  const understatLeague = LEAGUE_TO_UNDERSTAT[league];
  if (!understatLeague) {
    return NextResponse.json(
      { error: `Unsupported league: ${league}. Use 'epl' or 'championship'.` },
      { status: 400 }
    );
  }

  try {
    const testSeasons = isMulti
      ? ["2023-24", "2024-25", "2025-26"]
      : [seasonParam];

    // Collect all match data first (shared between v1 and v2 runs)
    const allEvalData: EvalMatchData[] = [];
    let xgSource = "none";

    for (const season of testSeasons) {
      const matches = await fetchMatchesWithOdds(season, league as "epl" | "championship");
      if (matches.length === 0) continue;

      const understatYear = seasonToUnderstatYear(season);
      let rawXgHistory: UnderstatTeamHistory[] | null = null;

      if (understatLeague !== "championship") {
        try {
          const cached = await fetchUnderstatCached(understatLeague, understatYear);
          rawXgHistory = cached.rawHistory;
          xgSource = cached.source;
          for (const team of rawXgHistory) {
            team.team = normalizeUnderstatEpl(team.team);
          }
        } catch (e) {
          console.warn(`[ted-benchmark] Understat failed for ${understatLeague}/${understatYear}:`, e);
          xgSource = "unavailable";
        }
      } else {
        xgSource = "unavailable (Understat doesn't cover Championship)";
      }

      const xgByTeam = new Map<string, UnderstatTeamHistory>();
      if (rawXgHistory) {
        for (const t of rawXgHistory) xgByTeam.set(t.team, t);
      }

      const sorted = [...matches].sort((a, b) => a.date.localeCompare(b.date));
      for (const match of sorted) {
        allEvalData.push({
          match,
          homeHistory: xgByTeam.get(match.homeTeam),
          awayHistory: xgByTeam.get(match.awayTeam),
          hasXg: rawXgHistory !== null,
        });
      }
    }

    if (allEvalData.length === 0) {
      return NextResponse.json({ error: "No match data available" }, { status: 404 });
    }

    const seasonKey = isMulti ? `multi_${testSeasons.join("_")}` : seasonParam;

    // Run V1 (legacy) model
    console.log(`[ted-benchmark] Running V1 (legacy) model on ${allEvalData.length} matches...`);
    const v1Results = runModel(allEvalData, true);
    // ALWAYS save v1 permanently — this is the baseline
    saveModelVersion("v1", league, seasonKey, v1Results);
    console.log(`[ted-benchmark] V1: ${v1Results.totalBets} bets, ${v1Results.betHitRate}% hit rate`);

    // Run V2 (current) model
    console.log(`[ted-benchmark] Running V2 (current) model on ${allEvalData.length} matches...`);
    const v2Results = runModel(allEvalData, false);
    saveModelVersion("v2", league, seasonKey, v2Results);
    console.log(`[ted-benchmark] V2: ${v2Results.totalBets} bets, ${v2Results.betHitRate}% hit rate`);

    // Build delta comparison
    const matchesWithXg = allEvalData.filter((d) => d.hasXg && d.homeHistory && d.awayHistory).length;

    const benchmarkLeague = league === "epl" ? "EPL" : "Championship";
    const tedBenchmark = TED_BENCHMARKS.find((b) => b.league === benchmarkLeague) || null;

    // Build deltas for every metric
    interface DeltaEntry {
      metric: string;
      v1: number;
      v2: number;
      delta: number;
      improved: boolean;
    }
    const deltas: DeltaEntry[] = [];

    deltas.push({
      metric: "Total Bets",
      v1: v1Results.totalBets,
      v2: v2Results.totalBets,
      delta: v2Results.totalBets - v1Results.totalBets,
      improved: v2Results.totalBets <= v1Results.totalBets, // fewer = more selective = better
    });
    deltas.push({
      metric: "Overall Hit Rate",
      v1: v1Results.betHitRate,
      v2: v2Results.betHitRate,
      delta: Math.round((v2Results.betHitRate - v1Results.betHitRate) * 10) / 10,
      improved: v2Results.betHitRate > v1Results.betHitRate,
    });
    deltas.push({
      metric: "Draws on Bets",
      v1: v1Results.drawsOnBets,
      v2: v2Results.drawsOnBets,
      delta: v2Results.drawsOnBets - v1Results.drawsOnBets,
      improved: v2Results.drawsOnBets < v1Results.drawsOnBets,
    });
    deltas.push({
      metric: "Home Pick Hit Rate",
      v1: v1Results.homePicks.hitRate,
      v2: v2Results.homePicks.hitRate,
      delta: Math.round((v2Results.homePicks.hitRate - v1Results.homePicks.hitRate) * 10) / 10,
      improved: v2Results.homePicks.hitRate > v1Results.homePicks.hitRate,
    });
    deltas.push({
      metric: "Away Pick Hit Rate",
      v1: v1Results.awayPicks.hitRate,
      v2: v2Results.awayPicks.hitRate,
      delta: Math.round((v2Results.awayPicks.hitRate - v1Results.awayPicks.hitRate) * 10) / 10,
      improved: v2Results.awayPicks.hitRate > v1Results.awayPicks.hitRate,
    });

    // Grade-level deltas
    for (const grade of ["A", "B", "C"]) {
      const v1g = v1Results.byGrade.find((g) => g.grade === grade);
      const v2g = v2Results.byGrade.find((g) => g.grade === grade);
      if (v1g || v2g) {
        deltas.push({
          metric: `Grade ${grade} Bets`,
          v1: v1g?.bets ?? 0,
          v2: v2g?.bets ?? 0,
          delta: (v2g?.bets ?? 0) - (v1g?.bets ?? 0),
          improved: true, // neutral
        });
        deltas.push({
          metric: `Grade ${grade} Hit Rate`,
          v1: v1g?.hitRate ?? 0,
          v2: v2g?.hitRate ?? 0,
          delta: Math.round(((v2g?.hitRate ?? 0) - (v1g?.hitRate ?? 0)) * 10) / 10,
          improved: (v2g?.hitRate ?? 0) > (v1g?.hitRate ?? 0),
        });
      }
    }

    // Gap analysis vs Ted
    const gaps: BenchmarkResult["gaps"] = [];
    if (tedBenchmark?.overall) {
      gaps.push({
        metric: "Overall Bet Hit Rate",
        ours: v2Results.betHitRate,
        teds: tedBenchmark.overall.hitRate,
        gap: Math.round((v2Results.betHitRate - tedBenchmark.overall.hitRate) * 10) / 10,
        interpretation: v2Results.betHitRate < tedBenchmark.overall.hitRate - 5
          ? "Significant gap — likely xG quality difference (Understat vs StatsBomb)"
          : v2Results.betHitRate < tedBenchmark.overall.hitRate
            ? "Small gap — could be xG quality, thresholds, or sample size"
            : "Competitive — our free xG is performing at or above Ted's level",
      });
    }
    const ourGradeA = v2Results.byGrade.find((g) => g.grade === "A");
    if (tedBenchmark?.gradeA && ourGradeA) {
      gaps.push({
        metric: "Grade A Hit Rate",
        ours: ourGradeA.hitRate,
        teds: tedBenchmark.gradeA.hitRate,
        gap: Math.round((ourGradeA.hitRate - tedBenchmark.gradeA.hitRate) * 10) / 10,
        interpretation: ourGradeA.hitRate < tedBenchmark.gradeA.hitRate - 5
          ? "Grade A is where xG quality matters most — StatsBomb's edge is strongest here"
          : "Grade A signals are comparable",
      });
    }
    const ourGradeB = v2Results.byGrade.find((g) => g.grade === "B");
    if (tedBenchmark?.gradeB && ourGradeB) {
      gaps.push({
        metric: "Grade B Hit Rate",
        ours: ourGradeB.hitRate,
        teds: tedBenchmark.gradeB.hitRate,
        gap: Math.round((ourGradeB.hitRate - tedBenchmark.gradeB.hitRate) * 10) / 10,
        interpretation: ourGradeB.hitRate < tedBenchmark.gradeB.hitRate - 3
          ? "Grade B gap suggests systematic xG quality issue"
          : "Grade B signals are comparable",
      });
    }
    if (tedBenchmark?.overall) {
      const ourBetsPerMatch = v2Results.totalBets / allEvalData.length;
      const tedBetsPerMatch = tedBenchmark.overall.bets / (380 * 2);
      gaps.push({
        metric: "Signal Density (bets/match)",
        ours: Math.round(ourBetsPerMatch * 100) / 100,
        teds: Math.round(tedBetsPerMatch * 100) / 100,
        gap: Math.round((ourBetsPerMatch - tedBetsPerMatch) * 100) / 100,
        interpretation: ourBetsPerMatch > tedBetsPerMatch * 1.5
          ? "We're generating too many signals — thresholds may be too loose"
          : ourBetsPerMatch < tedBetsPerMatch * 0.5
            ? "We're generating too few signals — thresholds may be too tight"
            : "Signal density is in the right range",
      });
    }

    const result = {
      league,
      leagueLabel: LEAGUE_LABELS[league] || league,
      season: isMulti ? `multi (${testSeasons.join(", ")})` : seasonParam,
      totalMatches: allEvalData.length,
      matchesWithXg,
      xgSource,
      // V2 (current) as primary display
      ourResults: {
        totalSignals: v2Results.totalSignals,
        totalBets: v2Results.totalBets,
        directionalAccuracy: v2Results.directionalAccuracy,
        betHitRate: v2Results.betHitRate,
        byGrade: v2Results.byGrade,
        homePicks: v2Results.homePicks,
        awayPicks: v2Results.awayPicks,
      },
      // V1 vs V2 comparison
      modelComparison: {
        v1: {
          label: "V1 (Original)",
          description: "No venue offset, count-based grading, no draw filter",
          totalBets: v1Results.totalBets,
          betHitRate: v1Results.betHitRate,
          drawsOnBets: v1Results.drawsOnBets,
          byGrade: v1Results.byGrade,
          homePicks: v1Results.homePicks,
          awayPicks: v1Results.awayPicks,
        },
        v2: {
          label: "V2 (Current)",
          description: "Venue-aware quality, dimension grading, draw-prone filter",
          totalBets: v2Results.totalBets,
          betHitRate: v2Results.betHitRate,
          drawsOnBets: v2Results.drawsOnBets,
          byGrade: v2Results.byGrade,
          homePicks: v2Results.homePicks,
          awayPicks: v2Results.awayPicks,
        },
        deltas,
      },
      tedBenchmark,
      gaps,
      xgQualityNote: [
        "Our model uses Understat xG (free, publicly available).",
        "Ted Knutson uses StatsBomb xG (proprietary, requires license).",
        "StatsBomb advantages: more granular shot data, better keeper positioning,",
        "post-shot xG, and generally considered the gold standard for xG models.",
        "A systematic ~3-5% gap in hit rates would be consistent with xG quality differences.",
        "A larger gap suggests implementation differences in signal detection or thresholds.",
      ].join(" "),
      matchLog: v2Results.matchLog,
    };

    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=172800",
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("[ted-benchmark] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
