/**
 * Understat data persistence layer.
 *
 * Stores raw match history and venue-split xG data both locally
 * (data/understat-cache/) and in Vercel Blob. When the live API is
 * down, everything keeps running from the cache.
 *
 * Data stored:
 *   1. Raw per-match history (needed for walk-forward model eval)
 *   2. Venue-split aggregated xG (needed for Ted Variance)
 *   3. Metadata: last successful pull timestamp per league/season
 */

import type { UnderstatTeamHistory, VenueSplitXg } from "./understat";

// ---------------------------------------------------------------------------
// Cache shapes
// ---------------------------------------------------------------------------

export interface UnderstatCacheEntry {
  league: string;
  season: string;
  fetchedAt: string;
  rawHistory: UnderstatTeamHistory[];
  venueSplits: VenueSplitXg[];
}

export interface UnderstatCacheMeta {
  lastPull: Record<string, string>; // key: "{league}-{season}" → ISO timestamp
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const useBlob = (): boolean => !!process.env.BLOB_READ_WRITE_TOKEN;

function cacheDir(): string {
  const { join } = require("path") as typeof import("path");
  return join(process.cwd(), "data", "understat-cache");
}

function ensureDir(): void {
  const fs = require("fs") as typeof import("fs");
  const dir = cacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function cacheKey(league: string, season: string): string {
  return `${league}-${season}`;
}

function blobPath(league: string, season: string): string {
  return `understat-cache/${league}-${season}.json`;
}

function metaBlobPath(): string {
  return "understat-cache/_meta.json";
}

// ---------------------------------------------------------------------------
// Save — writes to local disk AND Vercel Blob (if available)
// ---------------------------------------------------------------------------

export async function saveUnderstatCache(entry: UnderstatCacheEntry): Promise<void> {
  const key = cacheKey(entry.league, entry.season);

  // Always save locally
  try {
    const fs = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    ensureDir();
    const filePath = join(cacheDir(), `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(entry, null, 2));

    // Update meta
    const metaPath = join(cacheDir(), "_meta.json");
    let meta: UnderstatCacheMeta = { lastPull: {} };
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, "utf-8")); } catch { /* ignore */ }
    }
    meta.lastPull[key] = entry.fetchedAt;
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch (e) {
    console.warn("[understat-cache] Local save failed:", e);
  }

  // Also save to Vercel Blob if available
  if (useBlob()) {
    try {
      const { put, list, del } = await import("@vercel/blob");
      const path = blobPath(entry.league, entry.season);

      // Remove existing blob
      try {
        const existing = await list({ prefix: path, limit: 1 });
        for (const blob of existing.blobs) await del(blob.url);
      } catch { /* ignore */ }

      await put(path, JSON.stringify(entry), {
        access: "public",
        addRandomSuffix: false,
      });

      // Update meta in Blob
      const mp = metaBlobPath();
      let meta: UnderstatCacheMeta = { lastPull: {} };
      try {
        const existing = await list({ prefix: mp, limit: 1 });
        if (existing.blobs.length > 0) {
          const res = await fetch(existing.blobs[0].url);
          if (res.ok) meta = await res.json();
        }
      } catch { /* ignore */ }
      meta.lastPull[key] = entry.fetchedAt;

      try {
        const existing = await list({ prefix: mp, limit: 1 });
        for (const blob of existing.blobs) await del(blob.url);
      } catch { /* ignore */ }
      await put(mp, JSON.stringify(meta), {
        access: "public",
        addRandomSuffix: false,
      });

      console.log(`[understat-cache] Saved to Blob: ${path}`);
    } catch (e) {
      console.warn("[understat-cache] Blob save failed:", e);
    }
  }
}

// ---------------------------------------------------------------------------
// Load — tries local disk first, then Vercel Blob
// ---------------------------------------------------------------------------

export async function loadUnderstatCache(
  league: string,
  season: string
): Promise<UnderstatCacheEntry | null> {
  const key = cacheKey(league, season);

  // Try local disk first
  try {
    const fs = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const filePath = join(cacheDir(), `${key}.json`);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8")) as UnderstatCacheEntry;
      console.log(`[understat-cache] Loaded from disk: ${key} (fetched ${data.fetchedAt})`);
      return data;
    }
  } catch { /* ignore */ }

  // Try Vercel Blob
  if (useBlob()) {
    try {
      const { list } = await import("@vercel/blob");
      const path = blobPath(league, season);
      const result = await list({ prefix: path, limit: 1 });
      if (result.blobs.length > 0) {
        const res = await fetch(result.blobs[0].url);
        if (res.ok) {
          const data = (await res.json()) as UnderstatCacheEntry;
          console.log(`[understat-cache] Loaded from Blob: ${key} (fetched ${data.fetchedAt})`);
          return data;
        }
      }
    } catch { /* ignore */ }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Meta — get last pull timestamps
// ---------------------------------------------------------------------------

export async function getUnderstatCacheMeta(): Promise<UnderstatCacheMeta> {
  // Try local
  try {
    const fs = require("fs") as typeof import("fs");
    const { join } = require("path") as typeof import("path");
    const metaPath = join(cacheDir(), "_meta.json");
    if (fs.existsSync(metaPath)) {
      return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    }
  } catch { /* ignore */ }

  // Try Blob
  if (useBlob()) {
    try {
      const { list } = await import("@vercel/blob");
      const result = await list({ prefix: metaBlobPath(), limit: 1 });
      if (result.blobs.length > 0) {
        const res = await fetch(result.blobs[0].url);
        if (res.ok) return await res.json();
      }
    } catch { /* ignore */ }
  }

  return { lastPull: {} };
}
