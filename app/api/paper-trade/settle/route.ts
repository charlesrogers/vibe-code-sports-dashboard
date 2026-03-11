import { NextRequest, NextResponse } from "next/server";
import { settlePendingBets } from "@/lib/paper-trade/settler";

async function handler(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await settlePendingBets();
    return NextResponse.json({
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
