/**
 * Sync local lab data (signal registry, experiments, reports) to Vercel Blob.
 *
 * Usage: npx tsx scripts/sync-lab-to-blob.ts
 * Requires: BLOB_READ_WRITE_TOKEN in .env.local
 */

import { put, list, del } from "@vercel/blob";
import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

// Load env files manually (no dotenv dependency)
function loadEnvFile(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile(join(process.cwd(), ".env.local"));
loadEnvFile(join(process.cwd(), ".env.vercel"));

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("ERROR: BLOB_READ_WRITE_TOKEN not set. Check .env.local");
  process.exit(1);
}

async function uploadBlob(key: string, content: string): Promise<void> {
  // Delete existing blob at this key first
  try {
    const existing = await list({ prefix: key, limit: 1 });
    for (const blob of existing.blobs) {
      await del(blob.url);
    }
  } catch {
    // ignore
  }
  await put(key, content, { access: "public", addRandomSuffix: false });
}

async function main() {
  const dataDir = join(process.cwd(), "data");
  let uploaded = 0;
  let errors = 0;

  // 1. Signal registry
  const registryPath = join(dataDir, "signal-registry.json");
  if (existsSync(registryPath)) {
    try {
      const content = readFileSync(registryPath, "utf-8");
      await uploadBlob("lab/signal-registry.json", content);
      console.log(`[${++uploaded}] Uploaded signal-registry.json`);
    } catch (e) {
      console.error(`FAILED signal-registry.json: ${e}`);
      errors++;
    }
  } else {
    console.warn("SKIP: signal-registry.json not found");
  }

  // 2. Experiments
  const expDir = join(dataDir, "experiments");
  if (existsSync(expDir)) {
    const files = readdirSync(expDir).filter((f) => f.endsWith(".json"));
    console.log(`\nFound ${files.length} experiment files`);
    for (const file of files) {
      try {
        const content = readFileSync(join(expDir, file), "utf-8");
        const key = `lab/experiments/${file}`;
        await uploadBlob(key, content);
        console.log(`[${++uploaded}] Uploaded experiments/${file}`);
      } catch (e) {
        console.error(`FAILED experiments/${file}: ${e}`);
        errors++;
      }
    }
  } else {
    console.warn("SKIP: data/experiments/ not found");
  }

  // 3. Reports
  const reportsDir = join(dataDir, "reports");
  if (existsSync(reportsDir)) {
    const files = readdirSync(reportsDir).filter((f) => f.endsWith(".md"));
    console.log(`\nFound ${files.length} report files`);
    for (const file of files) {
      try {
        const content = readFileSync(join(reportsDir, file), "utf-8");
        const key = `lab/reports/${file}`;
        await uploadBlob(key, content);
        console.log(`[${++uploaded}] Uploaded reports/${file}`);
      } catch (e) {
        console.error(`FAILED reports/${file}: ${e}`);
        errors++;
      }
    }
  } else {
    console.warn("SKIP: data/reports/ not found");
  }

  console.log(`\nDone. ${uploaded} uploaded, ${errors} errors.`);
  if (errors > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
