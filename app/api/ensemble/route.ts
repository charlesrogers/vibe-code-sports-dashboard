/**
 * Ensemble Prediction API
 *
 * Generates predictions for all upcoming fixtures using 4 models:
 * 1. Dixon-Coles (structural attack/defense strength)
 * 2. ELO (momentum/form from recent results)
 * 3. Market-implied (devigged closing odds when available)
 * 4. Ted Variance (xG regression signal with venue splits)
 *
 * Each prediction is stored with a model version hash for tracking.
 * When config changes, re-running produces a new version for comparison.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchOpenFootballMatches, fetchUpcomingFixtures, type League } from "@/lib/openfootball";
import { fitDixonColes, predictMatch, getExpectedGoals } from "@/lib/models/dixon-coles";
import { derive1X2, deriveOverUnder, deriveBTTS } from "@/lib/betting/markets";
import { calculateEloRatings, eloWinProbability } from "@/lib/models/elo";
import { devigOdds } from "@/lib/models/composite";
import { calculateTeamVariance, calculateAllVariance } from "@/lib/variance/calculator";
import { assessMatch } from "@/lib/variance/match-assessor";
import { fetchUnderstatCached } from "@/lib/understat";
import { loadVenueSplitXg, getVenueXgForFixture } from "@/lib/venue-split-xg";
import type { VenueSplitXg } from "@/lib/understat";
import {
  createModelVersion,
  makeMatchId,
  savePrediction,
  loadAllPredictions,
  compareModelVersions,
  type MatchPrediction,
  type ModelVersion,
} from "@/lib/prediction-tracker";

// Default ensemble weights (DC + ELO + Market + Ted Variance modifier)
const DEFAULT_ENSEMBLE_WEIGHTS = {
  dixonColes: 0.40,
  elo: 0.15,
  market: 0.30,
  tedVariance: 0.15,
};

export async function GET(request: NextRequest) {
  const league = (request.nextUrl.searchParams.get("league") || "serieA") as League;
  const action = request.nextUrl.searchParams.get("action") || "predict";

  try {
    // Action: "history" — return stored predictions and model comparison
    if (action === "history") {
      const predictions = loadAllPredictions(league);
      const comparison = compareModelVersions(predictions);
      return NextResponse.json({
        league,
        matches: predictions,
        modelComparison: comparison,
        totalMatches: predictions.length,
      });
    }

    // Action: "predict" — generate fresh predictions for upcoming fixtures

    // 1. Fit Dixon-Coles on historical data
    const seasons = ["2025-26", "2024-25"];
    const [matches, fixtures] = await Promise.all([
      fetchOpenFootballMatches(seasons, league),
      fetchUpcomingFixtures("2025-26", league),
    ]);

    const dcParams = fitDixonColes(matches);
    const eloRatings = calculateEloRatings(matches);
    const eloMap = new Map(eloRatings.map((e) => [e.team, e.rating]));

    // 2. Get venue-split xG for Ted variance
    let venueSplits: VenueSplitXg[] | null = null;
    let xgSource = "none";

    try {
      const result = await fetchUnderstatCached(league);
      venueSplits = result.venueSplits;
      xgSource = result.source;
    } catch {
      const cached = loadVenueSplitXg(league);
      if (cached) {
        venueSplits = cached.teams;
        xgSource = "legacy-file-cache";
      }
    }

    const hasVenueSplits = venueSplits !== null && venueSplits.length > 0;

    // Compute variance for all teams (for Ted model)
    const overallXgData = hasVenueSplits
      ? venueSplits!.map((t) => t.overall)
      : [];
    const teamVariances = overallXgData.length > 0
      ? calculateAllVariance(overallXgData)
      : [];
    const varianceMap = new Map(teamVariances.map((t) => [t.team, t]));

    // 3. Determine data sources and create model version
    const dataSources = ["openfootball", "elo"];
    if (xgSource !== "none") dataSources.push(xgSource);

    const modelConfig = {
      weights: DEFAULT_ENSEMBLE_WEIGHTS,
      dataSources,
      tedFiltersEnabled: true,
      injuryDataIncluded: false, // TODO: wire in injuries
      venueSplitXg: hasVenueSplits,
    };
    const modelVersion = createModelVersion(modelConfig);

    // 4. Generate predictions for each fixture
    const predictions: MatchPrediction[] = [];

    for (const f of fixtures) {
      // Skip if team not in DC model
      if (!(f.homeTeam in dcParams.attack) || !(f.awayTeam in dcParams.attack)) continue;

      const matchId = makeMatchId(f.date, f.homeTeam, f.awayTeam);

      // --- Dixon-Coles ---
      const grid = predictMatch(f.homeTeam, f.awayTeam, dcParams);
      const dcProbs = derive1X2(grid);
      const dcExpGoals = getExpectedGoals(f.homeTeam, f.awayTeam, dcParams);
      const dcOU25 = deriveOverUnder(grid, 2.5);
      const dcBTTS = deriveBTTS(grid);

      // --- ELO ---
      const homeElo = eloMap.get(f.homeTeam) || 1500;
      const awayElo = eloMap.get(f.awayTeam) || 1500;
      const eloProbs = eloWinProbability(homeElo, awayElo);

      // --- Ted Variance ---
      let tedResult: {
        edge: number;
        edgeSide: "home" | "away" | "neutral";
        hasBet: boolean;
        betGrade: "A" | "B" | "C" | null;
        confidence: number;
        positiveFactors: string[];
        passReasons: string[];
      } = {
        edge: 0,
        edgeSide: "neutral",
        hasBet: false,
        betGrade: null,
        confidence: 0,
        positiveFactors: [],
        passReasons: ["No xG data available"],
      };

      if (hasVenueSplits) {
        const { homeXg, awayXg } = getVenueXgForFixture(
          f.homeTeam, f.awayTeam, venueSplits!
        );
        if (homeXg && awayXg) {
          const homeV = calculateTeamVariance(homeXg);
          const awayV = calculateTeamVariance(awayXg);
          const assessment = assessMatch(homeV, awayV);
          tedResult = {
            edge: assessment.varianceEdge,
            edgeSide: assessment.edgeSide,
            hasBet: assessment.hasBet,
            betGrade: assessment.betGrade,
            confidence: assessment.confidence,
            positiveFactors: assessment.positiveFactors,
            passReasons: assessment.passReasons,
          };
        }
      } else if (varianceMap.size > 0) {
        const homeV = varianceMap.get(f.homeTeam);
        const awayV = varianceMap.get(f.awayTeam);
        if (homeV && awayV) {
          const assessment = assessMatch(homeV, awayV);
          tedResult = {
            edge: assessment.varianceEdge,
            edgeSide: assessment.edgeSide,
            hasBet: assessment.hasBet,
            betGrade: assessment.betGrade,
            confidence: assessment.confidence,
            positiveFactors: assessment.positiveFactors,
            passReasons: assessment.passReasons,
          };
        }
      }

      // --- Ensemble blend ---
      // Ted variance modifies the base blend directionally
      let w = { ...DEFAULT_ENSEMBLE_WEIGHTS };
      const hasMarket = false; // TODO: integrate live odds

      if (!hasMarket) {
        // Redistribute market weight
        const pool = w.market;
        w.dixonColes += pool * 0.5;
        w.elo += pool * 0.2;
        w.tedVariance += pool * 0.3;
        w.market = 0;
      }

      // Base blend (DC + ELO)
      const baseHome = w.dixonColes * dcProbs.home + w.elo * eloProbs.home;
      const baseDraw = w.dixonColes * dcProbs.draw + w.elo * eloProbs.draw;
      const baseAway = w.dixonColes * dcProbs.away + w.elo * eloProbs.away;

      // Ted variance adjustment: shift probability toward the side variance favors
      let tedAdjH = 0, tedAdjA = 0;
      if (tedResult.edge !== 0 && tedResult.confidence > 0) {
        const tedShift = tedResult.edge * w.tedVariance * tedResult.confidence;
        if (tedResult.edgeSide === "home") {
          tedAdjH = tedShift;
          tedAdjA = -tedShift * 0.5;
        } else if (tedResult.edgeSide === "away") {
          tedAdjA = -tedResult.edge * w.tedVariance * tedResult.confidence; // edge is negative for away
          tedAdjH = tedResult.edge * w.tedVariance * tedResult.confidence * 0.5;
        }
      }

      let ensHome = baseHome + tedAdjH;
      let ensDraw = baseDraw - Math.abs(tedAdjH + tedAdjA) * 0.3;
      let ensAway = baseAway + tedAdjA;

      // Normalize
      const total = ensHome + ensDraw + ensAway;
      ensHome /= total;
      ensDraw /= total;
      ensAway /= total;

      // Clamp
      ensHome = Math.max(0.01, Math.min(0.98, ensHome));
      ensDraw = Math.max(0.01, Math.min(0.98, ensDraw));
      ensAway = Math.max(0.01, Math.min(0.98, ensAway));

      // Re-normalize after clamping
      const total2 = ensHome + ensDraw + ensAway;
      ensHome /= total2;
      ensDraw /= total2;
      ensAway /= total2;

      // Expected score from grid
      let expHome = 0, expAway = 0;
      for (let h = 0; h < grid.length; h++) {
        for (let a = 0; a < grid[h].length; a++) {
          expHome += h * grid[h][a];
          expAway += a * grid[h][a];
        }
      }

      // Ted overlay: does Ted approve this bet?
      const tedApproved = tedResult.hasBet;
      const tedGrade = tedResult.betGrade;

      const prediction: MatchPrediction = {
        matchId,
        date: f.date,
        round: f.round,
        homeTeam: f.homeTeam,
        awayTeam: f.awayTeam,
        models: {
          dixonColes: {
            home: round4(dcProbs.home),
            draw: round4(dcProbs.draw),
            away: round4(dcProbs.away),
            expHome: dcExpGoals.home,
            expAway: dcExpGoals.away,
          },
          elo: {
            home: round4(eloProbs.home),
            draw: round4(eloProbs.draw),
            away: round4(eloProbs.away),
            homeRating: homeElo,
            awayRating: awayElo,
          },
          tedVariance: tedResult,
        },
        ensemble: {
          home: round4(ensHome),
          draw: round4(ensDraw),
          away: round4(ensAway),
          over25: round4(dcOU25.over),
          under25: round4(dcOU25.under),
          bttsYes: round4(dcBTTS.yes),
          predictedScore: {
            home: Math.round(expHome * 10) / 10,
            away: Math.round(expAway * 10) / 10,
          },
        },
        tedOverlay: {
          approved: tedApproved,
          grade: tedGrade,
          reasoning: tedResult.hasBet
            ? `Ted approves (Grade ${tedGrade}): ${tedResult.positiveFactors.join("; ")}`
            : tedResult.passReasons.length > 0
              ? `Ted passes: ${tedResult.passReasons.join("; ")}`
              : "No Ted signal",
        },
      };

      // Save to disk
      savePrediction(league, prediction, modelVersion);
      predictions.push(prediction);
    }

    // Load full history for comparison
    const allHistory = loadAllPredictions(league);
    const comparison = compareModelVersions(allHistory);

    return NextResponse.json({
      league,
      modelVersion,
      xgSource,
      usingVenueSplits: hasVenueSplits,
      predictions,
      modelComparison: comparison,
      summary: {
        fixturesPredicted: predictions.length,
        tedApproved: predictions.filter((p) => p.tedOverlay.approved).length,
        gradeA: predictions.filter((p) => p.tedOverlay.grade === "A").length,
        gradeB: predictions.filter((p) => p.tedOverlay.grade === "B").length,
        gradeC: predictions.filter((p) => p.tedOverlay.grade === "C").length,
        modelVersions: comparison.versions.length,
      },
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Ensemble API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
