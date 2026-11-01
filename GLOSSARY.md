# VO2

VO2 is a personal training companion: it copies an athlete's Strava activities, scores fitness and form, and plans each training week day by day toward their goals.

## People

**Athlete**:
The person whose training VO2 tracks. One athlete is one Strava account.
_Avoid_: User, account, client

**Athlete deletion**:
Permanently removing an athlete and their whole local copy, training plan, and settings, and revoking VO2's access on Strava. It happens at once and cannot be undone. Revoking VO2 from Strava's side deletes the athlete too.
_Avoid_: Account deletion, deactivation, closing an account

**Athlete settings**:
The athlete's own choices that shape what VO2 shows: per sport type whether it is shown, its colour, and its heart-rate and power sensors; sport-group sharing; the calendar period; and whether to celebrate top 10 efforts. Saved together with the birthday and body weight.
_Avoid_: Calendar settings, preferences, app settings

**Body weight**:
The athlete's weight in kilograms, asked during onboarding with the birthday. It is used for watts per kilogram on personal bests.
_Avoid_: Mass, BMI

## Completed work

**Activity**:
A completed session copied from Strava, with a sport type, start time, and duration.
_Avoid_: Workout, exercise, ride (too specific)

**Stream**:
The time-series recording attached to an activity (position, heart rate, power, and similar samples).
_Avoid_: Telemetry, samples, GPS track

**Activity map**:
The map of one activity, showing where it happened, drawn from Strava's outline of its path. Activities without an outline, such as most indoor sessions, have none. Not the map of all activities.
_Avoid_: GPS track, course

**Sport type**:
Strava's specific classification of an activity, such as Run, TrailRun, Ride, or VirtualRide.
_Avoid_: Sport, discipline

**Sport group**:
A display grouping of related sport types: cycling, running, swimming, or walking. These are the only sports VO2 shows.
_Avoid_: Sport family (that term is reserved for the week split)

