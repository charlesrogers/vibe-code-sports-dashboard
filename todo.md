# MI Model — TODO

## Done
- [x] Backtest totals mechanism — Unders +2.3% ROI, Overs -5.9%. Restricted to Unders only.
- [x] Phase 3: Variance totals thesis + bet tagging (`model+variance` vs `model_only`)

## Up Next
- [ ] Investigate Overs model bias — why does the model overestimate Over probabilities? (xG calibration? grid truncation? correlation param?)
- [ ] Collect alt totals lines (2.25, 2.75, 3.0, 3.25) from per-event Odds API endpoint (~3-5 extra calls/run)

## Waiting On
- [ ] Score March 10 bets — run `score-bets.ts` once matches settle, compare baseline vs v2
- [ ] Championship xG backfill — retry `scripts/fetch-championship-xg.ts` when API-Football accounts unsuspend
