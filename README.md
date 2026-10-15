# VO2

Local Strava activity calendar. Sign in with Strava, import every activity and its streams into Postgres, then browse them in a month/week/day calendar.

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
cp .env.example .env.local
vp dlx @better-auth/cli secret
```

3. Apply the schema, then start the app:

```bash
vp run db:push
vp run dev
```

The app is at http://localhost:3000.

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

| Script                       | Purpose                      |
| ---------------------------- | ---------------------------- |
| `vp run dev`                 | Vite+ dev server             |
| `vp run db:up`               | Start local Postgres         |
| `vp run db:push`             | Push Drizzle schema          |
| `vp run db:studio`           | Drizzle Studio               |
| `vp run generate:strava-sdk` | Refresh Strava OpenAPI types |
