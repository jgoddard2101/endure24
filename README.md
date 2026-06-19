# Endure24 — 24-hour relay lap tracker

Live dashboard for a 6-person, 24-hour running relay (one runner on course at a
time, 5-mile laps). It pulls each runner's completed laps from **Strava**, shows
who's out now, projects when everyone is next up, and tracks team stats.

## How it works (important)

Strava only reports an activity **after** the runner finishes and uploads it — so
"who's on course right now" is **inferred** (the next runner in the rotation after
the last uploaded lap), with a **manual override** in the admin page for when you
go out of order. When that runner uploads their lap, the override clears and the
rotation advances automatically.

```
Runner finishes lap → uploads to Strava → Strava webhook → /api/webhook/strava
  → match activity to a ~5-mile lap in the event window → record → dashboard updates
```

## Features

- **On course now** — current runner, time out, estimated finish.
- **Up next** — every runner's ETA to their next lap (uses each runner's rolling
  average lap time, falling back to the team average, then a default pace).
- **Team stats** — total laps/miles, projected 24h total, team avg lap, fastest lap.
- **Per-runner** — laps, miles, avg lap, avg pace.
- **Recent laps** feed.
- **Admin / race control** — edit rotation order, set who's on course, add laps
  manually (dead watch / failed upload), manage roster, link each runner's Strava.

## Quick start (local, with sample data)

Needs a Postgres `DATABASE_URL` (a free [Neon](https://neon.tech) DB works for both
local dev and production — use the pooled connection string).

```bash
cp .env.example .env        # set DATABASE_URL to your Postgres URL
npm install
npm run db:push             # create the schema
npm run db:seed             # OPTIONAL: load 6 runners + a few hours of fake laps
npm run dev                 # http://localhost:3000
```

Open `/` for the dashboard and `/admin` for race control (password = `ADMIN_PASSWORD`).

## Connecting Strava

1. Create an API app at <https://www.strava.com/settings/api>. Set the
   "Authorization Callback Domain" to your domain (e.g. `localhost` for dev, or
   your Vercel domain in production).
2. Put `STRAVA_CLIENT_ID` / `STRAVA_CLIENT_SECRET` in `.env`, and choose any
   `STRAVA_WEBHOOK_VERIFY_TOKEN` string.
3. In `/admin`, add your 6 runners, then each runner taps **connect Strava** next
   to their name (or visits `/api/auth/strava?runner=<id>`) and authorizes once.
4. After deploying, hit **Create subscription** in `/admin` once to register the
   webhook so new uploads flow in automatically.

> Strava OAuth requires `activity:read_all` so private/followers-only runs count.

## Deploying for the event (Vercel + Neon Postgres)

The schema already targets Postgres (`prisma/schema.prisma`).

1. Create a free Postgres DB (e.g. [Neon](https://neon.tech)) and copy the
   **pooled** connection string.
2. Set these env vars in Vercel: `DATABASE_URL`, `STRAVA_CLIENT_ID`,
   `STRAVA_CLIENT_SECRET`, `STRAVA_WEBHOOK_VERIFY_TOKEN`, `ADMIN_PASSWORD`,
   `APP_BASE_URL` (your Vercel URL), plus the `EVENT_*` defaults.
3. Deploy, run `npx prisma db push` against the prod DB, then create the webhook
   subscription from `/admin`.

## Configuration

All event settings (name, team, start time, duration, lap distance) seed from the
`EVENT_*` env vars on first run and are then editable via `PATCH /api/event`.

## Notes & limitations

- **Webhook needs a public URL.** For local end-to-end webhook testing, tunnel
  with `ngrok http 3000` and set `APP_BASE_URL` to the tunnel URL.
- **Lap matching** accepts foot activities 70–140% of the lap distance, started
  within ±30 min of the event window. Tune in `lib/laps.ts`.
- **Strava API terms**: their developer agreement restricts showing one athlete's
  data to other users. For a private, consenting team this is low-risk, but be
  aware a public leaderboard technically runs against those terms.
- **Rate limits** are a non-issue here because ingestion is webhook-driven (one
  API call per uploaded lap) rather than polling.

## Project layout

```
app/                  dashboard (/) + admin (/admin) + API routes
  api/state           dashboard JSON
  api/auth/strava     OAuth login + callback
  api/webhook/strava  Strava webhook (validate + receive)
  api/runners         roster CRUD
  api/rotation        rotation order + on-course override
  api/laps            manual lap add/delete
  api/event           event settings
  api/admin/webhook   webhook subscription management
lib/
  strava.ts           OAuth, token refresh, activity fetch, webhook subs
  laps.ts             activity → lap matching/ingestion
  stats.ts            dashboard state + ETA projection engine
  config.ts           event config + env
  format.ts           client-safe time/pace formatting
prisma/schema.prisma  EventConfig, Runner, Lap
```
