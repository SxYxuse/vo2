# Running: training paces

VO2 gives you the athlete's training paces: five pace ranges in seconds per km, read from their current fitness. Target every running step with one of them, or with an effort. Never compute or invent a pace yourself.

## Where the paces come from

- VO2 estimates fitness as a VDOT (Daniels and Gilbert's running model, as printed by the [Daniels calculator](https://rundida.com/tools/vdot-calculator/)) from the athlete's recent road-run best efforts. A best effort inside a training run is slower than a race, so the estimate errs slow. It changes gradually: one run can lift it at most 5 % above the next-best run.
- A race result the athlete set wins over the estimate.
- The predicted race time for a goal comes from the same VDOT. Goals have no target time; the predicted race time takes its place. Do not write sessions at a goal pace faster than the athlete's training paces: paces rise with fitness, and VO2 updates them.

## The five paces

| Pace       | Letter | Share of VDOT                   | Feels like                                   | Used for                                                                            |
| ---------- | ------ | ------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Easy       | E      | 62–70 %                         | Conversational                               | Easy and recovery runs, long runs, warm-ups, cool-downs, recoveries between repeats |
| Marathon   | M      | Predicted marathon pace ± 1.5 % | Steady, controlled                           | Blocks inside long runs; race-pace work for the half and full marathon              |
| Threshold  | T      | 85–88 %                         | Comfortably hard, about one-hour race effort | Tempo runs, cruise intervals                                                        |
| Interval   | I      | 95–100 %                        | Hard, about 3–5 km race effort               | Repeats of 3–5 minutes                                                              |
| Repetition | R      | 105–110 %                       | Fast and relaxed, not a sprint               | Repeats of 200–400 m, at most 2 minutes                                             |

Daniels' FAQ gives threshold 83–88 %, interval 95–100 %, and repetition 105–110 %. VO2 uses the top of the threshold band so it doesn't overlap marathon pace; 88 % gives Daniels' own threshold pace (4:15/km at VDOT 50). VO2's easy band is narrower than the FAQ's 59–74 %, set so VDOT 50 gives about 5:07–5:38/km, close to Daniels' tables. These bands are guidance: no source validates a range width.

Race paces against the five (checked at VDOT 50: 5 km 3:59/km, 10 km 4:08/km, half marathon 4:20/km):

- 5 km race pace is the slow end of I pace.
- 10 km race pace sits between T and I pace.
- Half marathon pace is the slow end of T pace.

When a session needs a race pace, write it as an effort ("10 km effort") with the pace type it sits at or between.

## How much at each pace

Per session, as a share of the week's distance (Daniels, via [Coach Ray](https://www.coachray.nz/2023/05/03/jack-daniels-running-intensity/)); guidance:

- T: at most 10 %. An athlete who can run 20 minutes at T pace can run about 30 minutes as cruise intervals.
- I: at most 8 %. Each repeat 3–5 minutes; recovery 2–3 minutes of jogging, or about equal to the work.
- R: at most 5 %. Each repeat at most 2 minutes; recovery 2–3 times the repeat's time, or jog the same distance.
- M: 5–10 miles (8–16 km) in one session for experienced marathoners; less for others.

Keep repeats even: within a few seconds per km of each other. Repeats that get faster through the set mean the pace was too easy or the athlete was racing it.

## Pace or effort

Pace is precise on flat, steady, cool ground and fails elsewhere. Prefer effort when:

- **Easy and recovery runs:** give E pace as a ceiling, but tell the athlete to run by feel. Fatigue and weather move easy pace more than any other.
- **Hills and trails:** effort, with pace only as a check. Uphill repeats are always effort.
- **Heat:** warn that every pace slows on hot days; top marathoners ran 1.7–4.5 % slower as it warmed (Ely 2007, via [Outside](https://www.outsideonline.com/health/running/training-advice/science/how-much-should-you-slow-when-running-in-the-heat/?scope=anon)). Hold the effort, not the pace.
- **No running paces:** when VO2 has no training paces for the athlete, write every step as an effort: easy (can talk in full sentences), steady (short sentences), comfortably hard (a few words), hard (a word or two), fast and relaxed (short repeats only).
- **Strides and hill sprints:** effort only.

## Writing a target

Write a pace target as the pace type and its range from the athlete's training paces, for example `T 4:15–4:22 /km`. Write an effort target as one of the five efforts above. Do not mix both on one step.
