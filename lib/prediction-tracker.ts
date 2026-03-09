/**
 * Prediction Tracker — stores and versions every prediction
 *
 * Every time we generate predictions, we stamp them with a model version.
 * When the model changes (weights, data sources, filters), the version hash
 * changes and we can compare old vs new predictions side-by-side.
 *
 * Storage: JSON files in data/predictions/{league}/{matchId}.json
 * Each file contains all predictions ever made for that match.
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

export interface ModelVersion {
  hash: string;
  label: string;
  timestamp: string;
  config: {
    weights: { dixonColes: number; elo: number; market: number; tedVariance: number };
    dataSources: string[];
    tedFiltersEnabled: boolean;
    injuryDataIncluded: boolean;
    venueSplitXg: boolean;
  };
}

export interface MatchPrediction {
  matchId: string;
  date: string;
  round?: number;
  homeTeam: string;
  awayTeam: string;

  // Individual model outputs
  models: {
    dixonColes: { home: number; draw: number; away: number; expHome: number; expAway: number };
    elo: { home: number; draw: number; away: number; homeRating: number; awayRating: number };
    market?: { home: number; draw: number; away: number; rawOdds?: { home: number; draw: number; away: number } };
    tedVariance: {
      edge: number;
      edgeSide: "home" | "away" | "neutral";
      hasBet: boolean;
      betGrade: "A" | "B" | "C" | null;
      confidence: number;
      positiveFactors: string[];
      passReasons: string[];
    };
  };

  // Master ensemble output
  ensemble: {
    home: number;
    draw: number;
    away: number;
    over25: number;
    under25: number;
    bttsYes: number;
    predictedScore: { home: number; away: number };
  };

  // Value assessment vs market
  value?: {
    bestBet: string;
    edge: number;
    kellyStake: number;
    fairOdds: number;
    marketOdds: number;
  };

  // Ted's overlay assessment
  tedOverlay: {
    approved: boolean;
    grade: "A" | "B" | "C" | null;
    reasoning: string;
  };
}

export interface StoredPrediction {
  modelVersion: ModelVersion;
  prediction: MatchPrediction;
  generatedAt: string;
}

export interface MatchPredictionHistory {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  date: string;
  round?: number;
  predictions: StoredPrediction[];
  actualResult?: {
    homeGoals: number;
    awayGoals: number;
    result: "H" | "D" | "A";
  };
}

/**
 * Generate a deterministic version hash from model config
 */
export function computeModelVersionHash(config: ModelVersion["config"]): string {
  const serialized = JSON.stringify(config, Object.keys(config).sort());
  return crypto.createHash("sha256").update(serialized).digest("hex").slice(0, 12);
}

/**
 * Create a model version object from current config
 */
export function createModelVersion(
  config: ModelVersion["config"],
  label?: string
): ModelVersion {
  const hash = computeModelVersionHash(config);
  return {
    hash,
    label: label || `v-${hash.slice(0, 6)}`,
    timestamp: new Date().toISOString(),
    config,
  };
}

/**
 * Generate a stable match ID
 */
export function makeMatchId(date: string, homeTeam: string, awayTeam: string): string {
  return `${date}_${homeTeam.replace(/\s+/g, "-")}_vs_${awayTeam.replace(/\s+/g, "-")}`;
}

// Storage helpers

function getPredictionsDir(league: string): string {
  return path.join(process.cwd(), "data", "predictions", league);
}

