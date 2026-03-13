# Sports Dashboard

## Stack
- Next.js 16.1.6, React 19, TypeScript 5, Tailwind v4
- Recharts for charts, Vercel Blob for production data storage
- Deployed on Vercel (Hobby plan)

## Vercel Crons (vercel.json)
- `POST /api/cron-odds` — 9:00 AM UTC daily (collect odds)
- `POST /api/paper-trade/log` — 12:00 PM UTC daily (log bets)
- `POST /api/paper-trade/settle` — 7:00 AM UTC daily (settle bets)
- `POST /api/cron/accumulate-xg` — 8:00 AM UTC daily (xG accumulation)
- Hobby plan: crons limited to once/day minimum, 10s execution limit

## /picks Is the Critical Page
- `/picks` is the single decision surface — all models, odds, injuries, and value bets converge here
- Shows MI Bivariate Poisson + Dixon-Coles + Elo consensus
- Includes: xG context, injury data, Ted assessment, AH + 1X2 value bets
- **Extra care when modifying** — regressions here directly impact betting decisions

## Models
- **MI Bivariate Poisson** (`lib/mi-model/solver.ts`) — attack/defense lambdas from devigged odds
- **Dixon-Coles** — low-scoring match correction
- **Elo** — form/strength rating
- Ensemble consensus shown on `/picks`
- Reference methodology: `docs/model_cannon.md` (Ted Knutson framework)

## Paper Trading
- Uses **Vercel Blob** in production, local file fallback in dev (`lib/paper-trade/storage.ts`)
- Deterministic blob paths — don't change path conventions without checking all consumers
- Fotmob canonical team names must match across systems

## Parameter Changes
- State evidence (backtest data, P&L impact) for any model parameter changes
- One variable per commit when tuning — isolate what helped vs hurt
- Don't modify model logic without discussing first

## Environment Variables
- `ODDS_API_KEY`, `THE_ODDS_API_KEY_2` — odds data
- `API_FOOTBALL_KEY`, `API_FOOTBALL_KEY_2` — football data
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob access
- `CRON_SECRET` — authenticates cron endpoints

## Build & Deploy
```bash
# Always build before pushing
npx next build

# Push to deploy (Vercel auto-deploys from GitHub)
git push origin main
```

## Leagues
- EPL, La Liga, Bundesliga, Serie A, Serie B

## Key Files
- `app/picks/page.tsx` — The decision surface
- `lib/mi-model/solver.ts` — Bivariate Poisson solver
- `lib/mi-picks/` — Pick generation logic
- `lib/paper-trade/storage.ts` — Blob storage (dual-mode)
- `lib/odds-collector/` — Odds scheduler + storage
- `docs/model_cannon.md` — Ted Knutson methodology reference
