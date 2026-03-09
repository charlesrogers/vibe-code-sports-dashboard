import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

interface DataSourceStatus {
  name: string;
  status: "healthy" | "stale" | "broken" | "missing";
  lastUpdated: string | null;
  detail: string;
  critical: boolean;
  usedBy: string[];
}

interface DataSourcesResponse {
  sources: DataSourceStatus[];
  hasCriticalIssue: boolean;
  criticalMessage: string | null;
}

async function checkUnderstatXg(): Promise<DataSourceStatus> {
  const name = "Understat Venue-Split xG";
  const usedBy = ["Ted Variance Model", "xG Analysis", "Value Bets"];
  const filePath = path.join(process.cwd(), "data", "xg-venue-split", "serieA.json");

  try {
    if (!fs.existsSync(filePath)) {
      return {
        name,
        status: "missing",
        lastUpdated: null,
        detail: "Cache file not found at data/xg-venue-split/serieA.json",
        critical: true,
        usedBy,
      };
    }

    const raw = fs.readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw);
    const scrapedAt = data.scrapedAt as string | undefined;

    if (!scrapedAt) {
      return {
        name,
        status: "broken",
        lastUpdated: null,
        detail: "Cache file exists but has no scrapedAt timestamp",
        critical: true,
        usedBy,
      };
    }

    const scrapedDate = new Date(scrapedAt);
    const ageMs = Date.now() - scrapedDate.getTime();
    const ageHours = ageMs / (1000 * 60 * 60);

    if (ageHours <= 24) {
      return {
        name,
        status: "healthy",
        lastUpdated: scrapedAt,
        detail: `Scraped ${ageHours.toFixed(1)} hours ago with ${data.teams?.length ?? "?"} teams`,
        critical: true,
        usedBy,
      };
    } else {
      return {
        name,
        status: "stale",
        lastUpdated: scrapedAt,
        detail: `Scraped ${ageHours.toFixed(1)} hours ago — data is older than 24h`,
        critical: true,
        usedBy,
      };
    }
  } catch (e) {
    return {
      name,
      status: "broken",
      lastUpdated: null,
      detail: `Error reading cache: ${e instanceof Error ? e.message : String(e)}`,
      critical: true,
      usedBy,
    };
  }
}

async function checkFotmobXg(): Promise<DataSourceStatus> {
  const name = "Fotmob xG (Live API)";
  const usedBy = ["xG Analysis", "Predictor"];

  try {
    const res = await fetch("https://www.fotmob.com/api/leagues?id=55&ccode3=USA", {
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return {
        name,
        status: "broken",
        lastUpdated: null,
        detail: `API returned HTTP ${res.status}`,
        critical: false,
        usedBy,
      };
    }

    const data = await res.json();
    const hasStats = data && (data.stats || data.details || data.table);

    return {
      name,
      status: hasStats ? "healthy" : "stale",
      lastUpdated: new Date().toISOString(),
      detail: hasStats ? "API responding with data" : "API responding but data structure unexpected",
      critical: false,
      usedBy,
    };
  } catch (e) {
    return {
      name,
      status: "broken",
      lastUpdated: null,
      detail: `Fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      critical: false,
      usedBy,
    };
  }
}

async function checkOpenFootball(): Promise<DataSourceStatus> {
  const name = "OpenFootball Fixtures";
  const usedBy = ["Fixtures", "Standings", "Match History"];

  try {
    // Verify the module can be loaded
    await import("@/lib/openfootball");
    return {
      name,
      status: "healthy",
      lastUpdated: new Date().toISOString(),
      detail: "Module loaded successfully",
      critical: false,
      usedBy,
    };
  } catch (e) {
    return {
      name,
      status: "broken",
      lastUpdated: null,
      detail: `Module failed to load: ${e instanceof Error ? e.message : String(e)}`,
      critical: false,
      usedBy,
    };
  }
}

async function checkOddsApi(): Promise<DataSourceStatus> {
  const name = "The Odds API";
  const usedBy = ["Live Bets", "Odds Tracker", "Value Bets"];
  const key = process.env.ODDS_API_KEY;

  if (!key) {
    return {
      name,
      status: "missing",
      lastUpdated: null,
      detail: "ODDS_API_KEY environment variable is not set",
      critical: false,
      usedBy,
    };
  }

  return {
    name,
    status: "healthy",
    lastUpdated: null,
    detail: "API key is configured",
    critical: false,
    usedBy,
  };
}

async function checkFootballDataUk(): Promise<DataSourceStatus> {
  const name = "Football-Data UK";
  const usedBy = ["Backtest", "Historical Odds"];

  try {
    const res = await fetch("https://www.football-data.co.uk/mmz4281/2526/I1.csv", {
      method: "HEAD",
      signal: AbortSignal.timeout(8000),
    });

    if (res.ok) {
      return {
        name,
        status: "healthy",
        lastUpdated: new Date().toISOString(),
        detail: "CSV endpoint responding (2025-26 Serie A)",
        critical: false,
        usedBy,
      };
    }

    return {
      name,
      status: "broken",
      lastUpdated: null,
      detail: `Endpoint returned HTTP ${res.status}`,
      critical: false,
      usedBy,
    };
  } catch (e) {
    return {
      name,
      status: "broken",
      lastUpdated: null,
      detail: `Fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      critical: false,
      usedBy,
    };
  }
}

export async function GET() {
  const sources = await Promise.all([
    checkUnderstatXg(),
    checkFotmobXg(),
    checkOpenFootball(),
    checkOddsApi(),
    checkFootballDataUk(),
  ]);

  const criticalIssues = sources.filter(
    (s) => s.critical && s.status !== "healthy"
  );

  const hasCriticalIssue = criticalIssues.length > 0;
  const criticalMessage = hasCriticalIssue
    ? criticalIssues.map((s) => `${s.name} is ${s.status}`).join("; ")
    : null;

  const response: DataSourcesResponse = {
    sources,
    hasCriticalIssue,
    criticalMessage,
  };

  return NextResponse.json(response);
}
