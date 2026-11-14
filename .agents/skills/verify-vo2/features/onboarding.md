# Onboarding

A new athlete signs in with Strava, copies their training, and sets up VO2 step by step: birthday and weight, sports, planning style, an optional OpenRouter key, and, for the coach plan, an A race, availability, and paces. It ends on the calendar (planning off) or on Plan, with the plan written.

## Sub-features

- `onb-sign-in` the signed-out screen `Sign in with Strava` → `Connect Strava` → `/onboarding`.
- `onb-copy` `Start sync` copies the training, then `Full success` appears and `Continue` becomes enabled.
- `onb-profile` the `Birthday` picker and `Weight` textbox.
- `onb-sports` the `Ride sports` / `Run sports` switches.
- `onb-planning-off` the `Off` radio, then `Skip for now` on the key step, then `Planning is off:`, then `Open the calendar`.
- `onb-coach-plan` the `Coach plan` radio, the key step, `Your A race`, `How often can you train?`, `Your paces`, `Write my plan`, and `Open Plan`.

## How to get to it (user POV)

- Open the app signed out: `/` shows `Sign in with Strava`.
- An athlete who signed in but didn't finish is sent to `/onboarding` on any page.

## Driving it with playwright-cli

Preconditions:

- `scripts/launch.sh --never-synced`. Signed in on onboarding with nothing copied, so `open.sh` lands on `/onboarding`.
- For `onb-sign-in`, sign out instead: open the page, then run `scripts/pw.sh cookie-clear` and `scripts/pw.sh reload`.

Steps:

- **Sign in.** With cookies cleared, `/` shows heading `Sign in with Strava`. Run `scripts/pw.sh click "getByRole('button', { name: 'Connect Strava' })"`, then `scripts/settle.sh "getByText('Never copied')"`. The URL is `/onboarding`, and `Continue` is disabled.
- **Copy the training.** Run `scripts/pw.sh click "getByRole('button', { name: 'Start sync' })"`, then `scripts/settle.sh "getByText('Full success')"`. `Continue` is enabled. Take `01-copied.png`.
- **Profile.** Click `Continue`. Run `scripts/pw.sh click "getByRole('button', { name: 'Birthday' })"` and `scripts/pw.sh click "getByRole('button', { name: /January 15th, 1990/ })"`. Then run `scripts/pw.sh fill "getByRole('textbox', { name: 'Weight' })" 72` and click `Continue`.
- **Sports.** The heading is `Your sports`. `Ride sports` and `Run sports` are checked switches. Click `Continue`.
- **Planning off.** The heading is `Planning style`, and `Coach plan` is checked by default. Click `getByRole('radio', { name: /^Off/ })`, then `Continue`. The heading is `Add your OpenRouter key`. Click `Skip for now`. The text `Planning is off:` appears. Click `Open the calendar`, and the heading is `Activity calendar`. Take `02-calendar.png`.
- **Side effect.** Run `scripts/db.sh 03-athlete "select status, activities_upserted from sync_runs"` and `scripts/db.sh 04-settings "select value->'planningStyle' from calendar_settings"`. The sync is `complete`, and the planning style is off.
- **Coach plan branch.** From `Planning style`, choose `Coach plan`, then `Continue`. On the key step, click `Continue` without a key (the mock coach stands in). On `Your A race`, fill `Race name`, set `Race date` to about ten weeks out, click `Half`, then `Add A race`, then `Continue`. Click `4 runs a week`, then `Continue`. On `Your paces`, click `Write my plan`. `Your coach is writing your next four weeks…` appears. Click `Open Plan`, then settle on a heading matching `/ · \d+ km running/`.

## Gotchas

- With planning off, the `Off` radio saves the planning style as soon as it's clicked, before the key step.
- `--never-synced` leaves a session in `.dev-seed/athlete.json`, and `open.sh` signs in through `/api/mock-strava/dev/sign-in` either way. Only clearing cookies shows the signed-out screen.
- `Start sync` with `--history <years>` takes minutes. Let `settle.sh` time out, then wait again, rather than reporting a failure.
- The `vp run dev:seed` script drives this same path. If `launch.sh` itself fails during onboarding, that's already a finding about onboarding.
- `planningStyle` lives in `calendar_settings.value`, so check the JSON before you rely on that key name. If it has moved, report it and update this file.
