---
name: verify-vo2
description: Launch VO2 (the training-companion PWA) against mock Strava in this checkout, sign in as the seeded mock athlete, and drive its web UI with playwright-cli at phone or desktop size to prove a change the way an athlete would see it, with screenshots, ARIA snapshots, and database reads as evidence. Use when the developer asks to see a change working in the real app, to reproduce a bug, or to capture proof for a pull request.
---

# Verify VO2

VO2's surface is one web app, a PWA used mostly on phones: calendar, activity, Plan, Season, fitness charts, the coach chat, Settings, and onboarding. It runs from this checkout with `vp run dev:mock`, which serves a mock Strava inside the app, so there's no real Strava account and no call to strava.com. The other surfaces are the Strava webhook (`/api/strava-webhook`) and the coach HTTP API (`/api/coach`), and the UI drives both. Nothing here touches prod, staging, or previews. For those, read `docs/agents/production.md`.

AGENTS.md says to open the app in a browser only when the developer asks for it. This skill is what you use when they do. For pull requests, `vp run e2e` is still the required proof, and this skill doesn't replace it.

Every helper lives in `scripts/` (paths below are relative to this skill's folder, `.agents/skills/verify-vo2/`). They read `PORT` and `DATABASE_URL` from the checkout's `.env`. Each checkout therefore gets its own server, its own `vo2_wt_*` database, its own browser session (`vo2-<last 12 chars of the checkout name>`), and its own evidence folder, and runs in two worktrees never collide. Never point a helper at the main checkout's `vo2` database, and never drive a server another checkout started: `doctor.sh` refuses to.

## Launch

```bash
scripts/launch.sh                 # onboarded athlete, planning off, eight weeks of mock training
scripts/launch.sh --coach-plan    # onboarded with a coach plan toward a half marathon in ten weeks
scripts/launch.sh --never-synced  # signed in on onboarding, nothing copied
scripts/launch.sh --mid-onboarding | --fresh-streams | --history <years>
```

`launch.sh` does the following, in order:

1. Refuses if another checkout holds `PORT`.
2. Runs `vp run db:up` and the repo's setup doctor (`vp run doctor`), then starts `vp run dev:mock` detached, logging to `~/.cache/vo2-verify/<checkout>/dev-server.log`.
3. Waits until mock Strava answers through the app.
4. Runs `vp run dev:seed` with your flags. The seed deletes the mock athlete from this checkout's database and onboards a new one through the real UI, in headless Chromium. That takes about 30 s, or longer with `--history`.

It's ready when it prints `Mock athlete … storageState: … Sign-in URL: …`. If this checkout's server is already running, the script reuses it and only reseeds. Rerun `launch.sh` with other flags to switch athlete states. Each run replaces the athlete, so anything the last journey did is gone.

The mock data is relative to the real today: eight weeks back, and the week starts on Monday. There's no fixed clock like the one e2e uses. Dates in screenshots move from day to day.

If the setup doctor fails (no `.env`, no `vo2_wt_*` database, migrations behind), fix what it prints, usually `vp run db:setup`, and launch again.

## Doctor

```bash
scripts/doctor.sh
```

`doctor.sh` is read-only. It exits 1 at the first failure and prints the fix. It checks that:

- the PID on `PORT` runs from this checkout,
- the PID runs with `STRAVA_MOCK=1`,
- mock Strava answers,
- the seeded athlete's cookie (`.dev-seed/athlete.json`) has a valid session,
- this checkout's database has the mock athlete, along with their sync status and activity count.

It also prints the branch and HEAD it's serving. The dev server hot-reloads, so it always serves the working tree. Run it first, and again whenever a step behaves oddly.

## Drive

The harness is `playwright-cli` (see the `playwright-cli` skill for every command). Drive it only through these wrappers:

```bash
RUN=$(scripts/open.sh <label> [phone|desktop] [path])   # new run folder, signed in, settled
scripts/pw.sh <playwright-cli command …>                # same session, run inside $RUN
scripts/settle.sh ["<locator>"]                          # wait for a locator, then hydration + network idle + no skeleton
scripts/db.sh <name> "<sql>"                             # read this checkout's database, saved to $RUN/<name>.sql.txt
```

- `open.sh` closes this checkout's old browser session and opens a new one at phone size (Chromium `--mobile`, 360 px wide) or desktop size (1280×900). It signs the browser in by visiting `/api/mock-strava/dev/sign-in`, goes to `path`, and settles. It prints the run folder and points `~/.cache/vo2-verify/<checkout>/current` at it.
- Target elements by role and accessible name, the same handles the e2e suite uses. For example, `scripts/pw.sh click "getByRole('button', { name: 'Previous week' })"`. Refs like `e57` from a snapshot also work, but they change with every snapshot.
- After every tap that navigates or loads data, run `scripts/settle.sh "<locator the next screen shows>"`. A tap before React hydrates (`body[data-hydrated]`) is silently lost.
- Use `scripts/pw.sh goto /some/path` to navigate (app paths resolve against this checkout's `PORT`), `scripts/pw.sh --raw find "<text>"` to search the page without dumping a full snapshot, and `scripts/pw.sh --raw eval "<js>"` to read a value.
- Phone and desktop lay out differently. Phones get a bottom tab bar (`navigation "Main"`: Calendar, Season, Coach, More) and a calendar that shows one week. Desktop gets a sidebar with every link and a calendar that shows four weeks. The calendar's range button reads `Nov 2 – 8, 2026` on a phone and `November 2026` on desktop. A change that touches layout needs a run at both sizes.
- Swipes and pull-to-refresh use touch events. A click doesn't prove them, so dispatch touch events with `scripts/pw.sh run-code`, or say they're unproven.
- WebKit/iPhone: this machine lacks WebKit's system libraries, so `playwright-cli --browser=webkit` fails. For iPhone evidence, run `vp run e2e -g "<screen>" --project=webkit` (in Docker) after adding the screen to `e2e/screens.spec.ts`, or ask the developer for a recording. A Chromium screenshot doesn't prove a layout fix.

## Evidence

Everything lands in `~/.cache/vo2-verify/<checkout>/<timestamp>-<label>-<size>/`, outside the worktree, and stays there after cleanup. `dev-server.log` sits next to the run folders.

- `scripts/pw.sh --raw screenshot --filename=NN-step.png` captures the viewport. Add `--full-page` only when the proof is below the fold.
- `scripts/pw.sh --raw snapshot --filename=NN-step.aria.yml` captures the ARIA tree, which proves text and state better than pixels.
- `scripts/pw.sh --raw eval "…" | tee "$RUN/NN-step.txt"` saves a value you asserted, such as a URL or a range label.
- `scripts/db.sh NN-name "select …"` saves a side effect: rows written, cleared, or rewritten.
- `.playwright-cli/` inside the run folder holds every automatic snapshot and the console log.

The proof has to meet these standards:

- **Drive the athlete's path:** tap what the athlete taps. Don't call server functions, write rows to set up state, or navigate straight to a URL the athlete can't reach, unless the feature file says so.
- **Capture action and result:** take a screenshot or snapshot before and after the step that matters, not only the final screen.
- **Check the side effect:** read the database for anything that saves, such as settings, the brief, keys, chats, goals, or plans. Then reload, or open a second screen that shows the same value. The app keeps an offline copy in IndexedDB, so a reload can briefly show the old value. Wait for it to settle before you judge.
- **Mocks only at the Strava boundary:** mock Strava stands in for strava.com, and the mock coach stands in for a model when no key is saved. Both are real production boundaries. Never save a real API key here. A saved key makes the coach call a real provider.
- **Name the gaps:** say which viewport, athlete state, and sport group you covered, and which you didn't (see "Hit every surface" in AGENTS.md).

## Cleanup

```bash
scripts/cleanup.sh                # close the browser session and stop this checkout's dev server
scripts/cleanup.sh --keep-server  # close the browser only
```

`cleanup.sh` stops only the PID on this checkout's `PORT`, and only if its cwd is this checkout. It never kills by name, because other worktrees run dev servers on this machine. It removes the `current` link and keeps every run folder and `dev-server.log`. The seeded athlete stays in this checkout's own database, and the next `launch.sh` replaces it. `.dev-seed/` is gitignored. Run cleanup after a failed attempt too, so no server or browser is left behind. Leave Postgres up: `vp run db:down` stops it for every checkout.

## Feature map

`features/README.md` indexes one recipe per athlete-facing feature: what proves it, every way an athlete reaches it, and the traps. Read the matching file before you drive. When the map lists several ways in, a proof that covers only one is incomplete. Keep the map current with `/maintain-verification-skill`.
