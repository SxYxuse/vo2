# VO2 verification map

This folder is the maintained source for verifying what an athlete sees and does in VO2. Read this index, then the matching feature file, before you drive the app with the helpers in `../scripts/`.

## Baseline preconditions

- `scripts/launch.sh` ran in this checkout, and `scripts/doctor.sh` passes.
- The baseline athlete is the one `launch.sh` seeds with no flags. That athlete:
  - has eight weeks of mock rides, runs, and swims, synced up to today,
  - was born on 15 January 1990 and weighs 72 kg,
  - has ride and run sports on,
  - has planning off,
  - has no goals, keys, chats, or power files.
- A feature that needs another state names its `launch.sh` flag under `Preconditions:`.
- Mock Strava repeats an eight-week pattern ending today. A typical week is Mon `Morning swim`, Tue `Morning ride`, Wed `Lunch run`, Thu a ride (`After-work ride`, `Threshold ride`, …), Fri and Sun rest, and Sat `Long ride` or `Long run`. Names vary by week, so find an activity before you tap it. Activities later than now are left out, so the current week is partial.

## Driving conventions

- Open each recipe with `RUN=$(scripts/open.sh <feature-id> phone|desktop <path>)`. Then use `scripts/pw.sh` and `scripts/settle.sh`, as `../SKILL.md` describes.
- Target elements by role and accessible name, quoted exactly as written here. A name that no longer matches is a finding, not something to work around with a CSS selector.
- Settle after every tap that navigates or loads data.
- A journey that changes the athlete leaves it changed. Run `scripts/launch.sh` again before a recipe that needs the baseline.

## Proof and skip reporting

- Name proof files `NN-step.{png,aria.yml,txt,sql.txt}` in the run folder, in the order you took them.
- For each feature, report the sub-feature IDs you covered, the size (phone or desktop), and the way in you used.
- When a precondition can't be met, report the command you tried and what was missing. Don't report a way in as verified because a different one worked.

## Features

- [Calendar and activity](./calendar-activity.md): browse weeks, open an activity, and come back to the same week by every way back.
- [Sync from Strava](./sync.md): the sync button, its result, and what a new sync copies.
- [Onboarding](./onboarding.md): sign in with mock Strava, copy the training, and finish setup with planning off or the coach plan.
- [Plan and the coach plan](./plan.md): the planning-off state, turning the coach plan on, and the written plan on Plan.
- [Coach chat](./coach-chat.md): ask the mock coach, reopen a chat from Chats, and delete it.
