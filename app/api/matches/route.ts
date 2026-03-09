import { NextResponse } from "next/server";
import { fetchOpenFootballMatches } from "@/lib/openfootball";

export async function GET() {
  try {
    const matches = await fetchOpenFootballMatches();
    return NextResponse.json(matches);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
