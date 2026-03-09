import { NextResponse } from "next/server";
import { checkModelHealth } from "@/lib/models/health";

export async function GET() {
  const health = await checkModelHealth();
  return NextResponse.json(health);
}
