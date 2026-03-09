/**
 * xG data caching system.
 *
 * Saves timestamped xG snapshots so data survives even if upstream sources
 * (Fotmob, Understat) go down.
 *
 * Storage:
 *   - Locally (no BLOB_READ_WRITE_TOKEN): JSON files under data/xg-cache/
 *   - On Vercel: @vercel/blob with key pattern xg-cache/{league}/{YYYY-MM-DD}.json
 */

import type { TeamXg } from "./types";

// ---------------------------------------------------------------------------
// Snapshot shape stored in cache
// ---------------------------------------------------------------------------

export interface XgSnapshot {
  timestamp: string;
  league: string;
  source: string;
  teams: TeamXg[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayKey(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function blobKey(league: string, dateKey: string): string {
  return `xg-cache/${league}/${dateKey}.json`;
}

const useBlob = (): boolean => !!process.env.BLOB_READ_WRITE_TOKEN;

// ---------------------------------------------------------------------------
// File-based helpers (local dev)
// ---------------------------------------------------------------------------

function localDir(league: string): string {
  const { join } = require("path") as typeof import("path");
  return join(process.cwd(), "data", "xg-cache", league);
}

function ensureLocalDir(league: string): void {
  const fs = require("fs") as typeof import("fs");
  const dir = localDir(league);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// cacheXgSnapshot — persist a snapshot
// ---------------------------------------------------------------------------

export async function cacheXgSnapshot(
  league: string,
  data: TeamXg[],
  source = "fotmob"
): Promise<void> {
  const snapshot: XgSnapshot = {
    timestamp: new Date().toISOString(),
    league,
    source,
    teams: data,
  };

  const dateKey = todayKey();
  const key = blobKey(league, dateKey);

  if (useBlob()) {
    const { put, list, del } = await import("@vercel/blob");

    // Remove any existing blob at this key (put does not overwrite by path)
    try {
      const existing = await list({ prefix: key, limit: 1 });
      for (const blob of existing.blobs) {
        await del(blob.url);
      }
    } catch {
      // ignore
    }

    await put(key, JSON.stringify(snapshot, null, 2), {
      access: "public",
      addRandomSuffix: false,
    });
  } else {
    const fs = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    ensureLocalDir(league);
    const filePath = join(localDir(league), `${dateKey}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  }
}

// ---------------------------------------------------------------------------
// loadCachedXg — load the most recent cached snapshot for a league
// ---------------------------------------------------------------------------

export async function loadCachedXg(
  league: string
): Promise<XgSnapshot | null> {
  if (useBlob()) {
    try {
      const { list } = await import("@vercel/blob");
      const prefix = `xg-cache/${league}/`;
      const result = await list({ prefix });

      if (result.blobs.length === 0) return null;

      // Blob pathnames sort lexicographically, and date keys are YYYY-MM-DD,
      // so the last entry is the most recent.
      const sorted = result.blobs
        .filter((b) => b.pathname.endsWith(".json"))
        .sort((a, b) => a.pathname.localeCompare(b.pathname));

      if (sorted.length === 0) return null;

      const latest = sorted[sorted.length - 1];
      const res = await fetch(latest.url);
      if (!res.ok) return null;
      return (await res.json()) as XgSnapshot;
    } catch {
      return null;
    }
  }

  // Local file fallback
  try {
    const fs = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const dir = localDir(league);

    if (!fs.existsSync(dir)) return null;

    const files = (fs.readdirSync(dir) as string[])
      .filter((f: string) => f.endsWith(".json"))
      .sort();

    if (files.length === 0) return null;

    const latest = files[files.length - 1];
    const raw = fs.readFileSync(join(dir, latest), "utf-8");
    return JSON.parse(raw) as XgSnapshot;
  } catch {
    return null;
  }
}
