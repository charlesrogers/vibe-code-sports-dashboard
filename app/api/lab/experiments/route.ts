import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";

const experimentsDir = join(process.cwd(), "data", "experiments");
const registryPath = join(process.cwd(), "data", "signal-registry.json");

export async function GET() {
  if (!existsSync(experimentsDir)) {
    return NextResponse.json({ experiments: [] });
  }
  try {
    const files = readdirSync(experimentsDir).filter(f => f.endsWith(".json"));
    const experiments = files.map(f => {
      const data = JSON.parse(readFileSync(join(experimentsDir, f), "utf-8"));
      return { id: f.replace(".json", ""), ...data };
    });
    return NextResponse.json({ experiments });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, hypothesis, metric, threshold } = body;

    if (!name || !hypothesis) {
      return NextResponse.json({ error: "name and hypothesis required" }, { status: 400 });
    }

    // Add to signal registry
    if (!existsSync(registryPath)) {
      return NextResponse.json({ error: "signal-registry.json not found" }, { status: 500 });
    }

    const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // Check for duplicate
    if (registry.signals.some((s: { id: string }) => s.id === id)) {
      return NextResponse.json({ error: `Signal "${id}" already exists` }, { status: 409 });
    }

    const entry = {
      id,
      registered: new Date().toISOString().slice(0, 10),
      hypothesis,
      metric: metric || "TBD",
      threshold: threshold || "TBD",
      status: "pending",
    };

    registry.signals.push(entry);
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));

    return NextResponse.json({ created: entry });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: "id and status required" }, { status: 400 });
    }

    const validStatuses = ["pending", "testing", "accepted", "rejected", "graveyard"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be: ${validStatuses.join(", ")}` }, { status: 400 });
    }

    const registry = JSON.parse(readFileSync(registryPath, "utf-8"));
    const signal = registry.signals.find((s: { id: string }) => s.id === id);
    if (!signal) {
      return NextResponse.json({ error: `Signal "${id}" not found` }, { status: 404 });
    }

    signal.status = status;
    writeFileSync(registryPath, JSON.stringify(registry, null, 2));

    return NextResponse.json({ updated: signal });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
