# Plan and the coach plan

Plan (`/week`) shows the training the coach wrote, week by week, toward the athlete's A goal. With planning off, Plan says so and offers a way to choose a planning style. The Plan link is hidden from the navigation until planning is on. The athlete sets the coach plan up in Settings → Planning (availability and a coach brief) and Season (goals).

## Sub-features

- `plan-off` `/week` shows `Planning is off` and a `Choose a planning style` button. There's no `Plan` link in the tabs or sidebar.
- `plan-legacy-link` `/plan` redirects to `/week`.
- `plan-turn-on` choosing `Coach plan` in `/settings/training` saves it (`Saved`). Without an A goal, Settings shows `The coach plan can't be written yet`, and Plan offers `Add one in Season`.
- `plan-written` with a coach plan, the heading on `/week` matches `/ · \d+ km running · .+ riding$/`.
- `plan-brief` `Coach brief` in `/settings/training`, then `Save brief and rewrite plan`. When the mock coach can't fit the brief, it shows an alert `Not all of your brief fit`.

## How to get to it (user POV)

- Phone: the `Plan` tab once planning is on, or `More` → `Plan` in the sheet.
- Desktop: `Plan` in the sidebar.
- `Choose a planning style` on Plan while planning is off.
- Settings → `Planning` (`/settings/training`).

## Driving it with playwright-cli

Preconditions:

- `plan-off`, `plan-turn-on`: the baseline athlete.
- `plan-written`, `plan-brief`: `scripts/launch.sh --coach-plan`, which writes a plan toward an `Autumn half` ten weeks out.

Steps:

- **Planning off.** Run `RUN=$(scripts/open.sh plan phone /week)`. `scripts/pw.sh --raw find "Planning is off"` matches. Take `01-off.png`. On a phone, `scripts/pw.sh --raw find --regex 'link "Plan"'` finds nothing in `navigation "Main"` or in the `More` sheet.
- **Turn it on.** Run `scripts/pw.sh click "getByRole('button', { name: 'Choose a planning style' })"` and settle on `/settings/training`. Click `getByRole('radio', { name: /^Coach plan/ })`. `Saved` appears, then `The coach plan can't be written yet`. Take `02-settings.png`.
- **Side effect.** Run `scripts/db.sh 03-style "select value->'planningStyle' from calendar_settings"`. Then go to `/week`: `Add one in Season` is a link, and a `Plan` link now appears in the navigation.
- **Written plan.** After `launch.sh --coach-plan`, run `scripts/open.sh plan-written phone /week` and settle on `getByRole('heading', { name: / · \d+ km running/ })`. Take `04-plan.png` and `04-plan.aria.yml`. Run `scripts/db.sh 05-plan "select count(*) from coach_plans"`, which is at least 1.
- **Brief.** On `/settings/training`, fill `getByRole('textbox', { name: 'Coach brief' })` with `Fridays: 30 min at most.`, then click `Save brief and rewrite plan`. On `/week`, wait for `Writing your plan…` to disappear. The alert `Not all of your brief fit` contains `The mock coach doesn't read your brief.` Clear the brief the same way, and the alert is gone.

## Gotchas

- Writing a plan is asynchronous. `Writing your plan…` can take up to about 30 s even with the mock coach, so pass that locator to `settle.sh` and wait for it to go away before you judge the plan.
- The mock coach writes a fixed shape. Assert headings and alerts, not exact sessions or distances.
- Swims show on Plan only for an athlete with swim sports on. Report rides, runs, and swims separately (ADR 0007).
