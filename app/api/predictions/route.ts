import { NextRequest, NextResponse } from "next/server";
import { fetchOpenFootballMatches } from "@/lib/openfootball";
import { fitDixonColes, predictMatch, getExpectedGoals } from "@/lib/models/dixon-coles";
import { deriveAllMarkets, probabilityToDecimalOdds } from "@/lib/betting/markets";
import { DixonColesParams } from "@/lib/types";

let cachedParams: DixonColesParams | null = null;
let lastFit = 0;

async function getParams(): Promise<DixonColesParams> {
  if (cachedParams && Date.now() - lastFit < 3600000) return cachedParams;
  const matches = await fetchOpenFootballMatches();
  cachedParams = fitDixonColes(matches);
  lastFit = Date.now();
  return cachedParams;
}

export async function GET(request: NextRequest) {
  const home = request.nextUrl.searchParams.get("home");
  const away = request.nextUrl.searchParams.get("away");

  if (!home || !away) {
    return NextResponse.json({ error: "Missing home or away parameter" }, { status: 400 });
  }

  try {
    const params = await getParams();

    if (!(home in params.attack) || !(away in params.attack)) {
      return NextResponse.json({ error: `Unknown team: ${home in params.attack ? away : home}` }, { status: 400 });
    }

    const grid = predictMatch(home, away, params);
    const markets = deriveAllMarkets(grid);
    const xGoals = getExpectedGoals(home, away, params);

    // Add implied odds
    const odds = {
      home: probabilityToDecimalOdds(markets.match1X2.home),
      draw: probabilityToDecimalOdds(markets.match1X2.draw),
      away: probabilityToDecimalOdds(markets.match1X2.away),
      over25: probabilityToDecimalOdds(markets.overUnder["2.5"]?.over || 0.5),
      under25: probabilityToDecimalOdds(markets.overUnder["2.5"]?.under || 0.5),
      bttsYes: probabilityToDecimalOdds(markets.btts.yes),
      bttsNo: probabilityToDecimalOdds(markets.btts.no),
    };

    return NextResponse.json({
      homeTeam: home,
      awayTeam: away,
      expectedGoals: xGoals,
      grid: grid.slice(0, 7).map((row) => row.slice(0, 7)), // 7x7 for display
      markets,
      odds,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
