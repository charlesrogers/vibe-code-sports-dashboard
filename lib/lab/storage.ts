/**
 * Lab Storage Adapter
 *
 * Stores signal registry and experiment results.
 * Locally: reads/writes JSON files in data/
 * On Vercel: uses Vercel Blob storage (set BLOB_READ_WRITE_TOKEN)
 */

export interface SignalEntry {
  id: string;
  registered: string;
  hypothesis: string;
  metric: string;
  threshold: string;
  status: string;
  result?: string;
  deployedIn?: string;
  backtestStats?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface SignalRegistry {
  signals: SignalEntry[];
}

export interface LabStorage {
  loadRegistry(): Promise<SignalRegistry>;
  saveRegistry(registry: SignalRegistry): Promise<void>;
  listExperiments(): Promise<string[]>;
  loadExperiment(id: string): Promise<Record<string, unknown> | null>;
  saveExperiment(id: string, data: Record<string, unknown>): Promise<void>;
}

// ---------------------------------------------------------------------------
// File-based storage (local development)
// ---------------------------------------------------------------------------

class FileLabStorage implements LabStorage {
  private registryPath: string;
  private experimentsDir: string;

  constructor() {
    const { join } = require("path");
    this.registryPath = join(process.cwd(), "data", "signal-registry.json");
    this.experimentsDir = join(process.cwd(), "data", "experiments");
  }

  async loadRegistry(): Promise<SignalRegistry> {
    const { readFileSync, existsSync } = require("fs");
    if (!existsSync(this.registryPath)) return { signals: [] };
    try {
      return JSON.parse(readFileSync(this.registryPath, "utf-8"));
    } catch {
      return { signals: [] };
    }
  }

  async saveRegistry(registry: SignalRegistry): Promise<void> {
    const { writeFileSync, mkdirSync, existsSync } = require("fs");
    const { dirname } = require("path");
    const dir = dirname(this.registryPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.registryPath, JSON.stringify(registry, null, 2));
  }

  async listExperiments(): Promise<string[]> {
    const { readdirSync, existsSync } = require("fs");
    if (!existsSync(this.experimentsDir)) return [];
    return (readdirSync(this.experimentsDir) as string[])
      .filter((f: string) => f.endsWith(".json"))
      .map((f: string) => f.replace(".json", ""));
  }

  async loadExperiment(id: string): Promise<Record<string, unknown> | null> {
    const { readFileSync, existsSync } = require("fs");
    const { join } = require("path");
    const filePath = join(this.experimentsDir, `${id}.json`);
    if (!existsSync(filePath)) return null;
    try {
      return JSON.parse(readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  async saveExperiment(id: string, data: Record<string, unknown>): Promise<void> {
    const { writeFileSync, mkdirSync, existsSync } = require("fs");
    const { join } = require("path");
    if (!existsSync(this.experimentsDir)) mkdirSync(this.experimentsDir, { recursive: true });
    writeFileSync(join(this.experimentsDir, `${id}.json`), JSON.stringify(data, null, 2));
  }
}

// ---------------------------------------------------------------------------
// Vercel Blob storage (production)
// ---------------------------------------------------------------------------

class BlobLabStorage implements LabStorage {
  private async getBlobModule() {
    return await import("@vercel/blob");
  }

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

  async loadRegistry(): Promise<SignalRegistry> {
    return this.readBlob<SignalRegistry>("lab/signal-registry.json", { signals: [] });
  }

  async saveRegistry(registry: SignalRegistry): Promise<void> {
    await this.writeBlob("lab/signal-registry.json", registry);
  }

  async listExperiments(): Promise<string[]> {
    try {
      const { list } = await this.getBlobModule();
      const result = await list({ prefix: "lab/experiments/" });
      return result.blobs
        .filter(b => b.pathname.endsWith(".json"))
        .map(b => {
          const name = b.pathname.split("/").pop() || "";
          return name.replace(".json", "");
        });
    } catch {
      return [];
    }
  }

  async loadExperiment(id: string): Promise<Record<string, unknown> | null> {
    const data = await this.readBlob<Record<string, unknown> | null>(`lab/experiments/${id}.json`, null);
    return data;
  }

  async saveExperiment(id: string, data: Record<string, unknown>): Promise<void> {
    await this.writeBlob(`lab/experiments/${id}.json`, data);
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

let _storage: LabStorage | null = null;

export function getLabStorage(): LabStorage {
  if (!_storage) {
    _storage = process.env.BLOB_READ_WRITE_TOKEN
      ? new BlobLabStorage()
      : new FileLabStorage();
  }
  return _storage;
}
