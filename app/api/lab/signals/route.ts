import { NextResponse } from "next/server";
import { getLabStorage } from "@/lib/lab/storage";

export async function GET() {
  try {
    const storage = getLabStorage();
    const registry = await storage.loadRegistry();
    return NextResponse.json({ signals: registry.signals || [] });
  } catch {
    return NextResponse.json({ signals: [] });
  }
}
