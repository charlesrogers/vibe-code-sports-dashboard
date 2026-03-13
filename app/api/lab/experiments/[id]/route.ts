import { NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const filePath = join(process.cwd(), "data", "experiments", `${id}.json`);
    if (!existsSync(filePath)) {
      return NextResponse.json({ error: `Experiment "${id}" not found` }, { status: 404 });
    }
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    return NextResponse.json({ id, ...data });
  } catch {
    return NextResponse.json({ error: `Experiment "${id}" not found` }, { status: 404 });
  }
}
