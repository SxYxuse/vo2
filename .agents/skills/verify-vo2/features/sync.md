# Sync from Strava

VO2 copies the athlete's Strava activities and their streams. The sync button in the header shows when the athlete last synced. Tapping it runs a new sync, and a toast reports the result. Settings → Sync shows the sync's status and progress. In the installed PWA, pulling down the page refreshes it as well.

## Sub-features

- `sync-button` the header button `Synced <when>. Sync from Strava` starts a sync.
- `sync-up-to-date` a sync with nothing new shows the toast `Strava sync finished` / `Already up to date.`
- `sync-new-streams` a sync with streams missing copies them, and recent top efforts are celebrated.
- `sync-settings` Settings → Sync shows the status badge (`Full success`, `Never copied`, and so on).
- `sync-pull-to-refresh` pulling the page down in the installed PWA.

## How to get to it (user POV)

- The `Sync from Strava` button in the header, on every signed-in screen.
- Settings → `Sync` (`/settings/sync`).
- Pull to refresh on a touch screen.
- During onboarding: `Start sync` (see [onboarding](./onboarding.md)).

## Driving it with playwright-cli

Preconditions:

- `sync-up-to-date`: the baseline athlete.
- `sync-new-streams`: `scripts/launch.sh --fresh-streams`, which leaves the last seven days' streams uncopied and turns celebrations on.

Steps:

- **Sync with nothing new.** Run `RUN=$(scripts/open.sh sync phone /)`, then `scripts/pw.sh click "getByRole('button', { name: /Sync from Strava/ })"`. Within a few seconds, `scripts/pw.sh --raw find "Strava sync finished"` shows a dialog in the `Notifications` region with `Already up to date.` Take `01-toast.png` right away, because the toast fades.
- **Status in Settings.** Run `scripts/pw.sh goto /settings/sync`, then `scripts/settle.sh`. The badge reads `Full success`.
- **Side effect.** Run `scripts/db.sh 02-sync-run "select status, activities_upserted, streams_fetched, streams_pending, last_error, updated_at from sync_runs"`. `status` is `complete`, `last_error` is empty, and `updated_at` is from the sync you just ran.
- **New streams.** After `launch.sh --fresh-streams`, take `scripts/db.sh 03-before "select count(*) from activities where streams_synced_at is null"`, which is greater than 0. Then tap the sync button and wait for the toast. Take `scripts/db.sh 04-after "select count(*) from activities where streams_synced_at is null"`, which is 0. Any top efforts are celebrated on screen. Take a screenshot.

## Gotchas

- The button's name changes over time (`Synced just now`, then `Synced 1 min ago`). Always match `/Sync from Strava/`.
- Mock Strava's rate limits are far above real use, so the "sync paused on rate limits" state can't be reached through the UI. Report it as unverified rather than faking `paused_until` in the database.
- Pull to refresh listens for touch events. `click` doesn't trigger it. Dispatch a touchstart/touchmove/touchend sequence with `scripts/pw.sh run-code`, or report it unproven.
- An athlete deleting an activity or revoking access on Strava is simulated with `POST /api/mock-strava/dev/activities/<id>/delete` or `/dev/deauthorize`. These push a webhook event, which reaches the app only when `STRAVA_WEBHOOK_SECRET` is set in `.env`. Check `delivered` in the response.
