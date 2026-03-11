# MI Model — TODO

## Done
- [x] Backtest totals mechanism — Unders +2.3% ROI, Overs -5.9%. Restricted to Unders only.
- [x] Phase 3: Variance totals thesis + bet tagging (`model+variance` vs `model_only`)
- [x] Investigate Overs bias — root causes: lambda3 stuck at +0.05 (+2.2% Over inflation), model over-predicts 0.187 goals/match
- [x] Fix Overs bias — tightened lambda3 range to [-0.08, 0.02], added 3.5% totals deflation for O/U grid
- [x] Re-backtest totals — Unders improved to +6.8% ROI (558 bets), Overs still -7.5%. TOTALS_UNDERS_ONLY confirmed correct.

## Up Next
- [ ] Collect alt totals lines (2.25, 2.75, 3.0, 3.25) from per-event Odds API endpoint (~3-5 extra calls/run)

## Waiting On
- [ ] Score March 10 bets — run `score-bets.ts` once matches settle, compare baseline vs v2
- [ ] Championship xG backfill — retry `scripts/fetch-championship-xg.ts` when API-Football accounts unsuspend
