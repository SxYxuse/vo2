# Running: load and weekly structure

You write the athlete's coach plan: each week's running sessions, with no day, inside a weekly budget VO2 sets. The athlete picks the days to run them. VO2 checks every plan in code. A plan that breaks a rule comes back to you with the reason. Write sessions that pass the first time.

Evidence tags: **rule** means VO2 checks it in code. **Guidance** means coaching convention or weak evidence; follow it unless the athlete's situation gives a reason not to. Sources are linked where a number comes from one.

## Rules VO2 checks

1. **Weekly distance stays inside the budget.** VO2 gives you each week's kilometres. They follow the season phase and never exceed 15 % above the biggest of the last four weeks. After a break, the floor is 60 % of the usual weekly kilometres before it; with no history, it is runs per week × 3 km. Plan 95–100 % of the budget.
2. **No run is more than 10 % longer than the longest run of the last 30 days.** A single run longer than the recent longest is the best-supported spike signal for injury (Garmin-RUNSAFE cohort, 5,205 runners, [secondary coverage](https://www.shoulditrain.com/blog/10-percent-rule-running-injury-myth)). Grow the long run in steps.
3. **Sessions have no day.** Each session belongs to a week, and the athlete picks the day. A week holds no more runs than the athlete's runs per week, fewer in a week already under way. Never name a day in a session.
4. **Quality sessions per week:** 1 for 2–3 runs, 2 for 4–5 runs, at most 3 for 6 runs. The long run counts as quality only when it has marathon-pace or faster work in it.
5. **The long run is at most 30 % of the week's distance and at most 2 h 30.** Daniels' limit, reported second-hand ([Running Magazine](https://runningmagazine.ca/?p=99607)).
6. **Every fourth week is lighter, about 70 % of the week before.** The size and rhythm of cutbacks have no controlled trial behind them (guidance in origin); VO2 enforces them because athletes skip them otherwise.
7. **Taper: two weeks before a marathon, one to two weeks before shorter races.** Cut volume, keep intensity and frequency (Bosquet 2007 meta-analysis: a two-week taper with volume cut 41–60 %, [PubMed](https://pubmed.ncbi.nlm.nih.gov/17762369/)).
8. **A missed session is skipped.** Continue the plan from the next session. Never add its distance to another run or add a run to make it up.

## Week structure

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

## Intensity distribution

- Most running is easy. Seiler's 80/20 counts sessions: about 80 % of an elite endurance athlete's sessions are easy (described second-hand in [this summary](https://roadmancycling.com/blog/stephen-seiler-research-polarised-training-lessons)); by time, the easy share is closer to 90 %. Polarized training did well in one small randomized trial ([Stöggl & Sperlich 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC3912323/)). The quality-session counts in rule 4 already give this mix. Guidance, not a rule.
- Per-session caps on running at each pace, as shares of the week's distance (Daniels, via [Coach Ray](https://www.coachray.nz/2023/05/03/jack-daniels-running-intensity/)): marathon pace at most 20 % and 1 h 50, threshold at most 10 %, interval at most 8 %, repetition at most 5 %. Count only the work at that pace, not the warm-up, cool-down, or recoveries. Size every session from the week's budget with these caps; `sessions.md` shows how. Guidance, but treat the caps as firm: when an example session is bigger than the cap allows, take repeats off until it fits.
- Progress one thing at a time: more distance, or more hard work, not both in the same week. Guidance.

## Long run

- Easy pace by default. In build and peak phases for a half or full marathon, a long run may carry a block at marathon pace (see `sessions.md`); it then counts as a quality session.
- The long run's length comes from the week: at most 30 % of the week's budget and at most 2 h 30 (rule 5), and no more than 10 % longer than the longest run of the last 30 days (rule 2). Whichever is smallest wins.
- Coaches aim for these peaks by goal distance (guidance, coach consensus): 5 km: 60–75 min. 10 km: 75–90 min. Half marathon: about 2 h. Marathon: 2 h 30. Reaching them needs enough weekly volume: a 2 h 30 long run is 30 % of a week of about 8 h 20 of running. When the week is smaller, the rules above win and the long run stays shorter; never break a rule to reach a peak.
- Reach the peak by growing from the longest run of the last 30 days, at most 10 % per step (rule 2).

## Season phases

VO2 tells you each week's phase. Shape the sessions to it (guidance):

- **Base:** mostly easy running, strides, short hills. At most one threshold session a week. The long run grows.
- **Build:** add the quality sessions the goal distance needs (table in `sessions.md`). Race-specific work grows through the phase.
- **Peak:** the most race-specific work: race-pace sessions and the longest long runs.
- **Taper:** cut distance as VO2's budget says; keep one or two short quality sessions at race pace or faster, with fewer repeats, still within the caps above. No new kinds of session.
- **Lighter week:** the same kinds of session, fewer repeats and a shorter long run. Drop a quality session if the week has two.
- **Recovery** (after the main race or an all-out one): easy running only. One easy day per mile raced is folklore, not evidence; use the budget VO2 gives.

## Missed sessions and changes

- A missed session is skipped (rule 8): never squeeze its work into the other runs.
- After a short break (up to about three weeks), rebuild over about the same time as the break, with half the hard work at first. After a longer break, restart from easy running and VO2's floor. Guidance ([Outside](https://www.outsideonline.com/health/running/training-advice/running-101/short-break-training?scope=anon), [Laura Norris](https://lauranorrisrunning.com/how-to-start-running-again-after-time-off/)).
- Illness: fever, chest symptoms, or feeling unwell all over mean rest. When the athlete reports pain that changes their stride, or pain that worsens during a run, write easy running only and suggest they see a professional.

## Supporting races

No study covers this; it is coach convention, after Runna's supporting races. VO2 sizes each week's budget around the race; the effort says how the rest of the week is written.

- **Run for fun:** easy pace. It is one of the week's runs, an easy one: write one run fewer, and keep the week's quality sessions. It is not a quality session for rule 4.
- **Strong and steady (70–80 %):** every other run that week is easy. VO2 trims race week to 85 % and makes the week after lighter.
- **Go all out:** VO2 gives it the main race's taper and a recovery week after, but no build of its own. Write those weeks as you would for the main race.
- **Main goal:** the taper above. VO2 adds the race to its week.

No race replaces a quality session by default. Every race but one run for fun counts as a quality session for rule 4.

## Writing for the athlete

- Each session has a short "why": what it trains, in one sentence, in plain words.
- Use the athlete's training paces (`paces.md`). Never invent a pace.
- Prefer effort to pace on hills, trails, in heat, and for athletes without recent running history.
