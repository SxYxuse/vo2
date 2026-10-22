# VO2

VO2 is a personal training companion: it copies an athlete's Strava activities, scores fitness and form, and sets a week target with the best use of the time left.

## People

**Athlete**:
The person whose training VO2 tracks. One athlete is one Strava account.
_Avoid_: User, account, client

**Athlete deletion**:
Permanently removing an athlete and their whole local copy, training plan, routes and fuel plans, and settings, and revoking VO2's access on Strava. It happens at once and cannot be undone.
_Avoid_: Account deletion, deactivation, closing an account

**Athlete settings**:
The athlete's own choices that shape what VO2 shows: per sport type whether it is shown, its colour, and its heart-rate and power sensors; sport-group sharing; and the calendar period. Saved together with the birthday and body weight.
_Avoid_: Calendar settings, preferences, app settings

**Reliable heart rate since**:
The day from which the athlete trusts their recorded heart rate, asked during onboarding with the birthday. Activities without heart rate borrow it only from activities on or after this day (ADR 0019).
_Avoid_: HR start date, strap date

**Body weight**:
The athlete's weight in kilograms, asked during onboarding with the birthday. It caps caffeine in fuel plans.
_Avoid_: Mass, BMI

## Completed work

**Activity**:
A completed session copied from Strava, with a sport type, start time, and duration.
_Avoid_: Workout, exercise, ride (too specific)

**Stream**:
The time-series recording attached to an activity (position, heart rate, power, and similar samples).
_Avoid_: Telemetry, samples, GPS track

**Sport type**:
Strava's specific classification of an activity, such as Run, TrailRun, Ride, or VirtualRide.
_Avoid_: Sport, discipline

**Sport group**:
A display grouping of related sport types: cycling, running, swimming, or walking.
_Avoid_: Sport family (that term is reserved for the week split)

**Hidden sport type**:
A sport type the athlete chose not to show. Its activities stay out of the calendar, map, and heart-rate views, but still count toward training load, fitness, fatigue, and form, the week target, and planning's sensor detection (ADR 0015, ADR 0018).
_Avoid_: Disabled sport, filtered sport, sport selection

**Pace**:
Time to cover a fixed distance. Running and walking use minutes per kilometre; swimming uses minutes per 100 metres.
_Avoid_: Speed, build pace

**Speed**:
Distance covered per time, in km/h. Used for cycling and for sport types that are not running, walking, or swimming.
_Avoid_: Pace, velocity, kph

**Sport family**:
How the week target splits time: running, cycling, or other. Recommended sessions are runs or rides only.
_Avoid_: Sport group, sport type

**Sync**:
Copying new and missing activities and their streams from Strava into VO2. It pauses when Strava's read limits run out. While the app is open, it resumes on its own after the pause to finish an incomplete local copy; the athlete can also sync again by hand.
_Avoid_: Import, fetch, refresh

**Local copy**:
VO2's stored activities and streams. It may be incomplete or paused while older history or streams are still missing.
_Avoid_: Cache, mirror

## Planning

**Training plan**:
The athlete's standing choices for a week: build pace, how the week target is set, rest day, and key sessions.
_Avoid_: Program, schedule, calendar

**Build pace**:
How aggressively fitness should rise this block: hold, slow, steady, fast, or overreach.
_Avoid_: Intensity, ramp rate, Pace (time per distance)

**Hours intent**:
Whether fixed weekly hours should cut, keep, or add volume relative to recent weeks.
_Avoid_: Volume target (the numeric hours live on the training plan)

**Week mix**:
A range of sessions the athlete does a week, and what share of them are key sessions (for example 4–6 sessions at 25 / 75: one key, three to five easy). Key sessions come from the low end of the range; the number of easy sessions settles within it as the week goes. The athlete sets the mix, seeded from their last 3 months; VO2 builds the sessions.
_Avoid_: Workout style, polarized split, session caps

**Key session**:
A precise session VO2 generates each week from the week mix: intervals, time in zone, or a long Z2. The type follows the build pace (the main one always, the others rotating week to week), reps and length follow fitness, and key sessions never take more than 60 % of the week target. One is ticked off when one activity spends at least 80 % of its work time at or above its zone.
_Avoid_: Workout, quality session, planned session

**Easy session**:
One of the week mix's non-key sessions. Easy time left is shared evenly over the easy sessions still to do; any activity of 20 minutes or more that did not tick off a key session fills one.
_Avoid_: Filler, recovery (recovery is a separate, shorter pick when form is very low)

