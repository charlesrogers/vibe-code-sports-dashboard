import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export async function GET() {
  const registryPath = join(process.cwd(), "data", "signal-registry.json");
  if (!existsSync(registryPath)) {
    return NextResponse.json({ signals: [] });
  }
  try {
    const data = JSON.parse(readFileSync(registryPath, "utf-8"));
    return NextResponse.json({ signals: data.signals || [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
