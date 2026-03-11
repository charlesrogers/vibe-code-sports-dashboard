# MI Model — TODO

## Done
- [x] Backtest totals mechanism — Unders +2.3% ROI, Overs -5.9%. Restricted to Unders only.
- [x] Phase 3: Variance totals thesis + bet tagging (`model+variance` vs `model_only`)
- [x] Investigate Overs bias — root causes: lambda3 stuck at +0.05 (+2.2% Over inflation), model over-predicts 0.187 goals/match
- [x] Fix Overs bias — tightened lambda3 range to [-0.08, 0.02], added 3.5% totals deflation for O/U grid
- [x] Re-backtest totals — Unders improved to +6.8% ROI (558 bets), Overs still -7.5%. TOTALS_UNDERS_ONLY confirmed correct.
- [x] Write model_cannon.md — comprehensive Ted methodology + our findings

## Up Next (priority order)

### High Value — Improve existing profitable signals
- [ ] **Wire injury data into bet pipeline** — `lib/injuries.ts` exists but `our-bets.ts` never calls it. Need to: (1) map FotMob team IDs for EPL + Championship, (2) fetch injuries before bet generation, (3) pass to `assessMatch()` for confidence adjustment, (4) optionally adjust lambdas for key player absences. Infrastructure is ~30% done.
- [ ] **Odds capping** — Ted averages ~1.9 odds, caps ~2.5. We have no cap. Backtest ROI at different max-odds thresholds (2.0, 2.5, 2.8, 3.0) to find optimal filter.
- [ ] **Score existing bets** — run `score-bets.ts` on March 10+ bets to validate live performance vs backtest expectations.

### Medium Value — Expand Under opportunities
- [ ] **Alt totals lines from Odds API** — collect O/U 2.25, 2.75, 3.0, 3.25 from per-event endpoint (~3-5 extra API calls/run). Unlocks Under 2.25 and Under 2.75 value we currently miss.
- [ ] **League whitelist for totals** — EPL (+11.9%), Championship (+5.2%), Ligue-1 (+4.2%) are profitable. Bundesliga (-16.6%) and Serie A (-9.5%) hurt. Consider filtering.

### Low Value — Park for now
- [ ] **Overs via correlated filter** — only allow Over when: model edge ≥7% + variance thesis + strong favorite side bet + EPL/Champ only. Mimics Ted's qualitative approach. Low volume, uncertain payoff.
- [ ] **Tempo/pace classifier** — non-Poisson Over model using shot pace, possession %. Needs new data source. Major project for a market Ted treats as secondary.

## Waiting On
- [ ] Championship xG backfill — retry `scripts/fetch-championship-xg.ts` when API-Football accounts unsuspend
