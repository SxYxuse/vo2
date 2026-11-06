# Swim drills are steps

Supersedes, in part, [0061](0061-the-coach-plan-plans-swims-in-metres-at-zones-from-css.md) (drills are named in the title and the why: steps carry no text).

A technique swim titled "Technique: catch-up and fist" whose steps read "100 m recovery, 200 m recovery, 20 s rest" loses which drill to swim, and when. **A step may now name a drill**: a nullable `drill` field, one of a fixed list. A drill step is a swim step with a distance, at effort easy or the recovery zone, and the rule checker reports a drill on a run or ride step, on rest at the wall, or at a harder effort. The title may still name the session's focus.

The swim drills are catch-up, single arm, 6-kick switch, fist, sculling, kick on the side, kick with a board, and pull with a buoy. Each has a label, a sentence or two on how to swim it, and its kit, and the session screen lists the drills a session uses with that "how", so the athlete needn't know them already. Drill steps are striped in the session's shape. A drill is swum by feel, so VO2 gives it no pace per 100 m; it still counts toward the swim's metres and time at its zone.

The list is one table with a sport per drill. Run drills (A-skips, strides) can join it later under their own sport without reshaping steps; the checker keeps each drill to its sport. A technique swim with 50 m drills is about 800 m; in a small swim week, drills are 25 m repeats.

## Considered options

- **Free text on steps:** says anything, but the app can't explain a drill it can't name, a structured-output model may fill it on every step, and text the coach writes is unchecked.
- **One drill field per sport:** a second nullable field every model must leave null for every other sport; one field with a sport per drill does the same.
- **Drills as a session kind's detail, not on steps:** keeps steps as they are, but loses where in the session each drill goes.