**Other sport type**:
A sport type outside the sport groups, such as WeightTraining, Yoga, or Rowing. Its activities are never shown, except as extras in the week plan, and it can't be a goal, but they still count toward training load and the week target's hours (ADR 0029).
_Avoid_: Unsupported sport, hidden sport type (that is the athlete's choice)

**Hidden sport type**:
A sport type in a sport group that the athlete chose not to show. Its activities stay out of the calendar, map, and heart-rate views, but still count toward training load, fitness, fatigue, and form, the week target, and planning's sensor detection (ADR 0015, ADR 0018).
_Avoid_: Disabled sport, filtered sport, sport selection

**Pace**:
Time to cover a fixed distance. Running and walking use minutes per kilometre; swimming uses minutes per 100 metres.
_Avoid_: Speed

**Speed**:
Distance covered per time, in km/h. Used for cycling and for sport types that are not running, walking, or swimming.
_Avoid_: Pace, velocity, kph

**Sport family**:
How the week target splits time: running, cycling, or other (swims and walks count as other).
_Avoid_: Sport group, sport type

**Sync**:
Copying new and missing activities and their streams from Strava into VO2. It pauses when Strava's read limits run out. While the app is open, it resumes on its own after the pause to finish an incomplete local copy, and checks for new activities when the app opens or returns to the foreground, at most every 15 minutes. The athlete can also sync again by hand.
_Avoid_: Import, fetch, refresh

**Local copy**:
VO2's stored activities and streams. It may be incomplete or paused while older history or streams are still missing.
_Avoid_: Cache, mirror

## Planning

**Planning style**:
How VO2 plans the athlete's training, chosen in onboarding and settings: off, the week planner, or the coach plan. Off leaves Season and the calendar but plans nothing.
_Avoid_: Plan type, planning mode

**Week planner**:
The planning style where VO2's own rules set each week's time per sport and its key sessions, and lay them out on the athlete's free days.
_Avoid_: Algorithmic plan, classic plan

**Coach plan**:
The planning style where the coach writes precise sessions for the next four weeks on the athlete's availability, toward an A goal, inside the weekly distance VO2 allows. For now it plans runs only. It is a coach feature (ADR 0037).
_Avoid_: AI plan, Runna plan

**Availability**:
What the athlete gives the coach plan: how many runs a week, the days they can run, the time they have each day, and the long run day.
_Avoid_: Schedule, rest days (that is the week planner's term), week shape

**Training paces**:
The pace ranges the coach plan's sessions target, from easy to repetition, read from the athlete's current fitness. A race result the athlete sets wins over the estimate from best efforts.
_Avoid_: Zones (those are heart rate), target pace, goal pace

**Predicted race time**:
The time VO2 expects the athlete to run a goal's distance today, read from their training paces. Goals have no target time; the prediction takes its place.
_Avoid_: Goal time, target time, race estimate

**Plan change**:
A change to the coach plan the coach proposes in the chat or from a note on a day, shown day by day before and after. It is applied only when the athlete taps Apply, and only if it keeps the coach plan's rules (ADR 0038).
_Avoid_: Re-plan (that is the week planner laying the week out again), adaptation, edit

**Training plan**:
What the athlete built in the plan builder: the week's shape (rest days, long session day, double-session days, sports to plan), the plan goals, when it started, and an optional starting point after a break. Settings → Training edits the shape; rebuilding the plan replaces it all (ADR 0026).
_Avoid_: Program, schedule, calendar

**Plan builder**:
The four steps that build or rebuild the training plan: the season, where the athlete is now, when they can train, and a preview. Every answer starts from the athlete's Strava history and the goals on Season; it never adds goals.
_Avoid_: Onboarding (that is the whole first setup), wizard

**Plan goals**:
The copy of the athlete's goals the training plan was built or last adapted on. Phases are read from it, not from Season, so a season change shows before it reshapes the week.
_Avoid_: Season (that is the live list), snapshot

**Season change**:
A difference between the plan goals and the goals on Season. One that changes a week before the end of the current block (the leading goal and its recovery week) asks the athlete to adapt the plan or keep it; any other is taken into the plan goals at once.
_Avoid_: Re-plan (that is laying the rest of a week out again), sync

**Goal**:
A race or event on the athlete's season: name, sport type, date, distance, elevation gain, objective, and priority. Goals on the same date are one event (a triathlon entered once, with a leg per sport, named "Event · Leg").
_Avoid_: Target (that is the week's hours), race (not every goal is one)

**Objective**:
What the athlete wants from a goal: finish, finish well, or perform. On the goal the plan leads to, it sets how fast fitness rises and how many key sessions a week (one, two, or three); on a B or C goal it sets how many easy days go around it (ADR 0026). Only the week planner uses it; with the coach plan it is hidden and every goal is perform.
_Avoid_: Priority, ambition

**Priority**:
How much a goal matters: A (the plan builds, peaks, and fully tapers for it, with a recovery week after), B (lighter days before it, by its objective), or C (trained through, with easy days around it to finish well or perform). The next A event leads the season; without one, the next B event does (ADR 0024, ADR 0026).
_Avoid_: Main goal, importance, A/B race when meaning the objective

**Season**:
The athlete's goals in date order. The plan works toward the next A goal. The season map shows each week's phase and expected hours through the last goal.
_Avoid_: Calendar, year, block

**Phase**:
Where the week sits on the way to the next A goal, read at the start of Monday: base, build (or maintain when the last goal was close or ended under two weeks ago), peak, taper, race week, recovery, or hold without a goal. It sets the ramp, the key session types, and the sport split (ADR 0021, 0022).
_Avoid_: Build pace, block, training phase (that is read from fitness)

**Lighter week**:
Every fourth week before the peak, counted back from the goal: 70 % of the usual load and one key session, so the work of the three weeks before sinks in.
_Avoid_: Rest week, deload, recovery (that follows a goal)

**Guardrail**:
A limit on the phase's ramp: never more than 10 % above the last four weeks' average load, eased off when form is low, and no ramp in the two weeks after an A goal. The week target says when one held it back.
_Avoid_: Cap (that is the hours the athlete has), safety limit

**Rest days**:
The weekdays the athlete never trains, one to four of them. The plan puts no session on them; a race on one still shows.
_Avoid_: Off days, recovery days

**Long session day**:
The training day the long session goes on when the week has one. Read from the weekday of the athlete's longest activities.
_Avoid_: Weekend ride, long run day

**Double-session day**:
A training day the plan may put two sessions on. The athlete sets how many a week; the second session is always easy, never on the long session's day or a key session's day, and is used when the week's time does not fit in one session a day or a sport would get no time otherwise.
_Avoid_: Brick (a brick is one specific double: a run straight after a ride), double day

**Key session**:
A precise session VO2 generates each week: intervals, time in zone, or a long Z2. How many follows the leading goal's objective within the phase's limit and half the training days; the type follows the phase and objective (the main one always, the others rotating week to week), reps and length follow fitness, and key sessions never take more than 60 % of the week target. Toward a goal, the main and long sessions go on the goal's sport (ride, run, swim, or walk), the long session leads in base and comes second from build on, grows toward the goal's expected time at the athlete's own pace, and is shortened rather than dropped when the week is short; a hilly goal puts intervals on a climb. Intervals are ticked off when one ride, run, swim, or walk spends at least 80 % of its work time at or above its zone; a goal's long session only on the goal's sport.
_Avoid_: Workout, quality session, planned session

**Easy session**:
A planned session in zone 2 that is not a key session, at least 45 minutes on a bike or 30 on foot. Easy time is the week target minus key sessions and races, shared over the training days left. Any ride, run, swim, or walk of 20 minutes or more on its day fills one.
_Avoid_: Filler, recovery (recovery is a shorter, zone 1 session when the athlete asks to take it easy while tired)

**Week plan**:
The training week laid out Monday to Sunday: key, easy, and second sessions, rest days, races and openers. Laid out by the algorithm the first time the week is opened; the days after today are laid out again when a key session is missed or done elsewhere, a coach note arrives, the week's shape changes, or the plan adapts to the season. Days behind keep what was planned.
_Avoid_: Schedule, calendar (that shows activities), day plan

**Session status**:
How a planned session stands against the copied activities: done, missed (its day passed without it), moved (a missed key session planned again later), or planned. An activity that fills no planned session is extra. In the coach plan, a run linked or unlinked by the athlete wins over the automatic match.
_Avoid_: Completed, compliance

**Coach note**:
What the athlete tells the coach about a day: a quick choice (can't train, short on time, indoor only, take it easy) or their own words, which the model reads into those same constraints. The week plan honours them; on the coach plan, a note asks the coach for a plan change.
_Avoid_: Comment, feedback, journal

**Coach**:
The AI the athlete talks to about their training. In a chat it answers questions from the local copy, the training plan, and the season, and changes nothing but the coach plan, through a plan change the athlete applies. It also writes the coach plan, reads coach notes, and writes activity analyses. It runs only on the athlete's OpenRouter key.
_Avoid_: Assistant, agent, bot, AI

**Coach feature**:
One of the four things the coach does: activity analysis, reading coach notes in the athlete's own words, coach chat, and writing the coach plan. The athlete picks the model for each one. Quick-choice coach notes are not a coach feature: they need no model.
_Avoid_: AI feature

**Activity analysis**:
The coach's written reading of one activity, saved with the model that wrote it.
_Avoid_: Summary, insight, AI analysis

**OpenRouter key**:
The athlete's own OpenRouter key, which every coach feature runs on. It is saved with the athlete's account, so it works on every device, and is never shown again once saved; without it, no coach feature runs.
_Avoid_: API key, token, BYOK key

**Coach chat**:
The one ongoing conversation between the athlete and the coach. It is kept on the device it happened on and still reads offline; starting a new chat deletes it.
_Avoid_: Thread, session (that is planned training), conversation history

**Training week**:
Monday through Sunday in the athlete's timezone. The week target is scoped to the current week, not a season.
_Avoid_: Microcycle, calendar week

**Week target**:
The hours (and training load) the athlete aims for this training week. Set from fitness at the start of Monday and the phase within the guardrails. Without history it is 45 minutes per training day; after a break it grows from the athlete's starting point by at most 10 % a week. Every activity counts toward it.
_Avoid_: Bucket, quota, goal (that is a race or event)

**Hard time**:
Minutes at heart-rate zone 3 or above. Estimated from load per hour when an activity has no heart-rate stream. Used to keep the day after hard work easy.
_Avoid_: Intensity minutes, quality time

## Load and form

**Training load**:
A single score of how costly an activity was. Power first, then heart rate, then heart rate borrowed from similar activities, then duration (ADR 0019).
_Avoid_: TSS, relative effort, stress score

**Fitness**:
The slow picture of training load: about six weeks of exponentially weighted load. It rises with consistent work and fades slowly at rest. It measures load absorbed, not ability (ADR 0033).
_Avoid_: CTL used alone

**Fatigue**:
The short picture of training load: about one week of exponentially weighted load. It jumps after hard or long days and drops within a few easy ones.
_Avoid_: ATL used alone

**Form**:
Fitness minus fatigue at the start of the day, before today's training. Positive means fresh; negative means carrying fatigue.
_Avoid_: TSB used alone, freshness, TSB score

**Training phase**:
Where the athlete is in the cycle of building, consolidating, recovering, and freshening up, read from the last week's change in fitness, the four-week trend, and form.
_Avoid_: Block, periodization, status

**Best effort**:
One activity's best over a fixed duration or distance: the best average power on a ride with a power meter, or the fastest time over a distance inside a road run, an outdoor ride, or a swim. Progress compares the last six weeks with the six before and the best of the year (ADR 0033, ADR 0025).
_Avoid_: PR, record, mean-max

**Power curve**:
The athlete's best average power at every duration from seconds to hours, drawn as one line.
_Avoid_: Mean-max curve, power duration curve, critical power

**Personal best**:
The top best effort for one distance or duration across the local copy, or within a chosen period. "All time" means everything copied so far, which may not yet be the athlete's whole Strava history.
_Avoid_: PR, record, all-time best

**Top 10 effort**:
A best effort or biggest day that ranks in the top 10 of its distance, duration, or kind, either all time or within its calendar year. The first place is the personal best.
_Avoid_: Top 10 performance, PR, record

**Biggest day**:
A single-activity best that is not a pace or power: the longest activity, the most climbing in one activity, or the biggest single climb.
_Avoid_: Record, achievement, milestone

## Anchors

An anchor is either estimated by VO2 or set by the athlete. A set anchor wins over the estimate.

**FTP**:
Estimated ~60-minute maximal cycling power, used as the cycling power anchor.
_Avoid_: Threshold watts, FTP watts as a second term

**LTHR**:
Lactate-threshold heart rate. It is sport-specific: cycling LTHR, running LTHR, and swimming LTHR are different numbers.
_Avoid_: Threshold HR, LT, copying one sport's LTHR onto another

**Resting heart rate**:
The heart rate used as the floor of heart-rate reserve when scoring training load. Estimated from easy days when the athlete has no measured value.
_Avoid_: RHR as a second term, using 60 for everyone when an estimate exists

**Max heart rate**:
The highest heart rate used as a zone anchor when a sport has no LTHR model. It is the sport's highest recent peak with sensor spikes dropped, checked against the athlete's age.
_Avoid_: HRmax as a second term, peak HR as a second term, all-time max

**Efficiency factor**:
Output per heartbeat on an aerobic session: normalized power ÷ average heart rate on a metered ride, speed ÷ average heart rate on a flat run. Rising efficiency means more work for the same heart rate.
_Avoid_: EF used alone, aerobic efficiency score, fitness (that is training load)

**Aerobic decoupling**:
How much output per heartbeat fell from the first to the second half of a steady session after warm-up. Under 5 % means heart rate held steady against output.
_Avoid_: Cardiac drift (that is heart rate alone), Pa:HR, Pw:HR

**Usual heart rate**:
The average heart rate the athlete's recent aerobic sessions needed for a given output. An activity is "higher than usual" when it ran 5 bpm or more above it.
_Avoid_: Expected HR, baseline HR, resting heart rate

**Heart-rate zone**:
One of five effort bands from recovery through VO2 max, cut by the sport's zone method.
_Avoid_: Polar zone, Coggan zone, power zone

**Zone method**:
How a sport's five heart-rate zones are cut from its anchors: % of LTHR, % of max heart rate, heart-rate reserve, or custom boundaries. Cycling, running, and swimming each have their own, chosen by the athlete; walking and other sports always use % of max heart rate.
_Avoid_: Zone model, zone system, zone preset
