# Missing heart rate is borrowed from similar activities before falling back to duration

When an activity has neither usable power nor heart rate, it borrows heart-rate intensity (share of heart-rate reserve up to LTHR or max HR) from the athlete's five most similar activities that recorded heart rate on or after 1 January 2026, and is scored like a measured session. Similar means close duration and date, the same sport type first, then the same sport group (where speed also counts), then any sport. Intensity rather than bpm is borrowed so every sport gets an estimate, even one the athlete never wore a strap for: a walk can learn from runs although its heart rate sits lower. The implied average HR is stored and shown on the activity as an estimate. Heart rate recorded before 2026 is never borrowed: the athlete does not trust it to reflect them now, so older strapless sessions also borrow from 2026 onward. Only when no activity from 2026 on has heart rate does the flat duration guess from sport type apply.

A forgotten strap on a hard interval run and on an easy jog used to score the same. The athlete's own history at that duration and speed is a much better guess than one intensity per sport, so fitness, fatigue, and form follow what was actually done.

Borrowed loads still count as estimated load in the fitness chart, so the athlete sees that those days are approximate. The trade-off is that the estimate moves as new activities arrive, so a past day's load can shift slightly after a sync.

How the duration-only fallback in [0003](0003-training-load-fitness-fatigue-form.md) is reached is superseded here; the power-then-heart-rate order is unchanged.