**Training week**:
Monday through Sunday in the athlete's timezone. The week target is scoped to the current week, not a season.
_Avoid_: Microcycle, calendar week

**Week target**:
The hours (and training load) the athlete aims for this training week. Set from fitness at the start of Monday and the build pace, or fixed by the athlete. Every activity counts toward it.
_Avoid_: Bucket, quota, goal (too vague)

**Time left**:
Week target minus the time already done this week. Split into key sessions still open and easy time, and by sport family.
_Avoid_: Remaining sessions, still to fill

**Usual pace**:
Where the athlete normally is by this weekday, from the shape of their last eight weeks. Used to say ahead, on track, or behind.
_Avoid_: Expected, schedule

**Hard time**:
Minutes at heart-rate zone 3 or above. Estimated from load per hour when an activity has no heart-rate stream. Used to keep the day after hard work easy.
_Avoid_: Intensity minutes, quality time

**Today's choice**:
What the athlete says about today: the time they have, the sports in order (up to three parts, such as swim then ride, or ride then strength), and how they feel (let VO2 pick, easy, or hard). VO2 shapes today's pick around it and never refuses it. A key session goes on the first ride or run part; the other parts are easy.
_Avoid_: Override, preference

**Today's pick**:
The one session VO2 builds for today's choice: the next key session that fits, otherwise an easy session. When the choice goes against what VO2 would pick, the pick carries warnings with the cost (for example two hard days in a row) and VO2's own pick stays one tap away.
_Avoid_: Planned session, workout of the day

**Double day**:
A date with two or more sessions of 20 minutes or more, any sports. The week mix sets how many a week the athlete is fine with; VO2 counts the ones done, plans extra easy sessions on the rest, and suggests adding a second sport when the week needs it.
_Avoid_: Brick (a brick is one specific double: a run straight after a ride)

**Dropped key session**:
A key session left out of this week because there are more open key sessions than training days left. Its time moves to easy. Doing it anyway still ticks it off.
_Avoid_: Missed, failed

## Load and form

**Training load**:
A single score of how costly an activity was. Power first, then heart rate, then heart rate borrowed from similar activities, then duration (ADR 0019).
_Avoid_: TSS, relative effort, stress score

**Fitness**:
The slow picture of training load: about six weeks of exponentially weighted load. It rises with consistent work and fades slowly at rest.
_Avoid_: CTL used alone

**Fatigue**:
The short picture of training load: about one week of exponentially weighted load. It jumps after hard or long days and drops within a few easy ones.
_Avoid_: ATL used alone

**Form**:
Fitness minus fatigue at the start of the day, before today's training. Positive means fresh; negative means carrying fatigue.
_Avoid_: TSB used alone, freshness, TSB score

## Anchors

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
One of five effort bands from recovery through VO2 max. Cycling, running, and swimming cut zones from that sport's LTHR; walking and other sports cut from max heart rate.
_Avoid_: Polar zone, Coggan zone, power zone

## Fuelling

**Route**:
A GPX file the athlete uploads for a session they plan to do, with its predicted time along the way. It is not an activity and does not count toward the week target.
_Avoid_: Planned session, course, track

**Climb**:
A sustained uphill on a route, found with the same detection as climbs in activity analysis. Fuel plans treat every climb, not only the biggest ones.
_Avoid_: Major climb, hard effort, key climb

**Carb target**:
Grams of carbohydrate per hour the athlete wants on a route. Defaults to 80 g/h for rides, 60 for runs, and 40 for hikes.
_Avoid_: Fuel rate, CHO rate

**Fuel plan**:
The products chosen for one route and the intakes that take them, reaching the carb target within the bottles carried.
_Avoid_: Nutrition plan, fuelling strategy

**Intake**:
One entry in a fuel plan: what to take, how much, around which time from the start and kilometre, and why.
_Avoid_: Feed, dose

**Fuel product**:
A gel, chew, drink mix, or bar from the stored MNSTRY catalog. Its carbs, glucose:fructose ratio, and caffeine come only from what the store states; a value the store doesn't state stays missing.
_Avoid_: Supplement, nutrition item, SKU

**Your products**:
The fuel products the athlete has ticked as theirs. Fuel plans and swaps use only these.
_Avoid_: Pantry, inventory, stock
