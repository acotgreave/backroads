# Backroads crowd results API

A Cloudflare Worker with a D1 (SQLite) database. It records each finished **daily** drive anonymously and
serves the day's totals to the results page. If it is down or not set up, the game still works and the
results page shows its page-view estimates.

- `POST /api/run`: one finished drive: date, random player id, miles, the seven answers (or passes) and wrong guesses.
  One drive per player per day; repeats are ignored. Miles must add up. Dates must be today ±2 days.
- `GET /api/day?d=YYYY-MM-DD`: players, miles spread, per-prompt answer counts, passes, and the top wrong guesses
  (only those at least 2 different players typed).
- Rate limits: 20 drives and 600 reads per hour per IP. IPs are hashed with a daily-changing salt, never stored raw,
  and the counters are deleted after two days (daily cron).
- CORS: only the site (`ORIGINS` in `wrangler.toml`) and `localhost` may post.

## Deploying

`.github/workflows/deploy.yml` does it on every push to `main`: it finds or creates the `backroads` D1
database, applies `migrations/`, deploys the worker, and bakes its `workers.dev` address into the page.
It needs two repository secrets, `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Without them the step
is skipped and the site uses estimates.

## Local testing

```sh
cd worker && npm ci
npm run dev          # local worker + local D1 at http://127.0.0.1:8787
npm test             # in another terminal: smoke test
```

Then play the built page (`python3 scripts/build_site.py`, serve `dist/` on `localhost:8000`) with
`?test=1&api=http://127.0.0.1:8787` to point it at the local worker. Test replays are never sent;
the normal daily drive is.

## Reading the data

```sh
npx wrangler d1 execute backroads --remote --command "SELECT day, COUNT(*) players, AVG(miles) FROM runs GROUP BY day ORDER BY day DESC LIMIT 14"
```
