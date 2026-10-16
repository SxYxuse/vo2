# Activity pace charts clip crawl to a slow floor and never tick 0:00

A Stream sample slower than 1.0 km/h is not averaged into Pace: it spikes to the slow axis floor so recoveries and stops stay connected, like a watch Allure chart. Remaining Pace is the rolling 60-second mean of moving speed, then converted to clock. The inverted axis uses round ticks from a padded fastest sample to one tick past the 95th percentile, so a normal trace stays on-scale — never 0:00 /km, never a 40:00 wander. Samples slower than that cap clip to the floor. Heart rate fits plausible bpm (40–230) instead of starting at 0; power, cadence, and cycling speed still start at 0.

A 0–100 overlay or a log pace axis would hide real units. Fitting every remaining sample would let one crawl own the scale. Treating the 5.5 km/h hike classifier as a stop would erase real walls.
