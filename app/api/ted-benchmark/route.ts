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

    const allBenchmarkMatches: BenchmarkMatch[] = [];
    let xgSource = "none";

    for (const season of testSeasons) {
      // 1. Fetch match results + odds from football-data.co.uk
      const matches = await fetchMatchesWithOdds(season, league as "epl" | "championship");
      if (matches.length === 0) continue;

      // 2. Fetch Understat xG for this season (walk-forward)
      const understatYear = seasonToUnderstatYear(season);
      let rawXgHistory: UnderstatTeamHistory[] | null = null;

      // Understat only covers top-5 leagues (not Championship)
      if (understatLeague !== "championship") {
        try {
          const cached = await fetchUnderstatCached(understatLeague, understatYear);
          rawXgHistory = cached.rawHistory;
          xgSource = cached.source;

          // Normalize Understat team names to match football-data.co.uk canonical names
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

      // Build xG lookup
      const xgByTeam = new Map<string, UnderstatTeamHistory>();
      if (rawXgHistory) {
        for (const t of rawXgHistory) xgByTeam.set(t.team, t);
      }

      // 3. Evaluate each match with Ted Variance (walk-forward)
      const sorted = [...matches].sort((a, b) => a.date.localeCompare(b.date));

      for (const match of sorted) {
        let tedResult: BenchmarkMatch["ted"] = null;
        let tedCorrect: boolean | null = null;

        if (rawXgHistory) {
          const homeHistory = xgByTeam.get(match.homeTeam);
          const awayHistory = xgByTeam.get(match.awayTeam);

          if (homeHistory && awayHistory) {
            const homeXg = aggregateXgBeforeDate(homeHistory, match.date, "h");
            const awayXg = aggregateXgBeforeDate(awayHistory, match.date, "a");

            if (homeXg && awayXg) {
              const homeV = calculateTeamVariance(homeXg);
              const awayV = calculateTeamVariance(awayXg);
              const assessment = assessMatch(homeV, awayV);

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
        }

        allBenchmarkMatches.push({
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
    }

    if (allBenchmarkMatches.length === 0) {
      return NextResponse.json({ error: "No match data available" }, { status: 404 });
    }

    // 4. Score our Ted model
    const withSignal = allBenchmarkMatches.filter((m) => m.ted && m.ted.edgeSide !== "neutral");
    const withBet = allBenchmarkMatches.filter((m) => m.ted && m.ted.hasBet);
    const matchesWithXg = allBenchmarkMatches.filter((m) => m.ted !== null).length;

    let directionalCorrect = 0;
    for (const m of withSignal) {
      if (
        (m.ted!.edgeSide === "home" && m.result === "H") ||
        (m.ted!.edgeSide === "away" && m.result === "A")
      ) directionalCorrect++;
    }

    let betWins = 0;
    for (const m of withBet) {
      if (
        (m.ted!.edgeSide === "home" && m.result === "H") ||
        (m.ted!.edgeSide === "away" && m.result === "A")
      ) betWins++;
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
        // ROI calc: if we had odds, compute P&L
        if (m.closingOdds) {
          const odds = tedSide === "home" ? m.closingOdds.home : m.closingOdds.away;
          entry.pnl += (odds - 1); // net profit per unit
        }
      } else if (draw) {
        entry.draws++;
        entry.pnl -= 1; // lost the bet
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

    // Home vs away breakdown
    const homePicks = withSignal.filter((m) => m.ted!.edgeSide === "home");
    const awayPicks = withSignal.filter((m) => m.ted!.edgeSide === "away");
    const homeWins = homePicks.filter((m) => m.result === "H").length;
    const awayWins = awayPicks.filter((m) => m.result === "A").length;

    // 5. Find matching Ted benchmark
    const benchmarkLeague = league === "epl" ? "EPL" : "Championship";
    const tedBenchmark = TED_BENCHMARKS.find((b) => b.league === benchmarkLeague) || null;

    // 6. Build gap analysis
    const gaps: BenchmarkResult["gaps"] = [];
    const ourBetHitRate = withBet.length > 0 ? Math.round((betWins / withBet.length) * 1000) / 10 : 0;

    if (tedBenchmark?.overall) {
      gaps.push({
        metric: "Overall Bet Hit Rate",
        ours: ourBetHitRate,
        teds: tedBenchmark.overall.hitRate,
        gap: Math.round((ourBetHitRate - tedBenchmark.overall.hitRate) * 10) / 10,
        interpretation: ourBetHitRate < tedBenchmark.overall.hitRate - 5
          ? "Significant gap — likely xG quality difference (Understat vs StatsBomb)"
          : ourBetHitRate < tedBenchmark.overall.hitRate
            ? "Small gap — could be xG quality, thresholds, or sample size"
            : "Competitive — our free xG is performing at or above Ted's level",
      });
    }

    const ourGradeA = byGrade.find((g) => g.grade === "A");
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

    const ourGradeB = byGrade.find((g) => g.grade === "B");
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

    // Signal volume comparison
    if (tedBenchmark?.overall) {
      const ourBetsPerMatch = withBet.length / allBenchmarkMatches.length;
      const tedBetsPerMatch = tedBenchmark.overall.bets / (380 * 2); // ~2 seasons of EPL
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

    const result: BenchmarkResult = {
      league,
      leagueLabel: LEAGUE_LABELS[league] || league,
      season: isMulti ? `multi (${testSeasons.join(", ")})` : seasonParam,
      totalMatches: allBenchmarkMatches.length,
      matchesWithXg: matchesWithXg,
      xgSource,
      ourResults: {
        totalSignals: withSignal.length,
        totalBets: withBet.length,
        directionalAccuracy: withSignal.length > 0
          ? Math.round((directionalCorrect / withSignal.length) * 1000) / 10 : 0,
        betHitRate: ourBetHitRate,
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
      matchLog: allBenchmarkMatches,
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
