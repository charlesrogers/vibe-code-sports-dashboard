import { NextRequest, NextResponse } from "next/server";
import { getLabStorage } from "@/lib/lab/storage";

export async function GET(request: NextRequest) {
  try {
    const storage = getLabStorage();
    const name = request.nextUrl.searchParams.get("name");

    if (name) {
      const content = await storage.loadReport(name);
      if (!content) {
        return NextResponse.json({ error: "Report not found" }, { status: 404 });
      }
      return NextResponse.json({ name, content });
    }

    const reports = await storage.listReports();
    return NextResponse.json({ reports });
  } catch {
    return NextResponse.json({ reports: [] });
  }
}
