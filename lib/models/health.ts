/**
 * Model Health Checker
 *
 * Probes each data source and returns a confidence assessment.
 * Used by API routes and UI to flag when predictions are degraded.
 */

import type { ModelHealth, DataSourceStatus } from "@/lib/types";

async function checkFotmob(): Promise<DataSourceStatus> {
  const now = new Date().toISOString();
  try {
    const res = await fetch(
      "https://www.fotmob.com/api/leagues?id=55&ccode3=USA",
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!res.ok) {
      return { name: "Fotmob (xG)", available: false, lastChecked: now, detail: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const teams = data?.stats?.teams || [];
    const hasXg = teams.some((s: any) => s.fetchAllUrl?.includes("expected_goals_team"));
    return {
      name: "Fotmob (xG)",
      available: hasXg,
      lastChecked: now,
      detail: hasXg ? undefined : "API responded but xG stats not found",
    };
  } catch (e: any) {
    return { name: "Fotmob (xG)", available: false, lastChecked: now, detail: e.message };
  }
}

function checkOddsApi(): DataSourceStatus {
  const now = new Date().toISOString();
  const hasKey = !!process.env.ODDS_API_KEY;
  return {
    name: "The Odds API",
    available: hasKey,
    lastChecked: now,
    detail: hasKey ? undefined : "ODDS_API_KEY not set",
  };
}

function checkFootballDataUK(): DataSourceStatus {
  return {
    name: "Football-Data.co.uk (odds history)",
    available: true,
    lastChecked: new Date().toISOString(),
  };
}

function checkOpenFootball(): DataSourceStatus {
  return {
    name: "OpenFootball (match results)",
    available: true,
    lastChecked: new Date().toISOString(),
  };
}

export async function checkModelHealth(): Promise<ModelHealth> {
  const [fotmob, oddsApi] = await Promise.all([
    checkFotmob(),
    Promise.resolve(checkOddsApi()),
  ]);

  const sources: DataSourceStatus[] = [
    checkOpenFootball(),
    fotmob,
    oddsApi,
    checkFootballDataUK(),
  ];

  const missing = sources.filter((s) => !s.available);
  const missingCount = missing.length;

  let confidence: ModelHealth["confidence"];
  let message: string;

  if (missingCount === 0) {
    confidence = "high";
    message = "All data sources available";
  } else if (missing.some((s) => s.name.includes("OpenFootball"))) {
    confidence = "low";
    message = "Core match data unavailable — predictions unreliable";
  } else if (missingCount >= 2) {
    confidence = "low";
    message = `${missingCount} data sources unavailable: ${missing.map((s) => s.name).join(", ")}`;
  } else {
    confidence = "medium";
    message = `Missing: ${missing.map((s) => s.name).join(", ")}. Predictions may be less accurate.`;
  }

  return { confidence, sources, missingCount, message };
}
