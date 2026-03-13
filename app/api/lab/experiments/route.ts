import { NextRequest, NextResponse } from "next/server";
import { getLabStorage } from "@/lib/lab/storage";

export async function GET() {
  try {
    const storage = getLabStorage();
    const ids = await storage.listExperiments();
    const experiments = [];
    for (const id of ids) {
      const data = await storage.loadExperiment(id);
      if (data) experiments.push({ id, ...data });
    }
    return NextResponse.json({ experiments });
  } catch {
    return NextResponse.json({ experiments: [] });
  }
}

export async function POST(request: NextRequest) {
  try {
    const storage = getLabStorage();
    const body = await request.json();
    const { name, hypothesis, metric, threshold } = body;

    if (!name || !hypothesis) {
      return NextResponse.json({ error: "name and hypothesis required" }, { status: 400 });
    }

    const registry = await storage.loadRegistry();
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    if (registry.signals.some((s) => s.id === id)) {
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
    await storage.saveRegistry(registry);

    return NextResponse.json({ created: entry });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const storage = getLabStorage();
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: "id and status required" }, { status: 400 });
    }

    const validStatuses = ["pending", "testing", "accepted", "rejected", "graveyard"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: `Invalid status. Must be: ${validStatuses.join(", ")}` }, { status: 400 });
    }

    const registry = await storage.loadRegistry();
    const signal = registry.signals.find((s) => s.id === id);
    if (!signal) {
      return NextResponse.json({ error: `Signal "${id}" not found` }, { status: 404 });
    }

    signal.status = status;
    await storage.saveRegistry(registry);

    return NextResponse.json({ updated: signal });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
