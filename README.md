# VO2

VO2 is a personal training companion: it copies an athlete's Strava activities, scores fitness and form, and fills the rest of the week with planned sessions.

Sign in with Strava, import every activity and its streams into Postgres, then:

- browse them by training week (four on desktop, one on phones)
- pick planned sessions from the **Week bucket** when you have a time window
- plot GPS tracks on a map
- chart fitness, fatigue, and form
- inspect sport-specific heart-rate zones
- optionally analyze an activity via OpenRouter (`OPENROUTER_API_KEY` in `.env.example`; mocked until set)

Stack: **TanStack Start**, **Vite+**, **Bun**, **Better Auth**, **Drizzle**, **Docker Postgres**, **shadcn/ui**, **ReUI Event Calendar**.

Use **Vite+** (`vp`) for every command. Bun is the package manager only (`vp install` / `vp add` resolve to it).

## Setup

1. Install dependencies and start Postgres:

```bash
vp install
vp run db:up
```

2. Copy env vars and create a [Strava API application](https://www.strava.com/settings/api). Set the authorization callback domain to `localhost`. Better Auth will use `http://localhost:3000/api/auth/callback/strava`.

```bash
cp .env.example .env
vp dlx @better-auth/cli secret
```

3. Apply the migrations, then start the app:

```bash
vp run db:migrate
vp run dev
```

The app is at http://localhost:3000.

### Mock Strava

Agents (and anyone without a Strava app) can run the full app against a local mock that never calls strava.com:

```bash
vp run dev:mock
```

Or set `STRAVA_MOCK=1` in `.env`. Open http://localhost:3000, click **Connect Strava** (the OAuth redirect comes straight back, with no Strava login), finish the onboarding dialog (it blocks the page until saved), then click **Sync from Strava**. The mock athlete has about eight weeks of rides and runs, with GPS, heart rate, and power, so the calendar, map, fitness, and heart-rate zones all have data.

The mock lives at `/api/mock-strava` and implements the parts of Strava's OAuth and v3 API that the app uses. Only the Strava base URL changes, so sign-in, token refresh, and sync run the same code as in production. `STRAVA_MOCK` is ignored in production.

Local Postgres still uses the `vo` user, password, and database name so existing `.env` files and volumes keep working.

## Sync behavior

Strava read limits are typically 100 requests / 15 minutes and 1,000 / day. VO2:

- pages `/athlete/activities` (200 per page)
- then fetches `/activities/{id}/streams` in small batches
- reads `X-ReadRateLimit-*` headers and pauses until the next 15-minute window or the next UTC day

Resume with **Sync from Strava** after the pause.

## Strava SDK

The official Swagger 2 spec is converted to OpenAPI 3 and typed with `openapi-typescript`:

- `src/integrations/strava/openapi.json`
- `src/integrations/strava/strava.types.ts`
- `src/integrations/strava/client.ts` — typed client with rate limiting

Regenerate types after refreshing the spec:

```bash
vp run generate:strava-sdk
```

## Scripts

| Script                       | Purpose                                          |
| ---------------------------- | ------------------------------------------------ |
| `vp run dev`                 | Vite+ dev server                                 |
| `vp run db:up`               | Start local Postgres                             |
| `vp run db:generate`         | Generate a migration from `src/db/schema.ts`     |
| `vp run db:migrate`          | Apply pending migrations                         |
| `vp run db:check`            | Fail if the schema has changes with no migration |
| `vp run db:studio`           | Drizzle Studio                                   |
| `vp run generate:strava-sdk` | Refresh Strava OpenAPI types                     |
