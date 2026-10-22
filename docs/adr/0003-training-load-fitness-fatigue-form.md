# Training load from power, then heart rate, then duration; form from fitness minus fatigue

The duration fallback now comes after heart rate borrowed from similar activities: see [0019](0019-missing-heart-rate-is-borrowed-from-similar-activities.md).

Each activity gets one training-load number. Cycling with a power meter uses Coggan TSS against FTP (normalized power, never average watts, and never e-bike motors). Otherwise heart rate against that sport's LTHR (or max HR for walking and mixed sports), using the athlete's resting HR. Otherwise a duration guess from sport type.

Fitness and fatigue are the Coggan/TrainingPeaks PMC exponential averages: 42-day CTL and 7-day ATL. Form is morning TSB: yesterday's fitness minus yesterday's fatigue. That is a PMC chart, not Banister's 1975 impulse-response model (Banister uses ~50/15 day time constants and separate gain factors k1, k2).

Anchors are sport-specific estimates from recent activities. Cycling LTHR is never copied onto a run.

Strava's own relative effort and "suffer score" stay out of this. Those numbers are opaque, not comparable across sports the way we need, and not something a remaining-week plan can target.

The trade-off is that duration-only days are approximate, and FTP/LTHR must be good enough or load is biased. That is preferred to a black-box score we cannot plan against.
