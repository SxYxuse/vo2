VO2 is a personal training companion: it copies an athlete's Strava activities, scores fitness and form, and fills the rest of the week with planned sessions.

Keep it simple. Solve the real constraint with the smallest change that makes the behavior obvious, and fight scope creep. These are good defaults, not hard rules: the developer's instructions override anything here.

## Product constraints

VO2 is a PWA first, installed to the athlete's home screen and used on a phone far more than a desktop. Design and build for that:

- **PWA first:** every change should work as an installed standalone app (`public/manifest.webmanifest`, touch icons, offline-tolerant behavior). Don't add anything that assumes a browser tab, a URL bar, or a desktop-only window.
- **Mobile first:** lay out for a narrow viewport first and scale up. Touch targets, safe-area insets, and thumb reach matter more than hover states or dense tables.
- Prefer solutions that keep working when the app is backgrounded, resumed, or briefly offline.

## Hit every surface

The most common defect is a change that works on the path you tested and is missing everywhere else. Before calling work done, walk this list and say which entries applied:

- **Viewports.** Phone and desktop lay out differently (the calendar shows one training week on phones, four on desktop).
- **Installed PWA.** Standalone mode, safe areas, pull-to-refresh, and resuming after the app was backgrounded.
- **Athlete states.** Signed out, mid-onboarding, never synced, sync paused on rate limits, and fully synced.
- **Sport groups.** Rides, runs, and other sports each get a decision, even if it is "not shown here" (ADR 0007).
- **Athlete deletion.** A new per-athlete table references `user.id` with `onDelete: "cascade"` so deleting an athlete removes it.
- **Mock Strava.** A newly used Strava endpoint or field also gets implemented in `src/integrations/strava/mock-server.ts`.
- **Reverse states.** A way in needs a way out and a way to see it.

## Dev server

1. `vp run db:up`, then `vp run dev:mock`. Always use the mock: you have no access to strava.com.
2. The port is `PORT` in this checkout's `.env` (3000 in the main checkout). The dev server binds it strictly and fails if it is taken, because `BETTER_AUTH_URL` names the same port.
3. In the app: **Connect Strava** (the mock redirects straight back), finish the onboarding dialog, then **Sync from Strava** to load about eight weeks of mock rides and runs.
4. Stop the server you started by the PID you captured when starting it. Other worktrees run their own dev servers on this machine, so never kill by name or pattern.

### Databases

- Every checkout shares one Postgres server, compose project `vo2`. `vp run db:up` attaches to it. `vp run db:down` stops it for every checkout.
- The main checkout uses database `vo`. A new worktree's setup hook (`vp run db:setup`) creates its own `vo_wt_*` database, migrates it, and writes `DATABASE_URL`, `PORT`, and `BETTER_AUTH_URL` to `.env`.
- A worktree's database stays empty until **Sync from Strava**. Do not point a feature worktree at database `vo`, and do not migrate `vo` from a feature worktree.
- A worktree created before the hook still shares `vo`. `bun scripts/worktree-setup.ts --isolate` gives it its own database.
- `vp run db:prune` drops `vo_wt_*` databases whose worktree is gone (`--dry-run` lists them).

## Generated files

Regenerate these, rather than editing them by hand:

- `src/routeTree.gen.ts`: `vp run generate-routes`.
- `src/integrations/strava/strava.types.ts`: `vp run generate:strava-sdk` from `openapi.json`.

## Verifying

- Prove the change with the smallest check: `vp test run <files>` for the tests you touched or added.
- Test pure logic and observable behavior, not rendered markup or callback wiring.
- Open the app in a browser to verify only when the developer asks for it.
- **Before pushing,** run `vp check` (format, lint, types); CI fails on it before tests run. The pre-commit hook runs `vp check --fix` on staged files once `bun install` has installed it.

## Pull requests and commits

Commits and PR titles use Conventional Commits in plain language: `fix(calendar): keep the week when returning from an activity`.

Add the `preview` label in its own step after the PR exists, never with `gh pr create --label`. See `.agents/skills/preview-deploy/SKILL.md`.

## Documentation

Most code changes need no documentation change; agents can read the code.

- **ADRs** (`docs/adr/`) record a decision and its reasons. When a decision changes, write a new ADR that supersedes the old one (as 0011 did for field tests).
- **`GLOSSARY.md`** defines shared vocabulary; it is not a feature index. See `docs/agents/domain.md`.
- **Comments** say why: a constraint, a Strava quirk, or an invariant the code can't show.

## Work artifacts

Keep plans, research notes, and scratch files outside the worktree. Track work in the GitHub issue that owns it (`SxYxuse/vo2`, via `gh`; see `docs/agents/issue-tracker.md`); the merged PR is the implementation record.
