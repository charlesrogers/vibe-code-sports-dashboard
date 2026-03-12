/**
 * Download odds-snapshots from Vercel Blob to local data/odds-snapshots/
 *
 * Usage: BLOB_READ_WRITE_TOKEN=... npx tsx scripts/download-blob-snapshots.ts
 *
 * Uses the @vercel/blob list() API to enumerate all odds-snapshots/*.json blobs,
 * then downloads each to the local data/odds-snapshots/ directory.
 */

import { list } from "@vercel/blob";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";

const SNAPSHOT_DIR = join(process.cwd(), "data", "odds-snapshots");

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error("BLOB_READ_WRITE_TOKEN not set. Source .env.vercel or set it.");
    process.exit(1);
  }

  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }

  console.log("Listing blobs with prefix odds-snapshots/ ...");

  let cursor: string | undefined;
  let totalBlobs = 0;
  let downloaded = 0;
  let skipped = 0;

  do {
    const result = await list({
      prefix: "odds-snapshots/",
      limit: 100,
      cursor,
    });

    for (const blob of result.blobs) {
      totalBlobs++;
      const filename = blob.pathname.replace("odds-snapshots/", "");

      // Skip non-JSON and scheduler state (we don't need it locally from prod)
      if (!filename.endsWith(".json") || filename.startsWith("_")) {
        skipped++;
        continue;
      }

      const localPath = join(SNAPSHOT_DIR, filename);

      console.log(`  Downloading ${filename} (${(blob.size / 1024).toFixed(1)} KB) ...`);

      const res = await fetch(blob.url);
      if (!res.ok) {
        console.error(`    FAILED: ${res.status} ${res.statusText}`);
        continue;
      }

      const text = await res.text();
      writeFileSync(localPath, text);
      downloaded++;
    }

    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);

  console.log(`\nDone. ${downloaded} files downloaded, ${skipped} skipped, ${totalBlobs} total blobs.`);
  console.log(`Files in ${SNAPSHOT_DIR}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
