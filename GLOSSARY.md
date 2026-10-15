# vo

vo is a personal training companion: it copies an athlete's Strava activities, scores fitness and form, and fills the rest of the week with planned sessions.

## People

**Athlete**:
The person whose training vo tracks. One athlete is one Strava account.
_Avoid_: User, account, client

## Completed work

**Activity**:
A completed session imported from Strava, with a sport type, start time, and duration.
_Avoid_: Workout, exercise, ride (too specific)

**Stream**:
The time-series recording attached to an activity (position, heart rate, power, and similar samples).
_Avoid_: Telemetry, samples, GPS track

**Sport type**:
Strava's specific classification of an activity, such as Run, TrailRun, Ride, or VirtualRide.
_Avoid_: Sport, discipline

**Sport group**:
A display grouping of related sport types: cycling, running, swimming, or walking.
_Avoid_: Sport family (that term is reserved for planning)

**Sport family**:
The planning axis for remaining-week work: running or cycling only.
_Avoid_: Sport group, sport type

## Planning

**Training plan**:
The athlete's standing constraints for how a week is filled: build pace, hours, run/ride counts, rest day, and workout style.
_Avoid_: Program, schedule, calendar

**Build pace**:
How aggressively fitness should rise this block: hold, slow, steady, fast, or overreach.
_Avoid_: Intensity, ramp rate

**Hours intent**:
Whether this block should cut, keep, or add weekly volume relative to recent weeks.
_Avoid_: Volume target (the numeric hours live on the training plan)

**Workout style**:
Hours of easy aerobic work, or structured intervals when form allows.
_Avoid_: Polarized, sweet-spot

**Training week**:
Monday through Sunday in the athlete's timezone. Planned work is scoped to the current week, not a season.
_Avoid_: Microcycle, calendar week (the calendar may start on Sunday)

**Planned session**:
A run or ride still to do this week, with a target duration and training load, not a clock time.
_Avoid_: Workout, event, appointment

**Week bucket**:
The pool of open planned sessions for the current training week. The athlete picks a session when they have a time window.
_Avoid_: Schedule, timetable, calendar

**Adapted session**:
A planned session rewritten after new completed work, still open until it is done.
_Avoid_: Updated (UI badge only)

**Session match**:
Linking a completed activity to a planned session when sport family and duration fit.
_Avoid_: Auto-assign, pairing

**Double day**:
Two planned sessions stacked on one calendar day, capped by the training plan.
_Avoid_: Brick (a brick is a specific stacked run after a ride)

## Load and form

**Training load**:
A single score of how costly an activity was. Power first, then heart rate, then duration.
_Avoid_: TSS, relative effort, stress score

**Fitness**:
The slow picture of training load: about six weeks of exponentially weighted load. It rises with consistent work and fades slowly at rest.
_Avoid_: CTL used alone

**Fatigue**:
The short picture of training load: about one week of exponentially weighted load. It jumps after hard or long days and drops within a few easy ones.
_Avoid_: ATL used alone

**Form**:
Fitness minus fatigue. Positive means fresh; negative means carrying fatigue.
_Avoid_: TSB used alone, freshness, TSB score

## Anchors and tests

**FTP**:
Estimated ~60-minute maximal cycling power, used as the cycling power anchor.
_Avoid_: Threshold watts, FTP watts as a second term

**LTHR**:
Lactate-threshold heart rate. It is sport-specific: cycling LTHR and running LTHR are different numbers.
_Avoid_: Threshold HR, LT, copying one sport's LTHR onto another

**Max heart rate**:
The highest heart rate used as a zone anchor when a sport has no LTHR model.
_Avoid_: HRmax as a second term, peak HR (that is a field-test observation)

**Field test**:
A prescribed all-out protocol that measures an anchor (FTP, running VO2max, or LTHR). It is never mixed into the week bucket.
_Avoid_: Assessment, fitness test, race

**Heart-rate zone**:
One of five effort bands from recovery through VO2 max. Cycling, running, and swimming cut zones from that sport's LTHR; walking and other sports cut from max heart rate.
_Avoid_: Polar zone, Coggan zone, power zone
