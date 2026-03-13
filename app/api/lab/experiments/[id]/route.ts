import { NextResponse } from "next/server";
import { getLabStorage } from "@/lib/lab/storage";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const storage = getLabStorage();
    const data = await storage.loadExperiment(id);
    if (!data) {
      return NextResponse.json({ error: `Experiment "${id}" not found` }, { status: 404 });
    }
    return NextResponse.json({ id, ...data });
  } catch {
    return NextResponse.json({ error: `Experiment "${id}" not found` }, { status: 404 });
  }
}
