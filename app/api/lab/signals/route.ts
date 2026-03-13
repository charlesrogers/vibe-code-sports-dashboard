import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export async function GET() {
  const registryPath = join(process.cwd(), "data", "signal-registry.json");
  try {
    if (!existsSync(registryPath)) {
      return NextResponse.json({ signals: [] });
    }
    const data = JSON.parse(readFileSync(registryPath, "utf-8"));
    return NextResponse.json({ signals: data.signals || [] });
  } catch {
    return NextResponse.json({ signals: [] });
  }
}
