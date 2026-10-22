# Missing heart rate is borrowed from similar nearby activities before falling back to duration

When an activity has neither usable power nor heart rate, it borrows heart-rate intensity (share of heart-rate reserve up to LTHR or max HR) from the athlete's most similar activities that recorded heart rate, and is scored like a measured session. The implied average HR is stored and shown on the activity as an estimate.

Three guardrails keep the estimate honest:

- **Same sport group, within two months either side.** Walks borrow from walks and rides from rides; mixed sports only from the same sport type. Heart rate at a given effort drifts with fitness, so only sessions near in time count. Among those, the closest in duration, speed, and date win.
- **At least three matches.** With fewer, one bad sensor day would set the estimate, so the flat duration guess from sport type applies instead.
- **Median of the five closest.** One session with a wrong reading cannot drag the estimate.

The window replaces asking the athlete since when their heart rate is reliable: few athletes know that date, and sessions near in time already reflect the same sensor and the same fitness. The cost is that a sensor that reads plausibly but wrongly for weeks is lent to its neighbours, exactly as wrong as it already scores those sessions.

Borrowed loads still count as estimated load in the fitness chart, so the athlete sees that those days are approximate. An estimate can shift after a sync, as new nearby activities arrive.

How the duration-only fallback in [0003](0003-training-load-fitness-fatigue-form.md) is reached is superseded here; the power-then-heart-rate order is unchanged.
