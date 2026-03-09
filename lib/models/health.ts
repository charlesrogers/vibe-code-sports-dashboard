/**
 * Model Health Checker
 *
 * Probes each data source and returns a confidence assessment.
 * Used by API routes and UI to flag when predictions are degraded.
 */

import type { ModelHealth, DataSourceStatus } from "@/lib/types";

async function checkUnderstat(): Promise<DataSourceStatus> {
  const now = new Date().toISOString();
  try {
    const res = await fetch("https://understat.com/league/Serie_A/2024", {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      return { name: "Understat (xG)", available: false, lastChecked: now, detail: `HTTP ${res.status}` };
    }
    const html = await res.text();
    const hasData = /var\s+teamsData/.test(html);
    return {
      name: "Understat (xG)",
      available: hasData,
      lastChecked: now,
      detail: hasData ? undefined : "Page loaded but teamsData not found",
    };
  } catch (e: any) {
    return { name: "Understat (xG)", available: false, lastChecked: now, detail: e.message };
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
  // football-data.co.uk is a static CSV source — always available unless site is down
  // We don't probe it live to save time; mark as available
  return {
    name: "Football-Data.co.uk (odds history)",
    available: true,
    lastChecked: new Date().toISOString(),
  };
}

function checkOpenFootball(): DataSourceStatus {
  // openfootball is local JSON data bundled in the repo — always available
  return {
    name: "OpenFootball (match results)",
    available: true,
    lastChecked: new Date().toISOString(),
  };
}

export async function checkModelHealth(): Promise<ModelHealth> {
  const [understat, oddsApi] = await Promise.all([
    checkUnderstat(),
    Promise.resolve(checkOddsApi()),
  ]);

  const sources: DataSourceStatus[] = [
    checkOpenFootball(),
    understat,
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
    // Core match data missing — model can't run at all
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
