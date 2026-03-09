import { NextResponse } from "next/server";
import { fetchTeamXg } from "@/lib/understat";

export async function GET() {
  try {
    const xgData = await fetchTeamXg(2024);
    return NextResponse.json(xgData);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
