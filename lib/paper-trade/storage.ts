/**
 * Paper Trade Storage — File-based (local) or Vercel Blob (production)
 */

import type { PaperTradeLedger, PaperBet } from "./types";

const EMPTY_LEDGER: PaperTradeLedger = { version: 1, lastUpdated: new Date().toISOString(), bets: [] };

function getFilePath(): string {
  const { join } = require("path");
  return join(process.cwd(), "data", "bet-log", "ledger.json");
}

export async function loadLedger(): Promise<PaperTradeLedger> {
  // Try Vercel Blob first
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { list } = await import("@vercel/blob");
      const blobs = await list({ prefix: "paper-trade/ledger" });
      if (blobs.blobs.length > 0) {
        const res = await fetch(blobs.blobs[0].url);
        if (res.ok) return await res.json();
      }
    } catch { /* fall through to file */ }
  }

  // File-based fallback
  const { existsSync, readFileSync } = require("fs");
  const fp = getFilePath();
  if (existsSync(fp)) {
    try { return JSON.parse(readFileSync(fp, "utf-8")); }
    catch { /* return empty */ }
  }
  return { ...EMPTY_LEDGER };
}

export async function saveLedger(ledger: PaperTradeLedger): Promise<void> {
  ledger.lastUpdated = new Date().toISOString();

  // Vercel Blob
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    await put("paper-trade/ledger.json", JSON.stringify(ledger, null, 2), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
    });
    return;
  }

  // File-based (local dev only)
  const { writeFileSync, mkdirSync, existsSync } = require("fs");
  const { dirname } = require("path");
  const fp = getFilePath();
  const dir = dirname(fp);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fp, JSON.stringify(ledger, null, 2));
}

export async function appendBets(newBets: PaperBet[]): Promise<{ added: number; skipped: number }> {
  const ledger = await loadLedger();
  const existingIds = new Set(ledger.bets.map(b => b.id));

  let added = 0;
  let skipped = 0;
  for (const bet of newBets) {
    if (existingIds.has(bet.id)) {
      skipped++;
    } else {
      ledger.bets.push(bet);
      existingIds.add(bet.id);
      added++;
    }
  }

  if (added > 0) await saveLedger(ledger);
  return { added, skipped };
}
