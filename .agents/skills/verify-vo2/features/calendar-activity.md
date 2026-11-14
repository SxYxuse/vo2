# Calendar and activity

The calendar is the home screen. It shows the athlete's activities, one week per screen on a phone and four weeks on desktop. Tapping an activity opens its page: map, stats, and charts. Going back returns to the week the athlete left, whether they use the in-app Calendar link or the system back gesture. An installed PWA has no browser back button.

## Sub-features

- `cal-week` steps between weeks with `Previous week`/`Next week` (phone) or between months (desktop), and `Today` returns to now.
- `cal-open-activity` tapping an activity opens `/activities/<id>?week=<monday>` with the activity's name as the heading.
- `cal-back-link` the activity page's `Calendar` link returns to the same week.
- `cal-back-gesture` going back in history returns to the same week.
- `activity-charts` the activity page shows HR / Cadence / Pace / Elev chart toggles for a run.

## How to get to it (user POV)

- Open the app: `/` is the calendar.
- Phone: the `Calendar` tab in the bottom `Main` navigation.
- Desktop: `Calendar` in the sidebar.
- From the activity page: the `Calendar` link at the top of `main`.

## Driving it with playwright-cli

Preconditions:

- The baseline athlete (`scripts/launch.sh`), and `scripts/doctor.sh` passes.

Steps:

- **Open the calendar.** Run `RUN=$(scripts/open.sh calendar-activity phone /)`. The heading `Activity calendar` (level 1) and a range button such as `Nov 9 – 15, 2026` are visible. Take `scripts/pw.sh --raw snapshot --filename=01-calendar.aria.yml`.
- **Step back a week.** Run `scripts/pw.sh click "getByRole('button', { name: /^Previous / })"`, then `scripts/settle.sh`. Record the range with `scripts/pw.sh --raw eval "document.querySelector('button[aria-haspopup=dialog][aria-live=polite]').innerText" | tee "$RUN/02-range-before.txt"`. The range moves back one week (one month on desktop).
- **Open an activity.** Run `scripts/pw.sh click "getByRole('button', { name: 'Long run' }).first()"` and `scripts/settle.sh "getByRole('heading', { name: 'Long run', level: 1 })"`. The URL is `/activities/<id>?week=<that Monday>`, and a `Run` badge, a map, and stats (Distance, Moving time, Avg pace) are visible. Take `03-activity.png` and `03-activity.aria.yml`.
- **Back by the link.** Run `scripts/pw.sh click "getByRole('main').getByRole('link', { name: 'Calendar' })"` and `scripts/settle.sh "getByRole('heading', { name: 'Activity calendar', level: 1 })"`. The range text equals `02-range-before.txt`, and the URL carries the same `?week=`. Save the range as `04-range-after.txt` and take `04-calendar-after.png`.
- **Back by gesture.** Open the activity again, then run `scripts/pw.sh go-back` and settle. The range text is unchanged again.
- **Side effect.** None: browsing writes nothing. To confirm the activity shown is the stored one, run `scripts/db.sh 05-long-run "select id, name, start_date from activities where name = 'Long run' order by start_date desc limit 3"`. The id in the activity URL is the first row.
- **Desktop.** Repeat with `scripts/open.sh calendar-activity desktop /`. The range button reads a month, such as `November 2026`. `Previous` steps a month, and the activity may be anywhere in the four weeks.

## Gotchas

- The phone shows one week, so the `Long run` button may be off screen or absent. Saturdays alternate between `Long run` and `Long ride`. If `.first()` finds nothing, step back one more week.
- `Next week` is disabled on the current week. That's expected, not a bug.
- The map tiles come from the network (OpenStreetMap / CARTO). A blank map offline isn't a VO2 failure. Judge the route line and stats.
- Activity names repeat every week. Assert the URL's `?week=` and the range label, not the name alone.
