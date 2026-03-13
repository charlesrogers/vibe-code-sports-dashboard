import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getUnderstatCacheMeta } from "@/lib/understat-cache";

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

async function checkUnderstatLiveApi(): Promise<DataSourceStatus> {
  const name = "Understat xG (Live API)";
  const usedBy = ["Ted Variance Model", "xG Analysis"];

  try {
    const res = await fetch(
      "https://understat.com/getLeagueData/Serie_A/2025",
      {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "X-Requested-With": "XMLHttpRequest",
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) {
      return {
        name,
        status: "broken",
        lastUpdated: null,
        detail: `API returned HTTP ${res.status}`,
        critical: false, // not critical — file cache fallback exists
        usedBy,
      };
    }

    const data = await res.json();
    const teamCount = data?.teams ? Object.keys(data.teams).length : 0;

    if (teamCount === 0) {
      return {
        name,
        status: "broken",
        lastUpdated: null,
        detail: "API responded but returned no team data",
        critical: false,
        usedBy,
      };
    }

    return {
      name,
      status: "healthy",
      lastUpdated: new Date().toISOString(),
      detail: `Live API responding with ${teamCount} teams and venue-split xG`,
      critical: false,
      usedBy,
    };
  } catch (e) {
    return {
      name,
      status: "broken",
      lastUpdated: null,
      detail: `Fetch failed: ${e instanceof Error ? e.message : String(e)}`,
      critical: false, // file cache + football-data.co.uk odds provide fallback
      usedBy,
    };
  }
}

async function checkUnderstatXgCache(): Promise<DataSourceStatus> {
  const name = "Understat xG (Cached Data)";
  const usedBy = ["Ted Variance Model", "Model Evaluation", "xG Analysis"];

  try {
    // Check the unified cache metadata first
    const meta = await getUnderstatCacheMeta();
    const lastPull = meta.lastPull["serieA-2025"];

    if (lastPull) {
      const ageMs = Date.now() - new Date(lastPull).getTime();
      const ageHours = ageMs / (1000 * 60 * 60);

      return {
        name,
        status: ageHours <= 48 ? "healthy" : "stale",
        lastUpdated: lastPull,
        detail: `Last successful pull: ${ageHours.toFixed(1)}h ago (${ageHours <= 48 ? "fresh" : "may need refresh"})`,
        critical: false,
        usedBy,
      };
    }

    // Fall back to legacy venue-split file
    const filePath = path.join(process.cwd(), "data", "xg-venue-split", "serieA.json");
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = JSON.parse(raw);
      const scrapedAt = data.scrapedAt as string | undefined;
      if (scrapedAt) {
        const ageHours = (Date.now() - new Date(scrapedAt).getTime()) / 3600000;
        return {
          name,
          status: ageHours <= 48 ? "healthy" : "stale",
          lastUpdated: scrapedAt,
          detail: `Legacy cache: ${ageHours.toFixed(1)}h old with ${data.teams?.length ?? "?"} teams`,
          critical: false,
          usedBy,
        };
      }
    }

    return {
      name,
      status: "missing",
      lastUpdated: null,
      detail: "No cached Understat data found — will populate on first successful API call",
      critical: false,
      usedBy,
    };
  } catch (e) {
    return {
      name,
      status: "broken",
      lastUpdated: null,
      detail: `Error reading cache: ${e instanceof Error ? e.message : String(e)}`,
      critical: false,
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

async function checkInjuryData(): Promise<DataSourceStatus> {
  const name = "Fotmob Injuries";
  const usedBy = ["Ted Variance Model", "Match Previews"];

  try {
    // Quick check: fetch one team to see if the API works
    const res = await fetch(
      "https://www.fotmob.com/api/teams?id=8636&ccode3=USA",
      {
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000),
      }
    );

    if (!res.ok) {
      return {
        name,
        status: "broken",
        lastUpdated: null,
        detail: `Fotmob team API returned HTTP ${res.status}`,
        critical: false,
        usedBy,
      };
    }

    const data = await res.json();
    const hasSquad = data?.squad?.squad?.length > 0;

    return {
      name,
      status: hasSquad ? "healthy" : "stale",
      lastUpdated: new Date().toISOString(),
      detail: hasSquad
        ? "Injury and squad data available via Fotmob team API"
        : "API responding but squad data missing",
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
    checkUnderstatLiveApi(),
    checkUnderstatXgCache(),
    checkFotmobXg(),
    checkOpenFootball(),
    checkOddsApi(),
    checkFootballDataUk(),
    checkInjuryData(),
  ]);

  // Understat is only critical if BOTH live API AND file cache are broken
  const understatLive = sources.find((s) => s.name === "Understat xG (Live API)");
  const understatCache = sources.find((s) => s.name === "Understat xG (Cached Data)");
  const understatFullyDown = understatLive?.status !== "healthy" &&
    (understatCache?.status === "broken" || understatCache?.status === "missing");

  const criticalIssues = sources.filter(
    (s) => s.critical && s.status !== "healthy"
  );
  if (understatFullyDown) {
    criticalIssues.push({
      name: "Understat xG (all sources)",
      status: "broken",
      lastUpdated: null,
      detail: "Both live API and file cache are unavailable",
      critical: true,
      usedBy: ["Ted Variance Model", "xG Analysis"],
    });
  }

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
