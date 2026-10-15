# Training load from power, then heart rate, then duration; form from fitness minus fatigue

Each activity gets one training-load number. Cycling with a power meter uses power against FTP. Otherwise heart rate against LTHR. Otherwise a duration guess from sport type. Fitness is the ~42-day exponentially weighted load; fatigue is the ~7-day; form is fitness minus fatigue.

Strava's own relative effort and "suffer score" stay out of this. Those numbers are opaque, not comparable across sports the way we need, and not something a remaining-week plan can target. A Coggan-style load plus a Banister/PMC chart is something we can recompute from copied streams and explain as Fitness, Fatigue, and Form.

The trade-off is that duration-only days are approximate, and FTP/LTHR must be good enough or load is biased. That is preferred to a black-box score we cannot plan against.
