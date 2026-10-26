# VO2 UI audit and ReUI opportunities

Audit date: 24 October 2026. Scope: every route, drawer, dialog and visible state of the app, rendered against the mock Strava server, plus a review of [ReUI components](https://reui.io/components) and [ReUI blocks](https://reui.io/blocks). Fuel screens in this audit were removed in [0030](adr/0030-fuel-plans-are-removed.md).

## Method and coverage

- **How:** ran `STRAVA_MOCK=1 vp dev` on an isolated worktree database, signed in with the mock, went through onboarding, synced 44 mock activities, then clicked through every route on an iPhone 12 Pro viewport (390×844) and again on desktop (1440×900, light and dark).
- **Seen rendered:** signed out, onboarding (all 5 steps and the 4 plan-builder sub-steps, validation errors, date popover, loading skeleton), calendar (mobile agenda and desktop month), This week (day list, day drawer, session detail), Season (empty, add-goal drawer, plan-adapt dialog, populated), activity detail, Fuel (empty, product picker, plan form, uploaded route with fuel plans), Map, Fitness, Bests (grid and detail drawer), Heart rate, Settings (Profile, Training, Sync, sidebar settings mode), dark mode.
- **Read in code only, not reproduced:** route `errorComponent`s, sync paused on rate limits, AI analysis streaming/failed (needs an OpenRouter key), offline behavior, the installed-PWA standalone shell.
- **Screenshots:** stored next to this file in [`docs/ui-audit/`](ui-audit/). Mobile shots are 390 px wide.

## Summary table

| #   | Group                               | Page                                      | Purpose                                        | Sophistication |
| --- | ----------------------------------- | ----------------------------------------- | ---------------------------------------------- | -------------- |
| 1   | App sidebar                         | All signed-in pages                       | Primary navigation, settings, theme, account   | Decent         |
| 2   | App header and Sync button          | All signed-in pages                       | Toggle sidebar, start a Strava sync            | Basic          |
| 3   | Route pending and error states      | All routes                                | Loading and failure fallback                   | Basic          |
| 4   | Toasts                              | Global                                    | Sync progress, plan changes                    | Decent         |
| 5   | Signed-out page                     | `/` signed out                            | Connect Strava                                 | Basic          |
| 6   | Onboarding shell and dot stepper    | `/onboarding`                             | Frame for the 5 setup steps                    | Decent         |
| 7   | Strava copy step                    | `/onboarding` step 1                      | First sync with live count                     | Polished       |
| 8   | About you form                      | `/onboarding` step 2, Settings › Profile  | Birthday and weight                            | Decent         |
| 9   | Your sports form                    | `/onboarding` step 3, Settings › Sports   | Sport types, colors, sensors                   | Basic          |
| 10  | Plan builder wizard                 | `/onboarding` step 4, Settings › Training | Build the first plan in 4 sub-steps            | Decent         |
| 11  | You're set                          | `/onboarding` step 5                      | Completion and hand-off                        | Decent         |
| 12  | Activity calendar                   | `/`                                       | Completed activities by week or month          | Decent         |
| 13  | Week summary header                 | `/week`                                   | Phase, goal, fitness, form, weekly volume      | Decent         |
| 14  | Week day list                       | `/week`                                   | Day-by-day plan and done sessions              | Polished       |
| 15  | Day drawer and re-plan form         | `/week`                                   | Change one day, ask to re-plan                 | Decent         |
| 16  | Session detail                      | `/week/session`                           | Workout profile, steps, effect on week         | Polished       |
| 17  | Season map                          | `/season`                                 | Phases and weekly hours to the A race          | Decent         |
| 18  | Goal card list                      | `/season`                                 | Upcoming goals with countdown                  | Decent         |
| 19  | Add goal drawer                     | `/season`                                 | Two-step goal creation                         | Polished       |
| 20  | Plan adapt dialog                   | `/season`, `/week`                        | Before/after diff of affected weeks            | Decent         |
| 21  | Activity header and map             | `/activities/$id`                         | Identify the activity, see the route           | Decent         |
| 22  | Activity stat grid                  | `/activities/$id`                         | Headline metrics                               | Basic          |
| 23  | Stream chart with series toggles    | `/activities/$id`                         | HR, power, cadence, speed, elevation over time | Decent         |
| 24  | Heart rate and terrain collapsibles | `/activities/$id`                         | Zone split and gradient analysis               | Decent         |
| 25  | AI analysis panel                   | `/activities/$id`                         | On-demand coach note                           | Decent         |
| 26  | Fuel products card and picker       | `/fuel`                                   | Choose MNSTRY products owned                   | Basic          |
| 27  | Plan a route form                   | `/fuel`                                   | Upload GPX and set fueling targets             | Basic          |
| 28  | Route list                          | `/fuel`                                   | Saved routes                                   | Basic          |
| 29  | Route plan detail                   | `/fuel/$planId`                           | Prediction, map, elevation, climbs             | Decent         |
| 30  | Fuel plan cards                     | `/fuel/$planId`                           | Pick one of 3 fuel strategies                  | Basic          |
| 31  | Map                                 | `/map`                                    | All activity routes, filtered by sport         | Decent         |
| 32  | Fitness and form                    | `/fitness`                                | Phase, CTL/ATL/TSB cards, load chart           | Decent         |
| 33  | Progress section                    | `/fitness`                                | Best efforts now vs 6 weeks ago                | Decent         |
| 34  | Bests grid and detail drawer        | `/bests`                                  | Personal bests and progression                 | Polished       |
| 35  | Heart rate page                     | `/heart-rate`                             | Max HR, zones, intensity report                | Decent         |
| 36  | Settings pages                      | `/settings/*`                             | Profile, training, sports, HR, calendar, sync  | Decent         |
| 37  | Danger zone and delete dialog       | Settings › Profile                        | Delete VO2 data                                | Decent         |

---

## Cross-cutting findings

These patterns repeat across most groups. Fixing them once gives the largest lift.

1. **Touch targets are desktop-sized.** The `base-mira` style makes the default button `h-7` (28 px), `sm` 24 px, icon buttons 28 px. Measured on a phone: _Connect Strava_ 27 px tall, sidebar trigger 23 px, _Sync from Strava_ 23 px, switches 17 px tall, calendar day cells 23 px, info icons 19 px, toggle-group items 23 px. Drawers use a larger 38 px size, so the same action changes size depending on where it appears. AGENTS.md says touch targets matter more than density. Target 44 px on touch.
2. **Primary actions sit mid-screen, not in thumb reach.** Onboarding cards are vertically centered, so _Continue_ lands in the middle of the screen; on the long Sports step it scrolls away. Re-plan, Save products and Fuel's _Upload and plan_ are not sticky either.
3. **Three looks for the same "stat tile."** `StatCard` (bordered card, colored dot, mono value) on Activity, Fitness, Heart rate and Fuel; a borderless 3-column strip on This week and the plan builder; a large bold sans value on Bests. The colored dot sometimes encodes a chart series, sometimes nothing (Fuel route has no dots). Values mix `font-mono` (69 usages) with sans.
4. **Two segmented-control styles.** `Tabs` (pill, muted track) on Bests, `ToggleGroup variant="outline"` everywhere else (period, sport filter, chart series, bottle size). Selected and unselected items are hard to tell apart in the outline style (plan builder sports, long-session day).
5. **Date and time locale is inconsistent.** "19 Oct – 25 Oct" and "Saturday 24 October" on This week, "Oct 19 – 25, 2026" and "9:00 AM" on the calendar, "10/24/2026, 8:19:03 AM" in Sync, "Tuesday, October 20, 2026" on activities.
6. **Loading and error states are generic.** Route `pendingComponent`s are one tall `Skeleton` block that doesn't match the content shape (the plan preview skeleton is about 3× the size of what loads). Route `errorComponent`s are an `Empty` with the raw `error.message` and no retry action or icon.
7. **Explanatory copy carries the hierarchy.** Most cards open with a sentence or two of help text in `text-muted-foreground`, and headings are 14–16 px. Pages read as text-first; the key number or action is not the first thing the eye lands on.
8. **Info tooltips everywhere.** `InfoTooltip` (19 px tap target) appears next to almost every label on Fitness and Heart rate (5 per zone list alone). Useful content, noisy presentation.
9. **Duplicated CTAs.** _Add a goal_ twice on empty Season, _Sync from Strava_ in the header and _Sync now_ in Settings › Sync, the period toggle repeated per page.

---

## Inventory by area

### A. App shell and global feedback

#### 1. App sidebar

- **Component:** `src/components/app-sidebar.tsx` (`AppSidebar`, `SidebarNavMenu`, `SettingsNavMenu`, `SidebarUserMenu`, theme toggle)
- **Where:** every signed-in page. Off-canvas sheet on phones, fixed 255 px rail on desktop. On `/settings/*` it swaps to the settings section list with a _Back_ button.
- **Purpose:** move between the 8 sections, open Settings, switch theme, account menu.
- **Composition:** shadcn `Sidebar`, `SidebarMenu`, `SidebarMenuButton`, `DropdownMenu`, `Avatar`, lucide icons, `Vo2Mark`.
- **Weaknesses:**
  - On phones every navigation costs two taps through a sheet opened from a 23 px trigger in the top-left corner, the hardest spot to reach.
  - The second group (Map, Fitness, Bests, Heart rate) has no label, while the first is labeled _Training_.
  - Footer is three unlabeled icons (settings, theme, avatar) on desktop.
  - No sync status, last-synced time, or next goal anywhere in the shell.
  - Settings mode replaces the main nav entirely; the only way out is _Back_ in the footer.
- **Sophistication:** Decent. Correct shadcn sidebar with good settings mode; not adapted to one-handed phone use.
- **Screenshots:** [sidebar-mobile.jpg](ui-audit/sidebar-mobile.jpg), [calendar-desktop.jpg](ui-audit/calendar-desktop.jpg)

#### 2. App header and Sync button

- **Component:** `src/routes/_app.tsx` (`AppLayout` header), `src/components/sync-panel.tsx` (`SyncPanel`)
- **Where:** top of every signed-in page.
- **Purpose:** open the sidebar, start a sync.
- **Composition:** `SidebarTrigger`, ghost `Button` with `RefreshCwIcon`/`Spinner`.
- **Weaknesses:** 48 px bar that holds two small controls and no title; the page title repeats underneath. The sync button shows no last-synced time, no paused or failed state, and no badge when new activities arrived. It scrolls away with content on long pages.
- **Sophistication:** Basic.

#### 3. Route pending and error states

- **Component:** `pendingComponent` / `errorComponent` in `src/routes/_app.*.tsx` (e.g. `CalendarPending`, `CalendarError`, `HeartRateError`)
- **Where:** every route while loading or when its loader throws.
- **Composition:** `Skeleton` (one block, e.g. `h-[40rem]`), `Empty` + `EmptyTitle` + `EmptyDescription`.
- **Weaknesses:** skeletons don't follow the layout they stand in for, so the page jumps. Errors show the raw message, no icon, no _Retry_, no hint about being offline (relevant for a PWA).
- **Sophistication:** Basic.
- **Screenshot:** [plan-builder-skeleton.jpg](ui-audit/plan-builder-skeleton.jpg)

#### 4. Toasts

- **Component:** `src/components/ui/toast.tsx`, used by `src/hooks/use-strava-sync.ts`, `season.tsx`, `plan-adapt.tsx`
- **Purpose:** sync progress updated in place, confirmations.
- **Weaknesses:** good updatable sync toast. No undo on destructive or plan-changing actions (Adapt plan, Delete route). The bottom-right region overlaps the bottom of drawers on phones.
- **Sophistication:** Decent.

### B. Signed out and onboarding

#### 5. Signed-out page

- **Component:** `src/components/signed-out-page.tsx`, `SignInPanel` in `sync-panel.tsx`
- **Where:** `/` when signed out.
- **Purpose:** explain VO2 and start Strava OAuth.
- **Composition:** header with `Vo2Mark` and theme toggle, `h1`, one paragraph, full-width `Button`, `Alert` on error.
- **Weaknesses:** one sentence and a 27 px button on an otherwise empty screen. No preview of what the athlete gets, no Strava branding on the button, nothing about privacy. Fine as a utility screen, weak as a first impression of an installed app.
- **Sophistication:** Basic.
- **Screenshot:** [signed-out.jpg](ui-audit/signed-out.jpg)

#### 6. Onboarding shell and dot stepper

- **Component:** `src/components/onboarding-shell.tsx`, `src/components/onboarding.tsx`
- **Where:** `/onboarding`, until setup is complete.
- **Purpose:** frame the 5 setup steps (Copy from Strava, About you, Your sports, Your plan, You're set).
- **Composition:** `Card` with header/content/footer, a `tablist` of 10 px dots, `Button` _Back_/_Continue_.
- **Weaknesses:**
  - Dots are 10 px tap targets and unlabeled; step names exist only for screen readers.
  - Step 4 swaps the dots for a second progress system ("Build your plan · 1 of 4" with a 4-segment bar), so the athlete sees two different steppers in one flow.
  - Card is vertically centered: _Continue_ sits mid-screen on short steps and below the fold on long ones.
- **Sophistication:** Decent.
- **Screenshots:** [onboarding-about-you.jpg](ui-audit/onboarding-about-you.jpg), [plan-builder-starting.jpg](ui-audit/plan-builder-starting.jpg)

#### 7. Strava copy step

- **Component:** `src/components/onboarding-sync-step.tsx`
- **Purpose:** first sync, with a ring that fills as activities copy.
- **Composition:** SVG progress ring, `Badge` status (Never copied / Syncing / Full success), `Button`.
- **Weaknesses:** the ring shows only a spinner arc while the count stays at 0 for several seconds; no estimate. Otherwise clear.
- **Sophistication:** Polished.
- **Screenshots:** [onboarding-sync-empty.jpg](ui-audit/onboarding-sync-empty.jpg), [onboarding-sync-done.jpg](ui-audit/onboarding-sync-done.jpg)

#### 8. About you form

- **Component:** `ProfileFields` in `src/components/settings-fields.tsx`
- **Where:** onboarding step 2, Settings › Profile.
- **Composition:** `Field`, `Popover` + `Calendar` (month/year selects), `InputGroup` with kg suffix and an icon.
- **Weaknesses:** birthday uses a month-grid calendar popover with 23 px day cells for a date usually decades back; year select starts at 1990. On phones a popover instead of a drawer. Validation messages appear under the help text, so error and help stack.
- **Sophistication:** Decent.
- **Screenshot:** [onboarding-date-popover.jpg](ui-audit/onboarding-date-popover.jpg)

#### 9. Your sports form

- **Component:** `src/components/sport-types-fields.tsx`
- **Where:** onboarding step 3, Settings › Sports.
- **Composition:** `Switch` rows, color `Select` with swatch, nested "Collectors" switches per sport, `FieldSeparator`.
- **Weaknesses:** about 1,300 px tall on a phone; every sport repeats the same nested block. Long paragraphs above the controls. 17 px switches. Hierarchy between "Shared data", sport, and collectors relies on indentation only.
- **Sophistication:** Basic.
- **Screenshot:** [onboarding-sports.jpg](ui-audit/onboarding-sports.jpg)

#### 10. Plan builder wizard

- **Component:** `src/components/plan-builder.tsx`, `src/components/week-shape-fields.tsx`
- **Where:** onboarding step 4; _Rebuild plan_ in Settings › Training.
- **Purpose:** season, starting point, training days, preview, start.
- **Composition:** `Empty` (no goal), stat strip, segmented sport-split bar, `Switch`, day `Toggle`s with history %, `ToggleGroup` long day, +/- stepper, sport toggles, week preview bars and list.
- **Weaknesses:**
  - Pressed and unpressed toggles look almost the same (training days, sports to plan).
  - Preview bars are all the same gray with no labels, so they read as a placeholder.
  - The loading skeleton is much taller than the result.
  - Numbers in the starting-point card use a heavy mono face that doesn't match the rest of the step.
- **Sophistication:** Decent. Smart content, plain presentation.
- **Screenshots:** [plan-builder-starting.jpg](ui-audit/plan-builder-starting.jpg), [plan-builder-when.jpg](ui-audit/plan-builder-when.jpg), [plan-builder-preview.jpg](ui-audit/plan-builder-preview.jpg)

#### 11. You're set

- **Component:** done step in `src/components/onboarding.tsx`
- **Composition:** `IconStack` (ReUI), title, description, full-width button.
- **Weaknesses:** good closure. The button is gray-on-gray while the CTA style elsewhere is black.
- **Sophistication:** Decent.
- **Screenshot:** [onboarding-done.jpg](ui-audit/onboarding-done.jpg)

### C. Calendar

#### 12. Activity calendar

- **Component:** `src/components/activity-calendar.tsx` on the ReUI `EventCalendar` (`src/components/reui/event-calendar/*`), `src/components/diary-jump-picker.tsx`
- **Where:** `/`. Phones: agenda list of one training week. Desktop: month grid (ADR 0013/0014).
- **Purpose:** browse completed Strava activities and open one.
- **Composition:** `EventCalendar` month and agenda views, `Button` nav, `Popover` jump picker, sport-colored dots/chips.
- **Weaknesses:**
  - Phone: future days read "Rest" even when This week has a session planned (today showed "Rest" while This week showed _Easy ride_). The subtitle that explains "completed activities only" is `hidden sm:block`.
  - Agenda rows show time, duration, distance in one gray line; no weekly total, no effort or load.
  - Desktop month cells are 130 px tall with one chip at the top and the day number bottom-right; lots of empty space and no weekly sums.
  - Nav buttons are 23 px.
- **Sophistication:** Decent.
- **Screenshots:** [calendar-desktop.jpg](ui-audit/calendar-desktop.jpg)

### D. This week

#### 13. Week summary header

- **Component:** `src/components/week-view.tsx`
- **Composition:** phase `Badge`, goal `Badge`, date range, `Alert` (No goal ahead + _Add a goal_), 3-column stat strip (Fitness, Form, Week) with green `Progress`.
- **Weaknesses:** the three numbers have no context (is +4 good?) beyond the hint line; the progress bar has no label or target marker; phase badge "Hold" is tiny. The stat strip duplicates the Fitness page cards in a different style.
- **Sophistication:** Decent.
- **Screenshot:** [week-mobile.jpg](ui-audit/week-mobile.jpg)

#### 14. Week day list

- **Composition:** `ul` of day buttons, done sessions in dashed boxes with a check, today highlighted, rest day with moon icon, chevrons.
- **Weaknesses:** done sessions truncate ("Morning swim · ticked off 2 × 20…"); "Before this week's plan" on a past day is unclear. Desktop: 7 narrow columns truncate titles to 5–8 characters and leave 60% of the screen empty below.
- **Sophistication:** Polished on phone, Basic on desktop.
- **Screenshots:** [week-mobile.jpg](ui-audit/week-mobile.jpg), [week-desktop.jpg](ui-audit/week-desktop.jpg)

#### 15. Day drawer and re-plan form

- **Component:** `week-view.tsx` with `src/components/responsive-dialog.tsx` (Drawer on phones, Dialog on desktop)
- **Composition:** session link row, 2×2 reason `Button`s with icons, `Textarea`, _Re-plan my week_ button.
- **Weaknesses:** reason buttons don't show a selected state strongly; the submit button is left-aligned and gray when disabled, without saying why. Good drawer behavior.
- **Sophistication:** Decent.
- **Screenshot:** [week-day-drawer.jpg](ui-audit/week-day-drawer.jpg)

#### 16. Session detail

- **Component:** `src/components/session-detail.tsx`, route `_app.week_.session.tsx`
- **Composition:** header with sport icon and badges, zone profile chart (tap a block), legend, steps `Table` with zone chips, "Effect on the week" stat grid.
- **Weaknesses:** back link uses an arrow while other detail pages use a chevron; "Left after 0 min" reads oddly; no primary action (mark done, send to device).
- **Sophistication:** Polished.
- **Screenshot:** [session-detail.jpg](ui-audit/session-detail.jpg)

### E. Season

#### 17. Season map

- **Component:** `src/components/season-map.tsx`, `src/components/season-style.ts`
- **Composition:** card with phase `Badge`, description, slider-role bar chart colored by phase, month labels, legend.
- **Weaknesses:** no y-axis or hour labels on bars, the race marker is a lone red dot above the chart, legend wraps to two lines on phones.
- **Sophistication:** Decent.
- **Screenshot:** [season-populated.jpg](ui-audit/season-populated.jpg)

#### 18. Goal card list

- **Component:** `src/components/season.tsx`
- **Composition:** `article` with A/B/C priority badge, title, "In 50 days", meta line, sport row button.
- **Weaknesses:** the countdown is plain text; no visual of build progress toward the race. The A/B/C explanation is a paragraph under the list. Empty state is a full-height dashed box with a second _Add a goal_ button.
- **Sophistication:** Decent.
- **Screenshots:** [season-empty.jpg](ui-audit/season-empty.jpg), [season-populated.jpg](ui-audit/season-populated.jpg)

#### 19. Add goal drawer

- **Composition:** `ResponsiveDialog`, step text "Step 1 of 2", `Input`, `Select`, date `Popover`, `InputGroup` units, radio cards with descriptions for priority and objective, full-width buttons.
- **Weaknesses:** step progress is text only. Otherwise the best form in the app: 38 px controls, radio cards, full-width actions.
- **Sophistication:** Polished.
- **Screenshot:** [season-goal-step2.jpg](ui-audit/season-goal-step2.jpg)

#### 20. Plan adapt dialog

- **Component:** `src/components/plan-adapt.tsx`
- **Composition:** list of bordered week cards with a strike-through old value and an arrow to the new one, "And 3 more weeks", two full-width buttons.
- **Weaknesses:** six near-identical cards fill the screen; the change is the same pattern each week, so a compact timeline would read faster. Buttons are 27 px here but 38 px in the goal drawer right before it.
- **Sophistication:** Decent.
- **Screenshot:** [plan-adapt-dialog.jpg](ui-audit/plan-adapt-dialog.jpg)

### F. Activity detail

#### 21. Activity header and map

- **Component:** `src/components/activity-detail.tsx`, `activity-detail-map.tsx`, `activity-detail-map-view.tsx`
- **Composition:** back link, `h1`, sport `Badge`, date line, MapLibre map (tap for full screen).
- **Weaknesses:** the attribution pill covers a quarter of the map height on phones; no start/finish legend.
- **Sophistication:** Decent.
- **Screenshot:** [activity-detail-top.jpg](ui-audit/activity-detail-top.jpg)

#### 22. Activity stat grid

- **Component:** `StatCard` in `src/components/stat-card.tsx`
- **Composition:** six bordered cards, colored dot per stat, mono value with wide spacing ("30.1 km").
- **Weaknesses:** six separate boxes for six numbers (heavy borders, 75% white space); dots imply a link to chart series but Distance/Moving time have none; no comparison to the athlete's usual.
- **Sophistication:** Basic.

#### 23. Stream chart with series toggles

- **Component:** `src/components/activity-detail-charts.tsx`
- **Composition:** outline `ToggleGroup` with colored dots, Recharts dual-axis chart, legend, tooltip.
- **Weaknesses:** the legend duplicates the toggle group; dual Y axes have no units; 23 px toggles.
- **Sophistication:** Decent.
- **Screenshot:** [activity-detail-bottom.jpg](ui-audit/activity-detail-bottom.jpg)

#### 24. Heart rate and terrain collapsibles

- **Component:** `activity-heart.tsx`, `activity-ride-analysis.tsx`, `activity-detail-section.tsx`
- **Composition:** `Collapsible` cards with title, description, chevron.
- **Weaknesses:** collapsed cards look like stat cards; nothing previews what is inside (e.g. the dominant zone).
- **Sophistication:** Decent.

#### 25. AI analysis panel

- **Component:** `activity-analysis.tsx`, `activity-analysis-live.tsx` (uses ReUI `Trace`), `activity-analysis-writeup.tsx`
- **Composition:** card header with _Analyze_ button, `Empty` "Waiting for you", streaming trace and write-up.
- **Weaknesses:** the empty state takes about 300 px to say "press Analyze"; the button is the only black element on the page. Streaming states not seen (no API key in mock).
- **Sophistication:** Decent.

### G. Fuel

#### 26. Fuel products card and picker

- **Component:** `src/components/fuel-products-picker.tsx`, `src/routes/_app.fuel.tsx`
- **Composition:** `Card` with _Choose_/_Edit_, `ResponsiveDialog` with `InputGroup` search, warning line "Still needed…", grouped `Checkbox` rows, _Save products_ button.
- **Weaknesses:**
  - Empty page is three paragraphs of instructions in a row, all saying "choose products, then upload a GPX".
  - The picker is a single 60-row checklist; category headings ("GELS · 3") are the only navigation.
  - Escape or swipe-down discards the selection with no warning.
- **Sophistication:** Basic.
- **Screenshots:** [fuel-empty.jpg](ui-audit/fuel-empty.jpg), [fuel-products-drawer.jpg](ui-audit/fuel-products-drawer.jpg)

#### 27. Plan a route form

- **Component:** `src/components/route-upload-form.tsx`, `route-bottle-fields.tsx`
- **Composition:** native `<input type="file">` in an `Input`, `Select`, `Input`, +/- stepper, outline `ToggleGroup`s, `InputGroup` (ml), full-width submit.
- **Weaknesses:** the native "Choose File / No file chosen" control is the least polished element in the app and doesn't support drag and drop; three different number-entry patterns in one form (input, stepper, toggle+input); the submit button reads gray while disabled with no reason given.
- **Sophistication:** Basic.
- **Screenshot:** [fuel-plan-form.jpg](ui-audit/fuel-plan-form.jpg)

#### 28. Route list

- **Component:** "Your routes" section in `_app.fuel.tsx`
- **Weaknesses:** text-only empty state; no thumbnail or distance/time summary visible before opening a route.
- **Sophistication:** Basic.

#### 29. Route plan detail

- **Component:** `src/components/route-plan-detail.tsx`, `route-trace-map.tsx`, `route-preview.tsx`
- **Composition:** title, "medium confidence" `Badge`, four `StatCard`s (no dots here), `Alert` with a bulleted caveat, map with zoom controls, elevation chart with km/Time toggle and climb bands, climbs collapsible.
- **Weaknesses:** confidence badge wraps under the subtitle; the caveat is a full-width bordered alert for one sentence; _Delete route_ sits next to _Predict again_ at the end of a long page.
- **Sophistication:** Decent.
- **Screenshot:** [fuel-route-top.jpg](ui-audit/fuel-route-top.jpg)

#### 30. Fuel plan cards

- **Composition:** collapsible "Fuel plans · 3 to choose from", horizontal scroller of three 312 px cards (name, description, g/h, item list, _Choose_), then "Target and bottles" form and refill `Alert`.
- **Weaknesses:** no recommended plan, no selected state, no scroll indicator for the hidden cards; numbers that matter for comparison (g/h, caffeine) are in a sentence instead of aligned rows.
- **Sophistication:** Basic.
- **Screenshot:** [fuel-route-plans.jpg](ui-audit/fuel-route-plans.jpg)

### H. Map

#### 31. Map

- **Component:** `src/routes/_app.map.tsx`, `src/components/activity-map.tsx`, `activity-map-view.tsx`, `src/components/ui/map.tsx`
- **Composition:** sport `ToggleGroup`, count line, full-height MapLibre map with zoom and full-screen controls.
- **Weaknesses:** no way to identify or open an activity from a trace without tapping exactly on it; no list or selected-activity panel; Swim is absent from the filter with no explanation.
- **Sophistication:** Decent.
- **Screenshot:** [map-mobile.jpg](ui-audit/map-mobile.jpg)

### I. Fitness and progress

#### 32. Fitness and form

- **Component:** `src/components/fitness-chart.tsx`, `src/components/period-toggle.tsx`
- **Composition:** period `ToggleGroup`, "Right now" callout, next-goal link card, five `StatCard`s with area sparklines and info tooltips, series `ToggleGroup`, composed Recharts chart.
- **Weaknesses:** five cards in a 2-column grid leave an orphan; Ramp has no sparkline while its neighbors do; red "-2.7" without context; the phase callout and next-goal card use two different card styles; on desktop the sparklines disappear.
- **Sophistication:** Decent.
- **Screenshots:** [fitness-mobile.jpg](ui-audit/fitness-mobile.jpg), [fitness-desktop-dark.jpg](ui-audit/fitness-desktop-dark.jpg)

#### 33. Progress section

- **Component:** `src/components/progress-cards.tsx`
- **Composition:** per-sport card, "Easier than before?" explainer, 4-column comparison grid with % change and dates.
- **Weaknesses:** a 4-column numeric grid at 390 px; percent change in small green text is the only signal; date "Oct 26" is ambiguous (see open questions).
- **Sophistication:** Decent.

#### 34. Bests grid and detail drawer

- **Component:** `src/components/personal-bests.tsx`, route `_app.bests.tsx`
- **Composition:** `Tabs` (Runs/Rides/Swims), period `ToggleGroup`, 2-column tile grid with "New" `Badge`, disabled tiles for distances not yet run, detail drawer with big number, delta line, progression step chart, top 10 list.
- **Weaknesses:** the date moves from top-right to bottom-right depending on whether "New" shows; tabs and toggle use different segmented styles one above the other.
- **Sophistication:** Polished. The best example to align the rest of the app on.
- **Screenshots:** [bests-mobile.jpg](ui-audit/bests-mobile.jpg), [best-detail-drawer.jpg](ui-audit/best-detail-drawer.jpg)

#### 35. Heart rate page

- **Component:** `src/routes/_app.heart-rate.tsx`, `heart-rate-zones.tsx`, `heart-rate-report.tsx`, `heart-rate-efficiency.tsx`
- **Composition:** period and sport `ToggleGroup`s, four `StatCard`s, stacked zone bar, `Item` list with "per sport" `Badge` and info tooltip per zone, report with intensity split and daily chart.
- **Weaknesses:** zone dot colors (teal, blue, green, amber, red) don't follow an intensity ramp; "per sport" badge and an info icon repeated five times; zone rows are 75 px tall for one number each; period toggle sits outside a card here but inside a card on Fitness.
- **Sophistication:** Decent.
- **Screenshot:** [heart-rate-mobile.jpg](ui-audit/heart-rate-mobile.jpg)

### J. Settings

#### 36. Settings pages

- **Component:** `src/components/settings.tsx`, `settings-fields.tsx`, `heart-rate-fields.tsx`, `settings-sync-section.tsx`, `week-shape-fields.tsx`, routes `_app.settings.*`
- **Where:** `/settings/{profile,training,sports,heart-rate,calendar,sync}`.
- **Composition:** title with live "Saving… / Saved" status, `Alert` with _Retry_ on save errors, one `Card` per section with `Field`s; Sync section with `Item`, status `Badge`, `Progress`, _Sync now_.
- **Weaknesses:**
  - On phones there is no visible way to switch sections; the list lives in the sidebar sheet.
  - Auto-save on blur is good but invisible until it happens; no per-field confirmation.
  - Sync shows the same full-success badge and a black 100% bar whether data is fresh or old; date format is US.
- **Sophistication:** Decent.
- **Screenshots:** [settings-profile.jpg](ui-audit/settings-profile.jpg), [settings-sync.jpg](ui-audit/settings-sync.jpg)

#### 37. Danger zone and delete dialog

- **Component:** `src/components/settings-delete-athlete.tsx`
- **Composition:** `FieldSeparator`, title, description, destructive-soft `Button`, `AlertDialog`.
- **Weaknesses:** sits inside the Profile card with the same weight as weight and birthday. Fine otherwise.
- **Sophistication:** Decent.

---

## ReUI opportunities

**Licensing as seen on reui.io:** the component pages present their examples as free (`npx shadcn add @reui/<name>`; the repo already has the `@reui` registry in `components.json` and uses ReUI `EventCalendar`, `IconStack` and `Trace`). All blocks are ReUI Pro (Pro or Ultimate license, from $249 one-time). Where a component page didn't state a price explicitly, the table says "free (not labeled)". Every Pro idea below can be rebuilt from shadcn primitives already in `src/components/ui/`.

### Match table

| Current group                                   | ReUI element                                                                                                                                                                                                                                           | Free / Pro                                 | Effort        | Priority |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------- | -------- |
| Stat tiles everywhere (#13, #22, #29, #32, #35) | [Stats block](https://reui.io/blocks/application/stats) stats-7, stats-18; [Sparkline](https://reui.io/blocks/chart/sparkline) "KPI Strip"; [Card](https://reui.io/blocks/application/card) "Fitness Stats"; [Badge](https://reui.io/components/badge) | Blocks Pro, Badge free (not labeled)       | Low to medium | High     |
| Fuel empty state (#26, #28)                     | [Empty State](https://reui.io/blocks/application/empty-state) "Team Launch Steps"; [Card](https://reui.io/blocks/application/card) "Numbered Setup Steps"                                                                                              | Pro                                        | Low           | High     |
| GPX input (#27)                                 | [File Upload](https://reui.io/components/file-upload) "Basic drag and drop", "Card file upload"                                                                                                                                                        | Free                                       | Low           | High     |
| Fuel plan cards (#30)                           | [Radio Group](https://reui.io/components/radio-group) "Pricing plan radio cards"; [Pricing](https://reui.io/blocks/marketing/pricing) "Customer Logo Pricing"; [Comparison](https://reui.io/blocks/ecommerce/comparison) "Two-Product Compare"         | Radio Group free; blocks Pro               | Low           | High     |
| Onboarding stepper (#6, #10)                    | [Stepper](https://reui.io/components/stepper) "segmented progress bar", "Workspace setup dots"; [Onboarding](https://reui.io/blocks/application/onboarding) "Centered Setup Flow"                                                                      | Stepper free; block Pro                    | Medium        | High     |
| Route pending/error (#3)                        | [Skeleton](https://reui.io/components/skeleton) card grid, stats row, list; [Empty](https://reui.io/components/empty) "Add button"; [Alert](https://reui.io/components/alert) with actions                                                             | Free (not labeled for Skeleton/Alert)      | Low           | High     |
| Sync status (#2, #36)                           | [Badge](https://reui.io/components/badge) status dot; [Sonner](https://reui.io/components/sonner) "Promise toast", "Updatable toast"; [Stats](https://reui.io/blocks/application/stats) "API Quota Usage"                                              | Badge/Sonner free (not labeled); block Pro | Low           | High     |
| Heart rate zones (#35, #24)                     | [Stats](https://reui.io/blocks/application/stats) "Capacity Usage", "Adoption Rate"; [Progress](https://reui.io/components/progress) custom colors                                                                                                     | Block Pro; Progress free                   | Low           | Medium   |
| Plan adapt dialog (#20)                         | [Timeline](https://reui.io/components/timeline) "Compact horizontal milestone", "Vertical timeline"                                                                                                                                                    | Free                                       | Low           | Medium   |
| Season goal card (#18)                          | [Card](https://reui.io/blocks/application/card) "Project Deadline Cards"; [Stats](https://reui.io/blocks/application/stats) "Task Progress"                                                                                                            | Pro                                        | Low           | Medium   |
| Day drawer re-plan (#15)                        | [Dialog](https://reui.io/blocks/application/dialog) "Cancel Plan Survey"; [Radio Group](https://reui.io/components/radio-group) "in card with icons"                                                                                                   | Block Pro; Radio Group free                | Low           | Medium   |
| Plan builder controls (#10, #27)                | [Number Field](https://reui.io/components/number-field); [Toggle Group](https://reui.io/components/toggle-group); [Tabs](https://reui.io/components/tabs) "Segmented control"                                                                          | Free                                       | Low           | Medium   |
| Product picker (#26)                            | [Tabs](https://reui.io/components/tabs) "Badge counts"; [Settings](https://reui.io/blocks/application/settings) "Import Sources"                                                                                                                       | Tabs free (not labeled); block Pro         | Medium        | Medium   |
| Settings navigation (#36)                       | [Item](https://reui.io/components/item) "Clickable navigation items"; [Profile](https://reui.io/blocks/application/profile) "Account Settings Hub"; [Settings](https://reui.io/blocks/application/settings) "General & Display"                        | Item free; blocks Pro                      | Medium        | Medium   |
| Activity stat grid and sections (#22, #24, #25) | [Frame](https://reui.io/components/frame) "Stacked panels"; [Empty](https://reui.io/components/empty); [AI Chat](https://reui.io/blocks/ai-agents/ai-chat) "Prompt Starter Welcome"                                                                    | Frame free (not labeled); block Pro        | Medium        | Medium   |
| Sport/period filters (#31, #32, #35)            | [Navbar](https://reui.io/blocks/application/navbar) "Analytics Toolbar"; [Date Selector](https://reui.io/components/date-selector)                                                                                                                     | Block Pro; Date Selector free              | Medium        | Low      |
| Map (#31)                                       | [Map solution](https://reui.io/blocks/solutions/map) "Dispatch Map"                                                                                                                                                                                    | Pro                                        | High          | Low      |
| Desktop calendar (#12)                          | Already ReUI [Event Calendar](https://reui.io/components/event-calendar); [Schedule](https://reui.io/blocks/application/schedule) "Team Agenda"                                                                                                        | Pro                                        | Medium        | Low      |
| Birthday field (#8)                             | [Date Selector](https://reui.io/components/date-selector)                                                                                                                                                                                              | Free                                       | Low           | Low      |
| Fitness progress table (#33)                    | [Card](https://reui.io/blocks/application/card) "Period Trend KPIs"                                                                                                                                                                                    | Pro                                        | Low           | Low      |
| Sport and sensor settings (#9)                  | [Settings](https://reui.io/blocks/application/settings) "Role Capabilities", "Privacy Controls"                                                                                                                                                        | Pro                                        | Medium        | Low      |

### Detail per match

#### Stat tiles → Stats, Sparkline and Card blocks (High)

- **Current:** `StatCard` and three other stat styles (cross-cutting finding 3).
- **ReUI:** [Stats](https://reui.io/blocks/application/stats) _Sales & Churn Metrics_ (stats-7: three-column divided panel with large values and trend badges) and _Capacity Usage_ (stats-18: divided cells, value over total, segmented meter); [Sparkline](https://reui.io/blocks/chart/sparkline) _KPI Strip_ (four-column KPI row with corner sparklines and trend badges); [Card](https://reui.io/blocks/application/card) _Fitness Stats_ (two-column tiles with large value, unit and muted label).
- **Repurpose:** stats-7 → one shared `StatStrip` for the This week header, the plan builder starting point and the Fuel route prediction. KPI Strip → Fitness CTL/ATL/TSB/Ramp. Fitness Stats → the activity stat grid. stats-18's "value over total" with a meter → Week "3h 35 of 6h 20 planned".
- **Why:** one divided panel instead of six bordered boxes cuts height by about 40% on phones, puts the number first, and a trend badge ("+1 by Sunday" as a green `Badge`) gives the meaning the hint line currently hides.
- **Effort:** low to medium. Rebuild with `Card`, `Separator`, `Badge`, existing Recharts sparklines. No purchase needed.

#### Fuel empty state → Empty State "Team Launch Steps" + File Upload (High)

- **ReUI:** [Empty State](https://reui.io/blocks/application/empty-state) _Team Launch Steps_ (two actions over three colored setup-step tiles) and _Data Import Start_; [Card](https://reui.io/blocks/application/card) _Numbered Setup Steps_; free [File Upload](https://reui.io/components/file-upload) _Basic drag and drop_ and _Card file upload_.
- **Original use:** team onboarding and data import. **Repurposed:** a 2-step "Choose products → Upload a GPX" setup with the current step highlighted and done steps checked, and a dropzone card instead of the native file input.
- **Why:** replaces three repeated paragraphs with a visible sequence; the athlete sees what's done and what's next. Dropzone works with tap on phones and drag on desktop.
- **Effort:** low. File Upload is free; the step tiles are `Card` + `Badge` + `IconTile`-style squares.

#### Fuel plan cards → Radio cards / pricing pattern (High)

- **ReUI:** free [Radio Group](https://reui.io/components/radio-group) _Pricing plan radio cards_ and _Card radio group with descriptions_; Pro [Pricing](https://reui.io/blocks/marketing/pricing) _Customer Logo Pricing_ (Business marked "Best Value", check/minus rows) and _Upgrade Plan Dialog_ (plan rail + detail panel); Pro [Comparison](https://reui.io/blocks/ecommerce/comparison) _Two-Product Compare_ (automatic winner indicators).
- **Original use:** SaaS plan selection. **Repurposed:** pick one of three fuel strategies. Mark the plan closest to target g/h as "Best fit", align g/h, total carbs and caffeine as rows, and make the whole card the radio so the chosen plan stays visibly selected.
- **Why:** the decision is a comparison; today the numbers sit in sentences and there is no selected or recommended state.
- **Effort:** low with the free Radio Group cards.

#### Onboarding and plan builder → Stepper (High)

- **ReUI:** free [Stepper](https://reui.io/components/stepper) _Stepper with segmented progress bar_, _Workspace setup dots_ (dots with the selected step's name and hint below), _Stepper with progress bar and titles_; Pro [Onboarding](https://reui.io/blocks/application/onboarding) _Centered Setup Flow_ (form under a top progress bar, success screen).
- **Repurposed:** one stepper for all 8 screens: top segmented bar with 5 segments, the 4th subdivided for the plan builder, plus "Step 4 of 5 · Your plan" text. Pair with a sticky footer for _Back_/_Continue_.
- **Why:** removes the second progress system, names the current step, and keeps the CTA in thumb reach.
- **Effort:** medium (touches `onboarding-shell.tsx`, `onboarding.tsx`, `plan-builder.tsx`).

#### Pending and error states → Skeleton, Empty, Alert (High)

- **ReUI:** free [Skeleton](https://reui.io/components/skeleton) examples _card grid_, _dashboard stats row_, _list with actions_; free [Empty](https://reui.io/components/empty) _Add button_; [Alert](https://reui.io/components/alert) _with icon and action buttons_.
- **Repurposed:** content-shaped skeletons per route (stat row + list for This week, 2-column grid for Bests); route errors as `Empty` with an icon, a short human message, _Try again_ (`router.invalidate()`), and an offline hint when `navigator.onLine` is false.
- **Why:** no layout jump on load; a way out when a load fails, which matters for a PWA resumed offline.
- **Effort:** low.

#### Sync status → Badge, Sonner, Stats "API Quota Usage" (High)

- **ReUI:** [Badge](https://reui.io/components/badge) with status dot and success/warning/info colors; [Sonner](https://reui.io/components/sonner) _Promise toast with loading state_, _Updatable toast with ID_, _Toast with action button_; Pro [Stats](https://reui.io/blocks/application/stats) _API Quota Usage_ (progress bar for quota, billed cost, renewal date).
- **Repurposed:** header button shows "Synced 9 min ago" with a green/amber dot (amber when paused on rate limits). Settings › Sync becomes an API-Quota-style card: progress of activities with streams, last attempt, next automatic check, paused-until time.
- **Why:** surfaces the "sync paused on rate limits" and "never synced" athlete states that are invisible today.
- **Effort:** low.

#### Heart rate zones → segmented meters (Medium)

- **ReUI:** Pro [Stats](https://reui.io/blocks/application/stats) _Capacity Usage_ (stats-18) and _Adoption Rate_ (stats-14, segmented stacked bar); free [Progress](https://reui.io/components/progress) _with custom colors_.
- **Repurposed:** one compact zone table: zone name, time, % and a colored bar per row in a single 40 px row, with an intensity color ramp (cool to hot). Show "per sport" once in the card header.
- **Effort:** low.

#### Plan adapt dialog → Timeline (Medium)

- **ReUI:** free [Timeline](https://reui.io/components/timeline) _Compact horizontal milestone timeline_ and _Vertical timeline_.
- **Original use:** milestones. **Repurposed:** weeks as timeline nodes with the new phase as a colored badge and the old phase as muted text, grouped where consecutive weeks share the same change ("3 weeks: Hold → Build").
- **Effort:** low.

#### Season goal card → deadline card (Medium)

- **ReUI:** Pro [Card](https://reui.io/blocks/application/card) _Project Deadline Cards_ (client name, due-date countdown, share action); Pro [Stats](https://reui.io/blocks/application/stats) _Task Progress_ (value with animated completion bar and finish-time prediction).
- **Repurposed:** goal card with a large countdown, a build-progress bar (week 1 of 8), and predicted race-day form as the "prediction" line, which the Fitness page already computes.
- **Effort:** low.

#### Day drawer → survey dialog pattern (Medium)

- **ReUI:** Pro [Dialog](https://reui.io/blocks/application/dialog) _Cancel Plan Survey_ (multi-select reason checkboxes, feedback textarea, warning banner); free [Radio Group](https://reui.io/components/radio-group) _Radio group in card with icons_.
- **Original use:** churn survey. **Repurposed:** "Change this day" reasons as selectable cards with a clear checked state, a note field, and a short preview banner of what the re-plan will do.
- **Effort:** low.

#### Plan builder and fuel numeric controls → Number Field, Toggle Group, Tabs (Medium)

- **ReUI:** free [Number Field](https://reui.io/components/number-field) (increment/decrement, min/max/step, pairs with Input Group for units); free [Toggle Group](https://reui.io/components/toggle-group) sizes and outline; [Tabs](https://reui.io/components/tabs) _Segmented control_.
- **Repurposed:** double-session days, bottles carried, carbs per hour and bottle size all use one Number Field with a unit; every single-choice control (period, long-session day, bottles with mix) uses one segmented style with a filled selected state.
- **Effort:** low.

#### Fuel product picker → tabs with counts (Medium)

- **ReUI:** [Tabs](https://reui.io/components/tabs) _Badge counts_; Pro [Settings](https://reui.io/blocks/application/settings) _Import Sources_ (selectable cards, pick limit with toast feedback).
- **Repurposed:** one tab per category (Drink mixes 1, Gels 2, Jellies, Chews, Bars) with the "still needed" check per tab, and a sticky _Save products_ footer; confirm before discarding unsaved picks.
- **Effort:** medium.

#### Settings navigation → navigation list (Medium)

- **ReUI:** free [Item](https://reui.io/components/item) _Clickable navigation items_ (icon, chevron link rows); Pro [Profile](https://reui.io/blocks/application/profile) _Account Settings Hub_ (grouped collapsible sidebar with swappable panels); Pro [Settings](https://reui.io/blocks/application/settings) _General & Display_ (collapsible sections).
- **Repurposed:** on phones `/settings` shows an index list of the six sections (icon, name, one-line summary such as "Gran Fondo Ardennes · week 1 of 8"); each section page gets a back link. Desktop keeps the sidebar.
- **Effort:** medium.

#### Activity detail → Frame, Empty, AI chat starter (Medium)

- **ReUI:** [Frame](https://reui.io/components/frame) _Stacked panels_; free [Empty](https://reui.io/components/empty); Pro [AI Chat](https://reui.io/blocks/ai-agents/ai-chat) _Prompt Starter Welcome_ (welcome screen with starters).
- **Repurposed:** group map + stats + chart in one stacked frame so the page reads as one object; collapse the AI empty state into a single row "Get a coach note · Analyze" with two or three starter chips ("pacing", "terrain").
- **Effort:** medium.

#### Filters toolbar → Analytics Toolbar (Low)

- **ReUI:** Pro [Navbar](https://reui.io/blocks/application/navbar) _Analytics Toolbar_ (two-row bar with date range picker, compare toggle); free [Date Selector](https://reui.io/components/date-selector) (presets, period tabs).
- **Repurposed:** one sticky filter bar (period + sport) shared by Fitness, Heart rate and Map, placed the same way on each page.
- **Effort:** medium.

#### Map → Dispatch Map (Low)

- **ReUI:** Pro [Map solution](https://reui.io/blocks/solutions/map) _Dispatch Map_ (MapLibre, floating Frame panel for the selected item, command search, list view).
- **Repurposed:** floating panel listing the activities in view; tapping a trace opens a summary with a link to the activity.
- **Effort:** high. Low priority because Map is a secondary view.

#### Desktop calendar → Schedule "Team Agenda" (Low)

- **ReUI:** already on ReUI Event Calendar. Pro [Schedule](https://reui.io/blocks/application/schedule) _Team Agenda_ (compact month calendar with per-day category dots and an agenda).
- **Repurposed:** desktop month as compact sport dots plus a side agenda for the selected week, with weekly totals.
- **Effort:** medium.

#### Other low-priority matches

- **Birthday field (#8):** free [Date Selector](https://reui.io/components/date-selector) gives a typed input plus calendar, faster for a birth date than paging months. Effort low.
- **Fitness progress table (#33):** Pro [Card](https://reui.io/blocks/application/card) _Period Trend KPIs_ (bold value with up/down trend badge per period) instead of a 4-column grid on phones. Effort low.
- **Sport and sensor settings (#9):** Pro [Settings](https://reui.io/blocks/application/settings) _Role Capabilities_ (two-column grid of outlined cards with one switch per permission) for sensors per sport. Effort medium.

### Groups with no fitting ReUI element

- **App sidebar on phones (#1):** ReUI [App Shell](https://reui.io/blocks/application/app-shell) blocks are sidebar/topbar shells; none is a bottom tab bar, and the [Navbar](https://reui.io/blocks/application/navbar) blocks don't include one either. A bottom tab bar (This week, Calendar, Season, Fitness, More) would have to be built from shadcn primitives.
- **Signed-out page (#5):** no inspected ReUI element fits. The [Auth](https://reui.io/blocks/application/auth) category exists but was not reviewed in detail.
- **Strava copy step (#7), Add goal drawer (#19), Session detail (#16), Bests (#34):** already the most polished parts. Use them as the reference, not ReUI.
- **Season map chart (#17), stream chart (#23), elevation chart (#29):** domain-specific charts; the free [Chart](https://reui.io/components/chart) examples (bar, area, radial) offer nothing beyond the existing Recharts setup.
- **Danger zone (#37):** current `AlertDialog` is adequate.

---

## Open questions

1. **Calendar "Rest" on planned days.** On phones the calendar showed "Rest" for today while This week planned an _Easy ride_. Is the calendar meant to show only completed activities (the explaining subtitle is hidden on phones), or should planned sessions appear?
2. **"Oct 26" in the Fitness progress table** (Best 12 mo column, read on 24 October 2026). Is it October 2026 (month + year) or a date? It reads as a future day.
3. **Locale.** Which date and time format is intended? The app mixes "19 Oct", "Oct 19", "9:00 AM", "10/24/2026".
4. **Stray "x"** inside the Settings › Sync progress bar text (`innerText` "44 of 44 activities have streams x"). Intentional hidden text or a leftover?
5. **Installed but unused components:** `ui/questionnaire`, `ui/marker`, `ui/attachment`, `ui/bubble`, `ui/message`, `ui/message-scroller` are not imported anywhere. Planned, or leftovers?
6. **Heart-rate zone colors:** Z1 teal, Z2 blue, Z3 green, Z4 amber, Z5 red. A deliberate convention or open to an intensity ramp?
7. **Monospace numbers:** is `font-mono` for values a brand choice? Bests uses sans for its big numbers.
8. **Bottom navigation:** is a phone bottom tab bar acceptable, given the sidebar is the only navigation today?
9. **Product picker discard:** closing the picker drops unsaved selections without a prompt. Intended?
10. **"Before this week's plan"** on a past day of This week: what should the athlete understand from it?
11. **Not audited visually:** sync paused on rate limits, AI analysis streaming and failure, offline, and the installed standalone PWA. These states need a pass once they can be reproduced.
