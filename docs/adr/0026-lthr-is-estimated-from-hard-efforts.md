# LTHR is estimated from hard sustained efforts, with the share of max as fallback

Estimated LTHR for cycling, running, and swimming now comes from the athlete's own heart-rate streams. Each activity of 20 minutes or more from the last 6 months gives one effort: the best hour's average heart rate, or 95 % of the best 20 minutes (Friel's 20-minute test), whichever is higher. Samples above that sport's max heart rate are dropped as spikes before averaging. Efforts below the usual share of max minus 5 % of max (83 / 88 / 85 % for cycling, running, and swimming) are not hard enough and don't count. Once at least two efforts count, LTHR is the median of the best three, capped at the usual share plus 5 % of max. With fewer than two, LTHR stays the usual share of max, as before.

A fixed share of max is off by several bpm for many athletes, since real LTHR spreads about ±4 % of max, and every LTHR zone and every heart-rate training load moves with it. Requiring two efforts and taking a median keeps one cadence lock, hot day, or strap glitch from setting the threshold. Only efforts near the expected threshold count, so long easy days can't drag it down. The 6-month window is shorter than max HR's 18 months because threshold follows fitness.

The estimate is computed when training load is refreshed (after a sync or a settings change) and stored with the other anchors. A set LTHR still wins (ADR 0021). A stored estimate at or above a newly set max is ignored until the next refresh. The athlete still sees only "estimated" or "set by you".

The trade-off is that an athlete who never goes hard for 20 minutes keeps the share of max, and one whose true threshold is outside the ±5 % band is capped at its top or ignored below its bottom.
