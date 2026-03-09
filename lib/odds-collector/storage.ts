/**
 * Storage adapter for odds snapshots and scheduler state.
 *
 * Locally: reads/writes JSON files to data/odds-snapshots/
 * On Vercel: uses Vercel Blob storage (set BLOB_READ_WRITE_TOKEN)
 *
 * Detection: if BLOB_READ_WRITE_TOKEN env var exists, use Blob. Otherwise file.
 */

import type { OddsSnapshot } from "./store";
import type { SchedulerState } from "./scheduler";

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface OddsStorage {
  saveSnapshots(league: string, snapshots: OddsSnapshot[]): Promise<void>;
  loadSnapshots(league: string, fromDate?: string, toDate?: string): Promise<OddsSnapshot[]>;
  loadSchedulerState(): Promise<SchedulerState>;
  saveSchedulerState(state: SchedulerState): Promise<void>;
}

// ---------------------------------------------------------------------------
// File-based storage (local development)
// ---------------------------------------------------------------------------

class FileStorage implements OddsStorage {
  private dataDir: string;

  constructor() {
    const { join } = require("path");
    this.dataDir = join(process.cwd(), "data", "odds-snapshots");
  }

  private ensureDir() {
    const { existsSync, mkdirSync } = require("fs");
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }
  }

  async saveSnapshots(league: string, snapshots: OddsSnapshot[]): Promise<void> {
    const { readFileSync, writeFileSync, existsSync } = require("fs");
    const { join } = require("path");
    this.ensureDir();

    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const filePath = join(this.dataDir, `${league}-${yearMonth}.json`);

    let existing: OddsSnapshot[] = [];
    if (existsSync(filePath)) {
      try {
        existing = JSON.parse(readFileSync(filePath, "utf-8"));
      } catch {
        existing = [];
      }
    }

    existing.push(...snapshots);
    writeFileSync(filePath, JSON.stringify(existing, null, 2));
  }

  async loadSnapshots(league: string, fromDate?: string, toDate?: string): Promise<OddsSnapshot[]> {
    const { readFileSync, readdirSync, existsSync } = require("fs");
    const { join } = require("path");
    this.ensureDir();

    if (!existsSync(this.dataDir)) return [];

    const all: OddsSnapshot[] = [];
    const files = readdirSync(this.dataDir) as string[];

    for (const file of files) {
      if (!file.startsWith(`${league}-`) || !file.endsWith(".json")) continue;
      try {
        const data: OddsSnapshot[] = JSON.parse(
          readFileSync(join(this.dataDir, file), "utf-8")
        );
        for (const snap of data) {
          if (fromDate && snap.timestamp < fromDate) continue;
          if (toDate && snap.timestamp > toDate) continue;
          all.push(snap);
        }
      } catch {
        continue;
      }
    }

    return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  async loadSchedulerState(): Promise<SchedulerState> {
    const { readFileSync, existsSync } = require("fs");
    const { join } = require("path");
    this.ensureDir();

    const stateFile = join(this.dataDir, "_scheduler-state.json");
    if (!existsSync(stateFile)) {
      return { lastPoll: {}, pollCount: {} };
    }
    try {
      return JSON.parse(readFileSync(stateFile, "utf-8"));
    } catch {
      return { lastPoll: {}, pollCount: {} };
    }
  }

  async saveSchedulerState(state: SchedulerState): Promise<void> {
    const { writeFileSync } = require("fs");
    const { join } = require("path");
    this.ensureDir();

    const stateFile = join(this.dataDir, "_scheduler-state.json");
    writeFileSync(stateFile, JSON.stringify(state, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Vercel Blob storage (production)
// ---------------------------------------------------------------------------

class BlobStorage implements OddsStorage {
  private async getBlobModule() {
    // Dynamic import to avoid errors when @vercel/blob isn't needed locally
    return await import("@vercel/blob");
  }

  private snapshotKey(league: string, yearMonth: string): string {
    return `odds-snapshots/${league}-${yearMonth}.json`;
  }

  private stateKey = "odds-snapshots/_scheduler-state.json";

  private async readBlob<T>(key: string, fallback: T): Promise<T> {
    try {
      const { list } = await this.getBlobModule();
      const result = await list({ prefix: key, limit: 1 });
      if (result.blobs.length === 0) return fallback;
      const res = await fetch(result.blobs[0].url);
      if (!res.ok) return fallback;
      return await res.json();
    } catch {
      return fallback;
    }
  }

  private async writeBlob(key: string, data: unknown): Promise<void> {
    const { put, list, del } = await this.getBlobModule();

    // Delete existing blob with this key (put doesn't overwrite by path)
    try {
      const existing = await list({ prefix: key, limit: 1 });
      for (const blob of existing.blobs) {
        await del(blob.url);
      }
    } catch {
      // Ignore delete errors
    }

    await put(key, JSON.stringify(data), {
      access: "public",
      addRandomSuffix: false,
    });
  }

  async saveSnapshots(league: string, snapshots: OddsSnapshot[]): Promise<void> {
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const key = this.snapshotKey(league, yearMonth);

    const existing = await this.readBlob<OddsSnapshot[]>(key, []);
    existing.push(...snapshots);
    await this.writeBlob(key, existing);
  }

  async loadSnapshots(league: string, fromDate?: string, toDate?: string): Promise<OddsSnapshot[]> {
    try {
      const { list } = await this.getBlobModule();
      const result = await list({ prefix: `odds-snapshots/${league}-` });

      const all: OddsSnapshot[] = [];
      for (const blob of result.blobs) {
        if (!blob.pathname.endsWith(".json")) continue;
        try {
          const res = await fetch(blob.url);
          if (!res.ok) continue;
          const data: OddsSnapshot[] = await res.json();
          for (const snap of data) {
            if (fromDate && snap.timestamp < fromDate) continue;
            if (toDate && snap.timestamp > toDate) continue;
            all.push(snap);
          }
        } catch {
          continue;
        }
      }

      return all.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    } catch {
      return [];
    }
  }

  async loadSchedulerState(): Promise<SchedulerState> {
    return this.readBlob<SchedulerState>(this.stateKey, { lastPoll: {}, pollCount: {} });
  }

  async saveSchedulerState(state: SchedulerState): Promise<void> {
    await this.writeBlob(this.stateKey, state);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _storage: OddsStorage | null = null;

export function getStorage(): OddsStorage {
  if (!_storage) {
    _storage = process.env.BLOB_READ_WRITE_TOKEN
      ? new BlobStorage()
      : new FileStorage();
  }
  return _storage;
}
