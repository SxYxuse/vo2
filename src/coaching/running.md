# Running

Everything VO2 knows about planning runs: how a week is built, the training paces, and the sessions to write.

## Load and weekly structure

You write the athlete's coach plan: each week's running sessions, with no day, inside a weekly budget VO2 sets. The athlete picks the days to run them. VO2 checks every plan in code. A plan that breaks a rule comes back to you with the reason. Write sessions that pass the first time.

Evidence tags: **rule** means VO2 checks it in code. **Guidance** means coaching convention or weak evidence; follow it unless the athlete's situation gives a reason not to. Sources are linked where a number comes from one.

### Rules VO2 checks

1. **Weekly distance stays inside the budget.** VO2 gives you each week's kilometres. They follow the season phase and never exceed 15 % above the biggest of the last four weeks. After a break, the floor is 60 % of the usual weekly kilometres before it; with no history, it is runs per week × 3 km. Plan 95–100 % of the budget.
2. **No run is more than 10 % longer than the longest run of the last 30 days.** A single run longer than the recent longest is the best-supported spike signal for injury (Garmin-RUNSAFE cohort, 5,205 runners, [secondary coverage](https://www.shoulditrain.com/blog/10-percent-rule-running-injury-myth)). Grow the long run in steps.
3. **Sessions have no day.** Each session belongs to a week, and the athlete picks the day. A week holds no more runs than the athlete's runs per week, fewer in a week already under way. Never name a day in a session.
4. **Quality sessions per week:** 1 for 2–3 runs, 2 for 4–5 runs, at most 3 for 6 runs. The long run counts as quality only when it has marathon-pace or faster work in it.
5. **The long run is at most twice the average of the week's other runs, and at most 2 h 30.** As a share of the week: 67 % with 2 runs, 50 % with 3, 40 % with 4, 33 % with 5, and 30 % from 6 runs, which is Daniels' limit ([Running Magazine](https://runningmagazine.ca/?p=99607), reported second-hand). Daniels' 30 % was written for athletes running most days; with fewer runs it would keep the long run near the length of the others. How fast the long run grows is rule 2's job, not the share's.
6. **Every fourth week is lighter, about 70 % of the week before.** The size and rhythm of cutbacks have no controlled trial behind them (guidance in origin); VO2 enforces them because athletes skip them otherwise.
7. **Taper: two weeks before a marathon, one to two weeks before shorter races.** Cut volume, keep intensity and frequency (Bosquet 2007 meta-analysis: a two-week taper with volume cut 41–60 %, [PubMed](https://pubmed.ncbi.nlm.nih.gov/17762369/)).
8. **A missed session is skipped.** Continue the plan from the next session. Never add its distance to another run or add a run to make it up.

### Week structure

Use the athlete's availability: runs per week. Write that many runs each week, or the fewer VO2 gives for a week already under way. There is no time per day: size each session by the week's budget and the rules, and keep the long run within 2 h 30.

Templates by runs per week (guidance; no study compares them):

| Runs | Week                                                                   |
| ---- | ---------------------------------------------------------------------- |
| 2    | 1 quality or long run, 1 easy. Maintenance or beginners only.          |
| 3    | 1 quality, 1 easy, 1 long.                                             |
| 4    | 1 quality, 2 easy, 1 long.                                             |
| 5    | 2 quality, 2 easy, 1 long; or 1 quality, 3 easy, 1 long for beginners. |
| 6    | 2 quality (3 at most for experienced athletes), 3 easy, 1 long.        |

- The long run is the longest run of the week.
- With two quality sessions, make them different: one threshold-type, one interval- or race-pace-type.

### Intensity distribution

- Most running is easy. Seiler's 80/20 counts sessions: about 80 % of an elite endurance athlete's sessions are easy (described second-hand in [this summary](https://roadmancycling.com/blog/stephen-seiler-research-polarised-training-lessons)); by time, the easy share is closer to 90 %. Polarized training did well in one small randomized trial ([Stöggl & Sperlich 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC3912323/)). The quality-session counts in rule 4 already give this mix. Guidance, not a rule.
- Per-session caps on running at each pace, as shares of the week's distance (Daniels, via [Coach Ray](https://www.coachray.nz/2023/05/03/jack-daniels-running-intensity/)): marathon pace at most 20 % and 1 h 50, threshold at most 10 %, interval at most 8 %, repetition at most 5 %. Count only the work at that pace, not the warm-up, cool-down, or recoveries. Size every session from the week's budget with these caps; _Session library_ shows how. Guidance, but treat the caps as firm: when an example session is bigger than the cap allows, take repeats off until it fits.
- Progress one thing at a time: more distance, or more hard work, not both in the same week. Guidance.

### Long run

- Easy pace by default. In build and peak phases for a half or full marathon, a long run may carry a block at marathon pace (see _Session library_); it then counts as a quality session.
- The long run's length comes from the week: at most twice the average of the week's other runs and at most 2 h 30 (rule 5), and no more than 10 % longer than the longest run of the last 30 days (rule 2). Whichever is smallest wins.
- Coaches aim for these peaks by goal distance (guidance, coach consensus): 5 km: 60–75 min. 10 km: 75–90 min. Half marathon: about 2 h. Marathon: 2 h 30. Reaching them needs enough weekly volume: a 2 h 30 long run needs about 5 h of running a week with 3 runs, and about 8 h 20 with 6. When the week is smaller, the rules above win and the long run stays shorter; never break a rule to reach a peak.
- Reach the peak by growing from the longest run of the last 30 days, at most 10 % per step (rule 2).

### Season phases

VO2 tells you each week's phase. Shape the sessions to it (guidance):

- **Base:** mostly easy running, strides, short hills. At most one threshold session a week. The long run grows.
- **Build:** add the quality sessions the goal distance needs (table in _Session library_). Race-specific work grows through the phase.
- **Peak:** the most race-specific work: race-pace sessions and the longest long runs.
- **Taper:** cut distance as VO2's budget says; keep one or two short quality sessions at race pace or faster, with fewer repeats, still within the caps above. No new kinds of session.
- **Lighter week:** the same kinds of session, fewer repeats and a shorter long run. Drop a quality session if the week has two.
- **Recovery** (after the main race or an all-out one): easy running only. One easy day per mile raced is folklore, not evidence; use the budget VO2 gives.

### Missed sessions and changes

- A missed session is skipped (rule 8): never squeeze its work into the other runs.
- After a short break (up to about three weeks), rebuild over about the same time as the break, with half the hard work at first. After a longer break, restart from easy running and VO2's floor. Guidance ([Outside](https://www.outsideonline.com/health/running/training-advice/running-101/short-break-training?scope=anon), [Laura Norris](https://lauranorrisrunning.com/how-to-start-running-again-after-time-off/)).
- Illness: fever, chest symptoms, or feeling unwell all over mean rest. When the athlete reports pain that changes their stride, or pain that worsens during a run, write easy running only and suggest they see a professional.

### Supporting races

No study covers this; it is coach convention, after Runna's supporting races. VO2 sizes each week's budget around the race; the effort says how the rest of the week is written.

- **Run for fun:** easy pace. It is one of the week's runs, an easy one: write one run fewer, and keep the week's quality sessions. It is not a quality session for rule 4.
- **Strong and steady (70–80 %):** every other run that week is easy. VO2 trims race week to 85 % and makes the week after lighter.
- **Go all out:** VO2 gives it the main race's taper and a recovery week after, but no build of its own. Write those weeks as you would for the main race.
- **Main goal:** the taper above. VO2 adds the race to its week.

No race replaces a quality session by default. Every race but one run for fun counts as a quality session for rule 4.

### Writing for the athlete

- Each session has a short "why": what it trains, in one sentence, in plain words.
- Use the athlete's training paces (_Training paces_). Never invent a pace.
- Prefer effort to pace on hills, trails, in heat, and for athletes without recent running history.

## Training paces

VO2 gives you the athlete's training paces: five pace ranges in seconds per km, read from their current fitness. Target every running step with one of them, or with an effort. Never compute or invent a pace yourself.

### Where the paces come from

- VO2 estimates fitness as a VDOT (Daniels and Gilbert's running model, as printed by the [Daniels calculator](https://rundida.com/tools/vdot-calculator/)) from the athlete's recent road-run best efforts. A best effort inside a training run is slower than a race, so the estimate errs slow. It changes gradually: older runs count a little less each week, and one run can lift it at most 5 % above the next-best run.
- A race result the athlete set in the last 16 weeks wins over the estimate.
- The predicted race time for a goal comes from the same VDOT. Goals have no target time; the predicted race time takes its place. Do not write sessions at a goal pace faster than the athlete's training paces: paces rise with fitness, and VO2 updates them.

### The five paces

| Pace       | Letter | Share of VDOT                   | Feels like                                   | Used for                                                                            |
| ---------- | ------ | ------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| Easy       | E      | 62–70 %                         | Conversational                               | Easy and recovery runs, long runs, warm-ups, cool-downs, recoveries between repeats |
| Marathon   | M      | Predicted marathon pace ± 1.5 % | Steady, controlled                           | Blocks inside long runs; race-pace work for the half and full marathon              |
| Threshold  | T      | 85–88 %                         | Comfortably hard, about one-hour race effort | Tempo runs, cruise intervals                                                        |
| Interval   | I      | 95–100 %                        | Hard, about 3–5 km race effort               | Repeats of 3–5 minutes                                                              |
| Repetition | R      | 105–110 %                       | Fast and relaxed, not a sprint               | Repeats of 200–400 m, at most 2 minutes                                             |

Daniels' FAQ gives threshold 83–88 %, interval 95–100 %, and repetition 105–110 %. VO2 uses the top of the threshold band so it doesn't overlap marathon pace; 88 % gives Daniels' own threshold pace (4:15/km at VDOT 50). VO2's easy band is narrower than the FAQ's 59–74 %, set so VDOT 50 gives about 5:07–5:38/km, close to Daniels' tables. These bands are guidance: no source validates a range width. By default VO2 reads the athlete's easy pace from the pace they hold in heart-rate zone 2 instead, so it can sit outside this band.

Race paces against the five (checked at VDOT 50: 5 km 3:59/km, 10 km 4:08/km, half marathon 4:20/km):

- 5 km race pace is the slow end of I pace.
- 10 km race pace sits between T and I pace.
- Half marathon pace is the slow end of T pace.

When a session needs a race pace, write it as an effort ("10 km effort") with the pace type it sits at or between.

### How much at each pace

Per session, counting only the work at that pace (Daniels, via [Coach Ray](https://www.coachray.nz/2023/05/03/jack-daniels-running-intensity/)). Treat these as firm: they size every quality session (_Session library_).

| Pace | Most in one session                  | At 20 km a week | At 40 km | At 60 km |
| ---- | ------------------------------------ | --------------- | -------- | -------- |
| M    | 20 % of the week, and 1 h 50 at most | 4 km            | 8 km     | 12 km    |
| T    | 10 % of the week                     | 2 km            | 4 km     | 6 km     |
| I    | 8 % of the week                      | 1.6 km          | 3.2 km   | 4.8 km   |
| R    | 5 % of the week                      | 1 km            | 2 km     | 3 km     |

- T: an athlete who can run 20 minutes at T pace can run about 30 minutes as cruise intervals, still within the cap.
- I: each repeat 3–5 minutes; recovery 2–3 minutes of jogging, or about equal to the work.
- R: each repeat at most 2 minutes; recovery 2–3 times the repeat's time, or jog the same distance.

Keep repeats even: within a few seconds per km of each other. Repeats that get faster through the set mean the pace was too easy or the athlete was racing it.

### Pace or effort

Pace is precise on flat, steady, cool ground and fails elsewhere. Prefer effort when:

- **Easy and recovery runs:** give E pace as a ceiling, but tell the athlete to run by feel. Fatigue and weather move easy pace more than any other.
- **Hills and trails:** effort, with pace only as a check. Uphill repeats are always effort.
- **Heat:** warn that every pace slows on hot days; top marathoners ran 1.7–4.5 % slower as it warmed (Ely 2007, via [Outside](https://www.outsideonline.com/health/running/training-advice/science/how-much-should-you-slow-when-running-in-the-heat/?scope=anon)). Hold the effort, not the pace.
- **No running paces:** when VO2 has no training paces for the athlete, write every step as an effort: easy (can talk in full sentences), steady (short sentences), comfortably hard (a few words), hard (a word or two), fast and relaxed (short repeats only).
- **Strides and hill sprints:** effort only.

### Writing a target

Write a pace target as the pace type and its range from the athlete's training paces, for example `T 4:15–4:22 /km`. Write an effort target as one of the five efforts above. Do not mix both on one step.

## Session library

Sessions to build the coach plan from. Pick a session type for each run, then size it from the week's distance budget, the goal distance, and the phase. Every session must also pass the rules in _Load and weekly structure_.

Sources: numbers marked **(Daniels)** are via [Coach Ray](https://www.coachray.nz/2023/05/03/jack-daniels-running-intensity/); **(ctyeh)** via the [ctyeh interval guide](https://ctyeh.com/articles/728?lang=en), a secondary summary; **(McMillan)** via [McMillan Running](https://www.mcmillanrunning.com/?p=181). Everything else is coaching convention: guidance, not rule.

### Step format

Write every session as a list of steps, in order:

```
Warm-up: <amount> <target>
<amount> <target>
<repeats> × <amount> <target>, <recovery>
Cool-down: <amount> <target>
```

- **Amount:** a distance (`400 m`, `2 km`) or a time (`20 min`, `30 s`). Use distance on flat road; time for easy running, hills, and trails.
- **Target:** a pace type with its range from the athlete's training paces (`I 3:50–4:00 /km`), or an effort (`easy`, `steady`, `comfortably hard`, `hard`, `fast and relaxed`). See _Training paces_.
- **Recovery:** between repeats, an amount and how: `300 m jog`, `90 s walk`, `2 min standing`. Jog recoveries are at easy effort or slower.
- **Warm-up and cool-down:** every quality session has both, at easy. Warm-up 10–20 min or 2–3 km; cool-down 10 min or 1–2 km.
- A session's distance includes warm-up, cool-down, and recoveries. VO2 counts it toward the week.

Example:

```
Warm-up: 2 km E
6 × 300 m R, 300 m jog
Cool-down: 1.5 km E
```

### Sizing a quality session

The work at each pace in one session is capped by the week's distance (Daniels; table in _Training paces_): M 20 % (and 1 h 50 at most), T 10 %, I 8 %, R 5 %. Count only the work at that pace, not the warm-up, cool-down, or recoveries.

1. Take the week's budget from VO2.
2. Multiply by the cap for the session's pace. That is the most work at that pace.
3. Pick the repeats and their length so the work fits under it. When in doubt, take a repeat off.

Race-pace work counts against the cap of the pace at or just above it: 5 km and 10 km effort against I, half marathon effort against T, marathon effort against M. Hard fartlek minutes count against I, about 250 m a minute.

The sizes below are given at weekly budgets of 20, 40, 60, and 80 km. Pick the row at or below the athlete's week. Under about 25 km a week, prefer fartlek and strides to I and R sessions: the caps leave too little for proper repeats.

### Levels

Read the level from the athlete's recent weekly distance and runs per week (guidance). The level sets recoveries and how much pace to ask for; the week's budget sets the size.

- **Beginner:** under about 20 km a week, or new to structured running. One quality session a week; longer recoveries; effort over pace.
- **Intermediate:** about 20–50 km a week. One or two quality sessions.
- **Advanced:** over about 50 km a week, or years of structured training. Two quality sessions, shorter recoveries.

### Which quality sessions for which goal

Guidance from the sources above. The long run's peak is the smallest of the target below, its share of the week (rule 5 in _Load and weekly structure_), and 2 h 30.

| Goal          | Main quality                      | Second quality                    | Long run target |
| ------------- | --------------------------------- | --------------------------------- | --------------- |
| 5 km          | Intervals (I), repetitions (R)    | Threshold (T)                     | 60–75 min       |
| 10 km         | Intervals (I), threshold (T)      | 10 km race pace                   | 75–90 min       |
| Half marathon | Threshold (T)                     | Marathon pace (M), half race pace | about 2 h       |
| Marathon      | Marathon pace (M) in the long run | Threshold (T)                     | 2 h 30          |

In base phase, every goal uses easy running, strides, short hills, and at most one threshold session a week.

### Easy run

Aerobic base and volume; most of the week. No pace below E.

```
40 min easy
```

```
8 km E
6 × 20 s fast and relaxed, 60 s walk
```

- Run-walk, for beginners and returns from a break. Grow the running part over the weeks, then drop the walks:

```
8 × (3 min easy, 1 min walk)
```

### Recovery run

For weeks with many runs, as the light one. Shorter and slower than an easy run.

```
30 min easy, slower than E
```

Keep under 40 min. No strides.

### Long run

Endurance. Easy unless the phase calls for marathon-pace work. The longest run of the week, and at most twice the average of the others (rule 5).

Easy, at a 40 km week (12 km at most):

```
1 h 10 min easy
```

Fast finish, at a 60 km week (18 km at most):

```
14 km E
last 3 km steady
```

Marathon pace, at a 70 km week (21 km at most; M 14 km at most):

```
Warm-up: 4 km E
10 km M
Cool-down: 4 km E
```

Steady blocks, at a 50 km week (build phase, half and marathon goals):

```
3 km E
3 × (3 km E, 2 km steady)
```

Progression, at a 40 km week:

```
6 km E
3 km steady
2 km M
```

- Marathon-pace long run (build and peak, half and marathon goals only): a middle block at M, at most 20 % of the week and 1 h 50 (Daniels). Counts as a quality session.
- Fast finish: the last 15–20 % steady, never faster than M. Counts as quality only when the finish is at M or faster.
- Steady blocks: easy running with blocks at a steady effort, slower than M. Not a quality session. A way to make a long run harder without race-pace work.
- Progression long run: starts easy and steps up in blocks. Counts as quality only when it reaches M.

### Threshold: tempo run

Raises the pace the athlete can hold for about an hour. Write the T work as a distance so it can be checked against the cap.

```
Warm-up: 2 km E
4 km T
Cool-down: 1.5 km E
```

| Week  | T work | Example                                     |
| ----- | ------ | ------------------------------------------- |
| 20 km | 2 km   | 2 × 1 km T, 2 min jog                       |
| 40 km | 4 km   | 4 km T continuous (about 20 min)            |
| 60 km | 6 km   | 2 × 3 km T, 2 min jog                       |
| 80 km | 8 km   | 6 km T continuous, or 2 × 4 km T, 2 min jog |

- Beginners split the work into repeats with 2 min jogs; advanced athletes run it continuous.

### Threshold: cruise intervals

Threshold work in pieces with short jogs.

```
Warm-up: 2 km E
4 × 1 km T, 1 min jog
Cool-down: 1.5 km E
```

| Week  | T work | Example                |
| ----- | ------ | ---------------------- |
| 20 km | 2 km   | 2 × 1 km T, 90 s jog   |
| 40 km | 4 km   | 4 × 1 km T, 60 s jog   |
| 60 km | 6 km   | 6 × 1 km T, 60 s jog   |
| 80 km | 8 km   | 5 × 1600 m T, 60 s jog |

- Daniels: an athlete who handles 20 min at T can do about 30 min as cruise intervals, still within the cap.

### Threshold: over-unders

Threshold work that crosses the line: alternate just above and just below T. Written as `tempo`; the work above and below both count against the T cap. For intermediate and advanced athletes.

```
Warm-up: 2 km E
3 × (3 × (1 min slightly faster than T, 1 min slightly slower than T)), 2 min jog
Cool-down: 1.5 km E
```

- At a 40 km week: 3 sets of 6 min, as above (about 4 km of T work). At 60 km: 4 sets.

### Intervals (I)

Raises the athlete's ceiling: VO2max. Each repeat 3–5 min; recovery 2–3 min jog, or about equal to the work (Daniels, ctyeh).

```
Warm-up: 2 km E
4 × 800 m I, 400 m jog
Cool-down: 1.5 km E
```

| Week  | I work | Example                                   |
| ----- | ------ | ----------------------------------------- |
| 20 km | 1.6 km | Prefer fartlek; or 2 × 800 m I, 400 m jog |
| 40 km | 3.2 km | 4 × 800 m I, 400 m jog                    |
| 60 km | 4.8 km | 4 × 1200 m I, 3 min jog                   |
| 80 km | 6.4 km | 6 × 1000 m I, 2–3 min jog                 |

- Rare for marathon goals beyond one block in build.
- Pyramid: up then down in length, same pace, recovery about equal to the work. At a 40 km week (I cap 3.2 km):

```
Warm-up: 2 km E
400 m I, 800 m I, 1200 m I, 800 m I, all with 400 m jog
Cool-down: 1.5 km E
```

- Beginners may walk the recoveries: `90 s walk` instead of a jog.

### Repetitions (R)

Speed and economy with full recovery. Each repeat at most 2 min; recovery 2–3 times the repeat's time, or jog the same distance (Daniels).

```
Warm-up: 2 km E
5 × 400 m R, 400 m jog
Cool-down: 1.5 km E
```

| Week  | R work | Example                 |
| ----- | ------ | ----------------------- |
| 20 km | 1 km   | 5 × 200 m R, 200 m jog  |
| 40 km | 2 km   | 5 × 400 m R, 400 m jog  |
| 60 km | 3 km   | 10 × 300 m R, 300 m jog |
| 80 km | 4 km   | 10 × 400 m R, 400 m jog |

- Mainly for 5 km and 10 km goals.

### Race pace

Rehearses the goal race, in build and peak phases only. Write the pace as an effort with the pace type it sits at or between (_Training paces_), and size it against the cap in "Sizing a quality session".

5 km, at a 60 km week (I cap 4.8 km):

```
Warm-up: 2 km E
4 × 1 km 5 km effort (slow end of I), 2 min jog
Cool-down: 1.5 km E
```

10 km, at a 60 km week (I cap 4.8 km):

```
Warm-up: 2 km E
2 × 2 km 10 km effort (T–I), 2 min jog
Cool-down: 2 km E
```

Half marathon, at a 60 km week (T cap 6 km):

```
Warm-up: 3 km E
2 × 3 km half marathon effort (slow end of T), 3 min jog
Cool-down: 2 km E
```

Marathon, at a 60 km week (M 12 km at most):

```
Warm-up: 2 km E
2 × 5 km M, 2 min jog
Cool-down: 2 km E
```

- At a smaller week, take repeats off or shorten them; at 20 km a week, race-pace work is a few minutes inside a fartlek.

### Fartlek

Variety and pace changes, by effort. Good for beginners' first quality sessions, small weeks, and base phase. Hard minutes count against the I cap, about 250 m a minute.

```
Warm-up: 10 min easy
6 × 1 min hard, 2 min easy
Cool-down: 10 min easy
```

- 20 km week: 6 × 1 min hard. 40 km: 10 × 1 min or 6 × 2 min. 60 km and up: 6 × 3 min, 2 min easy.
- Counts as a quality session.

### Hills

Effort only; never a pace target.

Short hill sprints (power, base phase):

```
Warm-up: 15 min easy
8 × 10 s hard uphill, walk back down
Cool-down: 10 min easy
```

Long hills (strength, build phase, hilly goals):

```
Warm-up: 15 min easy
6 × 60 s hard uphill, jog back down
Cool-down: 10 min easy
```

- Beginner: 6 × 10 s, or 4–6 × 45 s. Advanced: 10 × 10 s, or 5 × 2 min at 10 km effort. Long hills count against the I cap like fartlek.
- Hill sprints after an easy run don't make it a hard day; long hills do.
- Only when the athlete has a hill; otherwise use strides or fartlek.

### Progression run

Practises pacing, finishing faster. A quality session when it ends at T or M. At a 40 km week:

```
Warm-up: 1 km E
3 km E
3 km M
2 km T
Cool-down: 1 km E
```

- Beginner: easy to steady only, not a quality session.

### Taper and lighter weeks

- Keep the same session types, sized from the lighter week's own budget: the caps shrink with it.
- Race week: one short session, such as 4 × 200 m R or 2 × 1 km at race effort, with full recovery, still within that week's caps. The rest easy and short.
- The last run before the race: a short easy shakeout with a few strides, written as `easy`:

```
20 min easy
4 × 15 s fast and relaxed, 60 s walk
```

- Never a new kind of session in a taper.