function getMatchFile(league: string, matchId: string): string {
  return path.join(getPredictionsDir(league), `${matchId}.json`);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Save a prediction for a match
 */
export function savePrediction(
  league: string,
  prediction: MatchPrediction,
  modelVersion: ModelVersion
): void {
  const dir = getPredictionsDir(league);
  ensureDir(dir);

  const filePath = getMatchFile(league, prediction.matchId);

  let history: MatchPredictionHistory;
  if (fs.existsSync(filePath)) {
    history = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } else {
    history = {
      matchId: prediction.matchId,
      homeTeam: prediction.homeTeam,
      awayTeam: prediction.awayTeam,
      date: prediction.date,
      round: prediction.round,
      predictions: [],
    };
  }

  // Don't duplicate: replace if same model version already exists
  history.predictions = history.predictions.filter(
    (p) => p.modelVersion.hash !== modelVersion.hash
  );

  history.predictions.push({
    modelVersion,
    prediction,
    generatedAt: new Date().toISOString(),
  });

  // Sort by generation time
  history.predictions.sort(
    (a, b) => new Date(a.generatedAt).getTime() - new Date(b.generatedAt).getTime()
  );

  fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
}

/**
 * Load prediction history for a specific match
 */
export function loadMatchHistory(
  league: string,
  matchId: string
): MatchPredictionHistory | null {
  const filePath = getMatchFile(league, matchId);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

/**
 * Load all prediction histories for a league
 */
export function loadAllPredictions(league: string): MatchPredictionHistory[] {
  const dir = getPredictionsDir(league);
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as MatchPredictionHistory)
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Update a match with its actual result
 */
export function recordActualResult(
  league: string,
  matchId: string,
  homeGoals: number,
  awayGoals: number
): void {
  const filePath = getMatchFile(league, matchId);
  if (!fs.existsSync(filePath)) return;

  const history: MatchPredictionHistory = JSON.parse(
    fs.readFileSync(filePath, "utf-8")
  );

  history.actualResult = {
    homeGoals,
    awayGoals,
    result: homeGoals > awayGoals ? "H" : homeGoals < awayGoals ? "A" : "D",
  };

  fs.writeFileSync(filePath, JSON.stringify(history, null, 2));
}

/**
 * Get summary stats comparing model versions
 */
export function compareModelVersions(
  predictions: MatchPredictionHistory[]
): {
  versions: {
    hash: string;
    label: string;
    timestamp: string;
    matchCount: number;
    brierScore: number | null;
    accuracy: number | null;
    tedApprovalRate: number;
    avgEdge: number | null;
  }[];
} {
  // Collect all versions across all matches
  const versionMap = new Map<
    string,
    {
      version: ModelVersion;
      predictions: { pred: MatchPrediction; actual?: MatchPredictionHistory["actualResult"] }[];
    }
  >();

  for (const match of predictions) {
    for (const stored of match.predictions) {
      const hash = stored.modelVersion.hash;
      if (!versionMap.has(hash)) {
        versionMap.set(hash, { version: stored.modelVersion, predictions: [] });
      }
      versionMap.get(hash)!.predictions.push({
        pred: stored.prediction,
        actual: match.actualResult,
      });
    }
  }

  const versions = [...versionMap.entries()].map(([hash, data]) => {
    const withResults = data.predictions.filter((p) => p.actual);
    let brierScore: number | null = null;
    let accuracy: number | null = null;
    let avgEdge: number | null = null;

    if (withResults.length > 0) {
      let brierSum = 0;
      let correct = 0;
      let edgeSum = 0;
      let edgeCount = 0;

      for (const { pred, actual } of withResults) {
        const actH = actual!.result === "H" ? 1 : 0;
        const actD = actual!.result === "D" ? 1 : 0;
        const actA = actual!.result === "A" ? 1 : 0;
        brierSum +=
          (pred.ensemble.home - actH) ** 2 +
          (pred.ensemble.draw - actD) ** 2 +
          (pred.ensemble.away - actA) ** 2;

        const predicted =
          pred.ensemble.home >= pred.ensemble.draw && pred.ensemble.home >= pred.ensemble.away
            ? "H"
            : pred.ensemble.away >= pred.ensemble.draw
              ? "A"
              : "D";
        if (predicted === actual!.result) correct++;

        if (pred.value) {
          edgeSum += pred.value.edge;
          edgeCount++;
        }
      }

      brierScore = Math.round((brierSum / withResults.length) * 10000) / 10000;
      accuracy = Math.round((correct / withResults.length) * 1000) / 10;
      avgEdge = edgeCount > 0 ? Math.round((edgeSum / edgeCount) * 1000) / 10 : null;
    }

    const tedApproved = data.predictions.filter((p) => p.pred.tedOverlay.approved).length;
    const tedApprovalRate =
      Math.round((tedApproved / data.predictions.length) * 1000) / 10;

    return {
      hash,
      label: data.version.label,
      timestamp: data.version.timestamp,
      matchCount: data.predictions.length,
      brierScore,
      accuracy,
      tedApprovalRate,
      avgEdge,
    };
  });

  return { versions: versions.sort((a, b) => a.timestamp.localeCompare(b.timestamp)) };
}
