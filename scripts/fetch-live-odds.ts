/**
 * Fetch live odds for Championship + UCL using key 2 (adhoc)
 * Then run the full MI + Variance integrated assessment
 */

import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";

// Load .env.local manually (no dotenv dependency)
const envPath = join(import.meta.dirname || __dirname, "..", ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
  }
}

import { fetchLiveOdds, fetchEventOdds, getUpcomingEventIds, getApiKey } from "../lib/odds-collector/the-odds-api";
import { devigOdds1X2 } from "../lib/mi-model/data-prep";

const projectRoot = join(import.meta.dirname || __dirname, "..");
const outDir = join(projectRoot, "data", "live-odds");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const LEAGUES = ["championship", "ucl"];

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  FETCHING LIVE ODDS — Championship + UCL");
  console.log("  Using API Key 2 (adhoc)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const apiKey = getApiKey("adhoc");
  if (!apiKey) {
    console.error("No API key found! Set THE_ODDS_API_KEY_2 in .env.local");
    process.exit(1);
  }
  console.log(`[PROGRESS] API key loaded (${apiKey.substring(0, 8)}...)\n`);

  for (const league of LEAGUES) {
    console.log(`[PROGRESS] Fetching ${league} odds (h2h,totals,spreads)...`);
    try {
      const snapshots = await fetchLiveOdds(league, "h2h,totals,spreads", apiKey);
      console.log(`  Got ${snapshots.length} matches`);

      // ─── Deep fetch: alt totals for today's matches ─────────────────────
      // getUpcomingEventIds is FREE (no quota cost)
      const upcoming = await getUpcomingEventIds(league, apiKey);
      const today = new Date().toISOString().split("T")[0];
      const todayEvents = upcoming.filter(e => e.commence.startsWith(today));

      if (todayEvents.length > 0) {
        console.log(`  Fetching alt totals for ${todayEvents.length} matches (${todayEvents.length} API requests)...`);
        let deepCount = 0;
        for (const event of todayEvents) {
          try {
            const deep = await fetchEventOdds(league, event.id, apiKey);
            if (!deep) continue;
            deepCount++;

            // Merge alt totals into bulk snapshot
            const existing = snapshots.find(s => s.matchId === event.id);
            if (existing) {
              for (const bk of deep.bookmakers) {
                if (!bk.altTotals?.length) continue;
                const existingBk = existing.bookmakers.find(
                  b => b.bookmakerKey === bk.bookmakerKey || b.bookmaker === bk.bookmaker
                );
                if (existingBk) {
                  existingBk.altTotals = bk.altTotals;
                } else {
                  existing.bookmakers.push(bk);
                }
              }
            }
          } catch (e: any) {
            console.warn(`    Deep fetch failed for ${event.home} v ${event.away}: ${e.message}`);
          }
        }
        console.log(`  Merged alt totals from ${deepCount} events`);
      } else {
        console.log(`  No matches scheduled today — skipping alt totals`);
      }

      // Save snapshots (now includes alt totals)
      const filename = `${league}-live-${today}.json`;
      writeFileSync(join(outDir, filename), JSON.stringify(snapshots, null, 2));
      console.log(`  Saved to data/live-odds/${filename}\n`);

      // Print summary with Pinnacle odds + devigged probabilities
      console.log(`\n  ${"Match".padEnd(45)} ${"Pinnacle H".padStart(10)} ${"D".padStart(8)} ${"A".padStart(8)}   ${"Fair H%".padStart(8)} ${"D%".padStart(8)} ${"A%".padStart(8)}`);
      console.log("  " + "-".repeat(105));

      for (const snap of snapshots) {
        const ph = snap.pinnacleHome;
        const pd = snap.pinnacleDraw;
        const pa = snap.pinnacleAway;

        let fairH = "", fairD = "", fairA = "";
        if (ph && pd && pa) {
          const devigged = devigOdds1X2(ph, pd, pa);
          if (devigged) {
            fairH = (devigged.home * 100).toFixed(1) + "%";
            fairD = (devigged.draw * 100).toFixed(1) + "%";
            fairA = (devigged.away * 100).toFixed(1) + "%";
          }
        }

        const matchLabel = `${snap.homeTeam} v ${snap.awayTeam}`.substring(0, 43);
        const kickoff = new Date(snap.commenceTime).toLocaleDateString("en-GB", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
        console.log(
          `  ${(matchLabel + ` (${kickoff})`).padEnd(45)} ${(ph?.toFixed(2) ?? "—").padStart(10)} ${(pd?.toFixed(2) ?? "—").padStart(8)} ${(pa?.toFixed(2) ?? "—").padStart(8)}   ${fairH.padStart(8)} ${fairD.padStart(8)} ${fairA.padStart(8)}`
        );
      }
      console.log();
    } catch (e: any) {
      console.error(`  ERROR fetching ${league}: ${e.message}\n`);
    }
  }

  console.log("[DONE]");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
