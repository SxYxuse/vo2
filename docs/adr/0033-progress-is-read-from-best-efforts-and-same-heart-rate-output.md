# Fitness measures load; progress is read from best efforts and output at the same heart rate

Fitness (CTL) is how much training the athlete has absorbed, not how good they are. It rises in build blocks, dips in recovery weeks, and can even fall while the athlete improves, because a higher estimated FTP scores the same ride lower. So the fitness page no longer tells the athlete to make the line rise. It reads a training phase instead (building, ramping fast, consolidating, recovering, fresh, taking a break, deep fatigue) from the last week's ramp, the four-week trend, and form.

Whether training pays off is answered beside the graph, in two ways:

- **Capacity: best efforts.** The best average power over 1, 5, 20, and 60 minutes on rides with a power meter, and the fastest 1 km, 5 km, 10 km, and half marathon inside road runs. These are computed from streams once per activity and cached on `activity_streams.best_efforts`, cleared like the other derived caches.
- **Cost: output at the same heart rate.** The median output per heartbeat on aerobic sessions (the efficiency factor), read at one heart rate both blocks rode or ran near.

Both compare the last six weeks with the six weeks before, about the time fitness takes to settle; best efforts also show the best of the last twelve months. The blocks are fixed, not the chart's period, so "now against before" means the same thing every time.

Only power-meter rides and runs (sport type Run) are compared. Ride speed depends on wind and terrain, trail and treadmill pace is not comparable, and swims, walks, and other sports have no output VO2 can track from month to month. Hidden sport types stay out (ADR 0018).

The trade-offs: a best only moves when the athlete goes hard, so an easy block shows no record and the page says that is not a loss. Output at the same heart rate also moves with heat, sleep, and fatigue, so it is a trend over weeks, not a verdict on one session.
