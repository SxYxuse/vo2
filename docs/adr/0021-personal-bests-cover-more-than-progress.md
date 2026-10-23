# Personal bests cover more than progress

Progress (ADR 0020) compares only power-meter rides and road runs, because it answers "am I getting better?" across two blocks of training, and wind, terrain, and pool length would make any other comparison misleading. The bests page answers a different question: what is the best you have done? A personal best is a fact about one effort, not a comparison between blocks, so it can cover more:

- **Rides by distance** (10 to 200 km) on outdoor rides without a motor: Ride, GravelRide, and MountainBikeRide. Virtual rides are left out because their speed and climbing are simulated, and e-bikes because the motor does part of the work. The power curve still reads every power-meter ride, virtual ones included, because trainer watts are real.
- **Swims by distance** (100 to 3800 m) on Swim and OpenWaterSwim. In a swim, rest at the wall keeps the clock running; on runs and rides a pause still stops it. Otherwise a 1500 m best could be stitched from 100 m repeats with the rests taken out.
- **Biggest days**: the longest activity, the most climbing, and the biggest single climb. Trail runs count here, even though their pace stays out of the run distances.

Every best is computed once per activity from its streams and cached on `activity_streams.best_efforts`, like the progress bests before it, so the page reads no Strava quota.

There is no way to dismiss a bad effort. Instead, a time faster than the world record for its distance (or a ride faster than 80 km/h, or power over 2,500 W) is a GPS or sensor error and is dropped. That needs no extra screen or reverse state, at the cost of keeping a glitch that stays just inside those limits.

"All time" means everything in the local copy. While older history is still being synced, a personal best can still change, and the page says so.
