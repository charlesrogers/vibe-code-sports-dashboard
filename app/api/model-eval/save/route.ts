/**
 * Model Evaluation Save/List API
 *
 * POST: Save evaluation results to local file and optionally Vercel Blob
 * GET:  List all saved evaluations
 *
 * Follows the dual-storage pattern from lib/odds-collector/storage.ts:
 *   - Local: writes JSON to data/evaluations/
 *   - Vercel: uses @vercel/blob when BLOB_READ_WRITE_TOKEN is set
 */

import { NextRequest, NextResponse } from "next/server";

const BLOB_PREFIX = "evaluations";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDataDir() {
  const { join } = require("path");
  return join(process.cwd(), "data", "evaluations");
}

function ensureDir() {
  const { existsSync, mkdirSync } = require("fs");
  const dir = getDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function buildFileName(league: string, season: string, withTimestamp: boolean): string {
  if (withTimestamp) {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    return `eval-${league}-${season}-${ts}.json`;
  }
  return `eval-${league}-${season}.json`;
}

// ---------------------------------------------------------------------------
// Blob helpers (only used when BLOB_READ_WRITE_TOKEN is available)
// ---------------------------------------------------------------------------

async function saveToBlobStorage(fileName: string, data: unknown): Promise<string> {
  const { put, list, del } = await import("@vercel/blob");
  const key = `${BLOB_PREFIX}/${fileName}`;

  // Delete existing blob with this key (put doesn't overwrite by path)
  try {
    const existing = await list({ prefix: key, limit: 1 });
    for (const blob of existing.blobs) {
      await del(blob.url);
    }
  } catch {
    // Ignore delete errors
  }

  const blob = await put(key, JSON.stringify(data, null, 2), {
    access: "public",
    addRandomSuffix: false,
  });

  return blob.url;
}

async function listBlobEvaluations(): Promise<{ name: string; url: string; uploadedAt: string }[]> {
  const { list } = await import("@vercel/blob");
  const result = await list({ prefix: `${BLOB_PREFIX}/` });

  return result.blobs
    .filter((b) => b.pathname.endsWith(".json"))
    .map((b) => ({
      name: b.pathname.replace(`${BLOB_PREFIX}/`, ""),
      url: b.url,
      uploadedAt: b.uploadedAt.toISOString(),
    }));
}

// ---------------------------------------------------------------------------
// POST — Save evaluation results
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { league, season, data } = body;

    if (!league || !season || !data) {
      return NextResponse.json(
        { error: "Missing required fields: league, season, data" },
        { status: 400 }
      );
    }

    const fileName = buildFileName(league, season, true);
    const savedPaths: { local?: string; blob?: string } = {};

    // 1. Always save locally
    const { writeFileSync } = require("fs");
    const { join } = require("path");
    ensureDir();
    const localPath = join(getDataDir(), fileName);
    writeFileSync(localPath, JSON.stringify(data, null, 2));
    savedPaths.local = localPath;

    // 2. If BLOB_READ_WRITE_TOKEN is available, also save to Vercel Blob
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const blobUrl = await saveToBlobStorage(fileName, data);
        savedPaths.blob = blobUrl;
      } catch (e) {
        console.error("Blob save failed (continuing with local only):", e);
      }
    }

    return NextResponse.json({
      success: true,
      fileName,
      paths: savedPaths,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("Save eval error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET — List all saved evaluations
// ---------------------------------------------------------------------------

export async function GET() {
  try {
    const { readdirSync, statSync, existsSync } = require("fs");
    const { join } = require("path");

    const results: {
      local: { name: string; size: number; modified: string }[];
      blob: { name: string; url: string; uploadedAt: string }[];
    } = { local: [], blob: [] };

    // 1. List local files
    const dir = getDataDir();
    if (existsSync(dir)) {
      const files = readdirSync(dir) as string[];
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        results.local.push({
          name: file,
          size: stat.size,
          modified: stat.mtime.toISOString(),
        });
      }
      results.local.sort((a, b) => b.modified.localeCompare(a.modified));
    }

    // 2. List blob files if available
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        results.blob = await listBlobEvaluations();
      } catch (e) {
        console.error("Blob list failed:", e);
      }
    }

    return NextResponse.json(results);
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error("List eval error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
