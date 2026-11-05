# VO2

VO2 is a personal training companion: it copies an athlete's Strava activities, scores fitness and form, and has the coach plan each week's runs and rides toward their goals.

## People

**Athlete**:
The person whose training VO2 tracks. One athlete is one Strava account.
_Avoid_: User, account, client

**Athlete deletion**:
Permanently removing an athlete and their whole local copy, coach plan, and settings, and revoking VO2's access on Strava. It happens at once and cannot be undone. Revoking VO2 from Strava's side deletes the athlete too.
_Avoid_: Account deletion, deactivation, closing an account

**Athlete settings**:
The athlete's own choices that shape what VO2 shows: per sport type whether it is shown, its colour, and its heart-rate and power sensors; sport-group sharing; the calendar period; and whether to celebrate top 10 efforts. Saved together with the birthday and body weight.
_Avoid_: Calendar settings, preferences, app settings

**Body weight**:
The athlete's weight in kilograms, asked during onboarding with the birthday. It is used for watts per kilogram on personal bests and power files.
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
_Avoid_: Sport family, discipline

**Other sport type**:
A sport type outside the sport groups, such as WeightTraining, Yoga, or Rowing. Its activities are never shown and it can't be a goal, but they still count toward training load (ADR 0029).
_Avoid_: Unsupported sport, hidden sport type (that is the athlete's choice)

**Hidden sport type**:
A sport type in a sport group that the athlete chose not to show. Its activities stay out of the calendar, map, and heart-rate views, but still count toward training load, fitness, fatigue, and form, and the coach plan's budgets (ADR 0015, ADR 0018).
_Avoid_: Disabled sport, filtered sport, sport selection

**Pace**:
Time to cover a fixed distance. Running and walking use minutes per kilometre; swimming uses minutes per 100 metres.
_Avoid_: Speed

**Speed**:
Distance covered per time, in km/h. Used for cycling and for sport types that are not running, walking, or swimming.
_Avoid_: Pace, velocity, kph

**Sync**:
Copying new and missing activities and their streams from Strava into VO2. It pauses when Strava's read limits run out. While the app is open, it resumes on its own after the pause to finish an incomplete local copy, and checks for new activities when the app opens or returns to the foreground, at most every 15 minutes. The athlete can also sync again by hand.
_Avoid_: Import, fetch, refresh

**Power file**:
A ride's FIT file the athlete imported from their head unit, for what Strava's streams leave out: each leg's share of power, platform center offset, power phase, seated and standing, and gears. It is linked to the synced ride that started within five minutes of it and never counts toward training load, fitness, or bests (ADR 0056).
_Avoid_: Upload, imported activity, FIT activity

**Local copy**:
VO2's stored activities and streams. It may be incomplete or paused while older history or streams are still missing.
_Avoid_: Cache, mirror

## Planning

**Planning style**:
How VO2 plans the athlete's training, chosen in onboarding and settings: the coach plan, or off. Off leaves Season and the calendar but plans nothing, and keeps the coach plan's setup. The week planner was removed (ADR 0050).
_Avoid_: Plan type, planning mode

**Coach plan**:
The planning style where the coach writes precise runs and rides for the next four weeks, toward the season led by an A run or ride, inside the weekly budgets VO2 allows. Its sessions have no day or order (ADR 0048). Swims, walks, and other sports count toward load but aren't planned. It is a coach feature (ADR 0037, ADR 0050).
_Avoid_: AI plan, Runna plan

**Plan sport**:
A sport the coach plan writes sessions for: runs (the running sport group) or rides (the cycling sport group). Each session has one (ADR 0050).
_Avoid_: Sport family, discipline

**The week's sessions**:
The coach plan's runs and rides for one training week, shown as one unordered set with each session's sport and size: a run's distance, a ride's time. A session is done when the athlete marks it, otherwise open (ADR 0048).
_Avoid_: Week plan, schedule, key sessions

**Availability**:
What the athlete gives the coach plan: how many runs and how many rides a week, 0 to 6 each. It has no days and no time per day (ADR 0041, ADR 0048, ADR 0050).
_Avoid_: Schedule, available days, rest days, week shape

**Weekly budget**:
What VO2 lets a week of the coach plan hold, per plan sport: kilometres of running and minutes of riding. Each sport grows with the week's phase at its own progression, up to its peak ceiling. Lighter weeks, recovery, and the taper shrink both (ADR 0037, ADR 0050, ADR 0058).
_Avoid_: Week target, quota, bucket

**Progression**:
How fast a sport's weekly budget grows toward the A goal, set per sport by the athlete as a weekly growth from Hold (no growth) through Gentle, Standard, and Bold to Steep, or anywhere between. Growth stops at the sport's peak ceiling, and the coach plan's week-to-week rules always apply (ADR 0058).
_Avoid_: Ramp, aggressiveness, build rate

**Peak ceiling**:
The biggest week a sport's budget grows to in a season, after which it holds. VO2 recommends one from the athlete's usual week and that sport's next goal; the athlete may set their own, higher or lower. An athlete already above it is never cut (ADR 0058).
_Avoid_: Max volume, target volume, peak target

**Training paces**:
The pace ranges the coach plan's sessions target, from easy to repetition, read from a VDOT. The athlete chooses what it comes from: Automatic (the estimate from recent best efforts), one of their best efforts, or a race result. The easy pace comes from the pace they hold in running zone 2 by default, never faster than marathon pace, or from the VDOT (ADR 0042).
_Avoid_: Zones (those are heart rate), target pace, goal pace

**Cycling zone**:
The effort a ride step targets, from recovery to sprint: Coggan's levels as a share of FTP, with sweet spot between tempo and threshold. A planned ride shows it in watts from FTP, or in heart rate from cycling LTHR without power (ADR 0050).
_Avoid_: Power zone, heart-rate zone (that is the five heart-rate bands)

**Predicted race time**:
The time VO2 expects the athlete to run a goal's distance today, read from their training paces. Goals have no target time; the prediction takes its place.
_Avoid_: Goal time, target time, race estimate

**Plan change**:
A change to the coach plan the coach proposes in the coach chat, shown session by session before and after. A changed session keeps its week and sport. It is applied only when the athlete taps Apply, and only if it keeps the coach plan's rules (ADR 0038).
_Avoid_: Re-plan, adaptation, edit

**Goal**:
A race or event on the athlete's season: name, sport type, date, distance, elevation gain, and priority. Goals on the same date are one event (a triathlon entered once, with a leg per sport, named "Event · Leg").
_Avoid_: Target, race (not every goal is one)

**Priority**:
Whether a goal is a main goal or a supporting race. The next main goal leads the season: the plan builds, peaks, and fully tapers for it, with a recovery week after. A supporting race never leads, and takes an effort (ADR 0052).
_Avoid_: Importance, objective, C race, race intent

**Main goal**:
A goal with priority A, raced to perform at 100 %. Several can be planned, each with its own build, taper, and recovery.
_Avoid_: Target, A race

**Supporting race**:
A goal with priority B, run at an effort: fun, steady, or all out. It never leads the season, and the week's other runs stay easy.
_Avoid_: B race, tune-up

**Effort**:
How a supporting race is run: fun (easy pace, minimal impact on the plan), steady (70–80 %), or all out. Set when the athlete adds the race (ADR 0052).
_Avoid_: Intensity, intent, objective

**Season**:
The athlete's goals in date order. The coach plan works toward the next A run or ride, and adds the season's other runs and rides as races. Plan shows the season week by week through the last goal, with each week's phase and running and riding budget, the written weeks, and what the plan does for each goal ahead (ADR 0050, ADR 0058).
_Avoid_: Calendar, year, block

**Phase**:
Where the week sits on the way to the next A goal, read at the start of Monday: base, build (or maintain when the last goal was close or ended under two weeks ago), peak, taper, race week, recovery, or hold without a goal. It sets how the coach plan's budgets grow and what sessions the coach writes (ADR 0021, 0022).
_Avoid_: Build pace, block, training phase (that is read from fitness)

**Lighter week**:
Every fourth week before the peak, counted back from the goal: 70 % of the usual budgets, so the work of the three weeks before sinks in.
_Avoid_: Rest week, deload, recovery (that follows a goal)

**Guardrail**:
A limit on how fast load grows: the fitness chart's race-day projection never grows more than 10 % above the last four weeks' average load, eases off when form is low, and holds for two weeks after an A goal. The coach plan's budgets have their own caps per sport (ADR 0037, ADR 0050).
_Avoid_: Cap, safety limit

**Session status**:
How a coach-plan session stands: done when the athlete marks it, otherwise open, with no day, no missed state, and no automatic match (ADR 0048).
_Avoid_: Completed, compliance

**Coach**:
The AI the athlete talks to about their training. In a chat it answers questions from the local copy, the coach plan, and the season, and changes nothing but the coach plan, through a plan change the athlete applies. It also writes the coach plan. It runs only on the athlete's OpenRouter key.
_Avoid_: Assistant, agent, bot, AI

**Coach feature**:
One of the two things the coach does: coach chat (which proposes plan changes) and writing the coach plan. The athlete picks the model for each one.
_Avoid_: AI feature

**OpenRouter key**:
The athlete's own OpenRouter key, which every coach feature runs on. It is saved with the athlete's account, so it works on every device, and is never shown again once saved; without it, no coach feature runs.
_Avoid_: API key, token, BYOK key

**Coach chat**:
A conversation between the athlete and the coach. The server keeps every chat, so the athlete reopens or deletes any of them from **Chats** on any device; the one opened last still reads offline. Starting a new chat keeps the others.
_Avoid_: Thread, session (that is planned training), conversation history

**Training week**:
Monday through Sunday in the athlete's timezone. The coach plan's budgets are per training week.
_Avoid_: Microcycle, calendar week

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
