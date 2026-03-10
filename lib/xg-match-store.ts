/**
 * Unified match-level xG store.
 *
 * Persists individual match xG records (one per match) to:
 *   1. Local disk at data/xg-matches/{league}-{season}.json
 *   2. Vercel Blob (when BLOB_READ_WRITE_TOKEN is present)
 *
 * Deduplicates by record `id` ("{date}_{homeTeam}_vs_{awayTeam}").
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MatchXgRecord {
  id: string; // "{date}_{homeTeam}_vs_{awayTeam}"
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeXg: number;
  awayXg: number;
  homeGoals: number;
  awayGoals: number;
  league: string;
  season: string;
  source: string; // "fotmob" | "sofascore" | "understat" | etc.
  fetchedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const useBlob = (): boolean => !!process.env.BLOB_READ_WRITE_TOKEN;

function dataDir(): string {
  const { join } = require("path") as typeof import("path");
  return join(process.cwd(), "data", "xg-matches");
}

function ensureDir(): void {
  const fs = require("fs") as typeof import("fs");
  const dir = dataDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function fileKey(league: string, season: string): string {
  return `${league}-${season}`;
}

function localPath(league: string, season: string): string {
  const { join } = require("path") as typeof import("path");
  return join(dataDir(), `${fileKey(league, season)}.json`);
}

function blobPath(league: string, season: string): string {
  return `xg-matches/${fileKey(league, season)}.json`;
}

// ---------------------------------------------------------------------------
// Save — appends records, deduplicates by id, writes local + Blob
// ---------------------------------------------------------------------------

export async function saveMatchXg(records: MatchXgRecord[]): Promise<void> {
  if (records.length === 0) return;

  // Group records by league-season
  const groups = new Map<string, MatchXgRecord[]>();
  for (const r of records) {
    const key = fileKey(r.league, r.season);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  for (const key of Array.from(groups.keys())) {
    const groupRecords = groups.get(key)!;
    const { league, season } = groupRecords[0];

    // Load existing records
    const existing = await loadMatchXg(league, season);
    const byId = new Map<string, MatchXgRecord>();
    for (const r of existing) byId.set(r.id, r);

    // Merge new records (overwrite duplicates)
    for (const r of groupRecords) byId.set(r.id, r);

    const merged = Array.from(byId.values()).sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
    );

    // Save locally
    try {
      const fs = require("fs") as typeof import("fs");
      ensureDir();
      const filePath = localPath(league, season);
      fs.writeFileSync(filePath, JSON.stringify(merged, null, 2));
      console.log(
        `[xg-match-store] Saved ${merged.length} records to disk: ${fileKey(league, season)}`
      );
    } catch (e) {
      console.warn("[xg-match-store] Local save failed:", e);
    }

    // Save to Vercel Blob
    if (useBlob()) {
      try {
        const { put, list, del } = await import("@vercel/blob");
        const path = blobPath(league, season);

        // Remove existing blob
        try {
          const existing = await list({ prefix: path, limit: 1 });
          for (const blob of existing.blobs) await del(blob.url);
        } catch {
          /* ignore */
        }

        await put(path, JSON.stringify(merged), {
          access: "public",
          addRandomSuffix: false,
        });
        console.log(`[xg-match-store] Saved to Blob: ${path}`);
      } catch (e) {
        console.warn("[xg-match-store] Blob save failed:", e);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Load — local disk first, then Blob fallback
// ---------------------------------------------------------------------------

export async function loadMatchXg(
  league: string,
  season?: string
): Promise<MatchXgRecord[]> {
  const resolvedSeason = season ?? currentSeason();

  // Try local disk first
  try {
    const fs = require("fs") as typeof import("fs");
    const filePath = localPath(league, resolvedSeason);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(
        fs.readFileSync(filePath, "utf-8")
      ) as MatchXgRecord[];
      console.log(
        `[xg-match-store] Loaded ${data.length} records from disk: ${fileKey(league, resolvedSeason)}`
      );
      return data;
    }
  } catch {
    /* ignore */
  }

  // Try Vercel Blob
  if (useBlob()) {
    try {
      const { list } = await import("@vercel/blob");
      const path = blobPath(league, resolvedSeason);
      const result = await list({ prefix: path, limit: 1 });
      if (result.blobs.length > 0) {
        const res = await fetch(result.blobs[0].url);
        if (res.ok) {
          const data = (await res.json()) as MatchXgRecord[];
          console.log(
            `[xg-match-store] Loaded ${data.length} records from Blob: ${fileKey(league, resolvedSeason)}`
          );
          return data;
        }
      }
    } catch {
      /* ignore */
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Query — filter for a specific team
// ---------------------------------------------------------------------------

export async function getMatchXgForTeam(
  team: string,
  league: string,
  season: string
): Promise<MatchXgRecord[]> {
  const all = await loadMatchXg(league, season);
  const teamLower = team.toLowerCase();
  return all.filter(
    (r) =>
      r.homeTeam.toLowerCase() === teamLower ||
      r.awayTeam.toLowerCase() === teamLower
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function currentSeason(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // European football seasons run Aug–May
  if (month >= 8) return `${year}-${year + 1}`;
  return `${year - 1}-${year}`;
}

export function makeMatchId(
  date: string,
  homeTeam: string,
  awayTeam: string
): string {
  const sanitize = (s: string) =>
    s
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_]/g, "");
  return `${date}_${sanitize(homeTeam)}_vs_${sanitize(awayTeam)}`;
}
