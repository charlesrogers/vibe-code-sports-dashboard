import { NextRequest, NextResponse } from "next/server";
import { logPicks } from "@/lib/paper-trade/logger";

// GET for Vercel cron, POST for manual trigger
async function handler(request: NextRequest) {
  // Optional auth check
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    const origin = request.headers.get("origin") || request.headers.get("referer") || "";
    const isSameOrigin = origin.includes(request.nextUrl.host);

    if (!isSameOrigin && auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await logPicks();
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
