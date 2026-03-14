# MI Model — TODO

## Done
- [x] Backtest totals mechanism — Unders +2.3% ROI, Overs -5.9%. Restricted to Unders only.
- [x] Phase 3: Variance totals thesis + bet tagging (`model+variance` vs `model_only`)
- [x] Investigate Overs bias — root causes: lambda3 stuck at +0.05 (+2.2% Over inflation), model over-predicts 0.187 goals/match
- [x] Fix Overs bias — tightened lambda3 range to [-0.08, 0.02], added 3.5% totals deflation for O/U grid
- [x] Re-backtest totals — Unders improved to +6.8% ROI (558 bets), Overs still -7.5%. TOTALS_UNDERS_ONLY confirmed correct.
- [x] Write model_cannon.md — comprehensive Ted methodology + our findings
- [x] Wire injury data into bet pipeline — EPL + Champ FotMob IDs mapped, injuries fetched per-match, passed to assessMatch() for confidence adjustment, printed per-bet
- [x] Alt totals lines — fetch-live-odds.ts now does per-event deep fetch for alt totals (2.0, 2.25, 2.75, 3.0, 3.25). Found 4 new Under 2.25 bets on first run.
- [x] Odds capping — 2.0 cap confirmed optimal: +2.1% ROI, 56.3% hit rate. Above 2.5 goes negative. Deployed in DEFAULT_TED_CONFIG.maxOdds.
- [x] Score existing bets — 49 bets scored (Mar 10+), 37 pending. Settled: 5W-4L, +0.66u, +5.5% ROI.
- [x] Benter Boost A/B backtest — Added `--benter` + `--market-weight` flags to backtest-eval.ts. 40% market weight best for 1X2 (+4.3% vs +2.4% baseline). AH worse (+2.7% vs +3.1%). 85% (Mack's rec) destroys edge.

## Up Next (priority order)

### High Value — Improve existing profitable signals
- [ ] **Bootstrap significance on Benter 40% 1X2** — `npx tsx scripts/backtest-eval.ts --ted --markets=1x2 --max-odds=2.5 --benter --market-weight=0.40 --bootstrap`. Need p < 0.10 before deploying.
- [ ] **Deploy Benter 1X2-only** — if bootstrap passes, wire Benter blend into picks-engine.ts for 1X2 value bets only. Leave AH untouched (Benter hurts AH).
- [ ] **League whitelist for totals** — EPL (+11.9%), Championship (+5.2%), Ligue-1 (+4.2%) are profitable. Bundesliga (-16.6%) and Serie A (-9.5%) hurt. Filter totals to profitable leagues only.

### Low Value — Park for now
- [ ] **Overs via correlated filter** — only allow Over when: model edge ≥7% + variance thesis + strong favorite side bet + EPL/Champ only. Mimics Ted's qualitative approach. Low volume, uncertain payoff.
- [ ] **Tempo/pace classifier** — non-Poisson Over model using shot pace, possession %. Needs new data source. Major project for a market Ted treats as secondary.

## Waiting On
- [ ] Championship xG backfill — retry `scripts/fetch-championship-xg.ts` when API-Football accounts unsuspend
