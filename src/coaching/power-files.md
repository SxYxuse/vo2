# Reading a power file

A power file is a ride's FIT file the athlete imported on the Power page (ADR 0056). With dual-sided pedals (Favero Assioma, Garmin Rally or Vector, Look Keo Power) it holds what Strava drops: each leg's share of the power, where on the pedal the force goes, the arc of each stroke, seated and standing, and electronic shifting. `get_power_file` returns VO2's analysis of it.

## How to judge any number

- **Compare the athlete with themselves.** Use the same metric at a similar power and cadence: the `byZone` rows within a ride, seated against standing, and the same ride type across files (`find_power_files`). Published "normal" ranges come from manufacturers, coaches, and riders, not population studies. Say so when you lean on one.
- **Pedaling numbers move with power, cadence, position, terrain, and fatigue.** A difference between an easy hour and a threshold climb is expected. Compare like with like.
- **One ride is a hint, not a diagnosis.** It's worth acting on only when it holds in every zone and over several rides, changes suddenly against the athlete's usual, or comes with pain or numbness.
- **Check the data before reading it.** A short ride, little pedaling time with dynamics (`recording.dynamicsPct`), a one-sided meter (no balance), or many seconds without power weakens every conclusion. A meter that wasn't zeroed (calibrated) before the ride shifts balance and power. Ask about it before blaming a leg.
- **Never diagnose an injury.** Pain, a large lasting asymmetry, or a change after a crash goes to a bike fitter or a physio. Say so plainly.
- **Changes go one at a time and small.** That means 1–2 mm on a cleat, or a few millimetres on the saddle. Comfort and knee tracking come first. After a change, ride the same kind of ride at the same power for a week or two before judging it.

## Left/right balance

`rightPct` is the right leg's share of total power; the left's is 100 − right. VO2 writes it as L 52 / R 48.

- Within 48/52 either way is common, especially at easy power. Balance usually moves toward 50/50 as power rises ([Cycling Weekly coach](https://www.cyclingweekly.com/fitness/ask-a-cycling-coach-should-i-be-worried-about-a-leftright-power-imbalance-when-cycling)). Read it by zone: an imbalance at recovery power that fades by threshold is normal.
- Worth a look: about 5 points or more (55/45) in every zone, or a drift from the athlete's own usual over several rides.
- Check these before training it: calibration and pedal installation, then leg-length difference, cleat position, saddle height, an old injury, or simply a dominant leg.
- Don't prescribe drills to reach 50/50. There is little evidence that evening a small imbalance makes a rider faster. Single-leg drills are fine for coordination.

## Platform center offset (PCO)

PCO is the distance in mm from the pedal's centre to where the force goes. Positive means toward the outside of the pedal (away from the bike); negative means toward the inside, near the crank ([Garmin Cycling Dynamics](https://www8.garmin.com/manuals/webhelp/GUID-E17670DF-416F-455E-8444-29845F375EBD/EN-US/GUID-9519F9B3-0FAC-4B18-B122-48F61CF5831B.html)).

- No validated target exists, and zero isn't automatically right for every foot. A few mm either side of zero needs nothing.
- Worth a look:
  - the two feet sit several mm apart;
  - one foot moves outward as power rises or out of the saddle (`byZone`, `standing`);
  - PCO changed suddenly against earlier files;
  - the outer edge of the foot hurts or goes numb.
- What to change, in small steps with a fitter if possible:
  - **Cleat side-to-side.** Moving the cleat toward the outside edge of the shoe brings the foot inward on the pedal and lowers PCO. Moving it toward the inside edge raises PCO.
  - **Stance width.** Pedal washers or a longer axle widen the stance; the opposite narrows it.
  - **Foot tilt.** A foot that rolls outward under load loads the outside of the pedal. Varus wedges or a supportive footbed address that, not the cleat.

## Power phase and peak power phase

Angles are degrees around the crank: 0° with the pedal at the top, 90° pedal forward (3 o'clock), 180° at the bottom, counting in the direction the pedal travels.

- **Power phase** runs from where the leg starts driving the crank to where it stops; the arc is its length.
- **Peak power phase** is the narrower arc where most of the force goes.
- Rough shape from riders' data: the drive starts near the top, around 340°–20°, and ends past the bottom, around 190°–250°. The peak arc sits roughly between 45° and 150°, centred near 3 o'clock. Arcs grow with power and when standing. These figures are rough, so compare by zone and between legs before comparing with them.
- Useful readings:
  - one leg starting later or ending earlier than the other at the same power;
  - a peak arc shifted late (after 3 o'clock), which often comes with a high or far-back saddle;
  - an arc that shrinks as the ride goes on, which suggests fatigue.
- Don't train a "rounder" stroke for its own sake. Pulling up raises how effective the force looks but lowers gross efficiency (Korff et al., 2007, _Medicine & Science in Sports & Exercise_). Saddle height and setback and cleat fore-aft are the levers, and they belong to a fit.

## Torque effectiveness and pedal smoothness

These appear only when the file has them.

- **Torque effectiveness** is the share of each stroke's torque that drives the crank forward rather than pushing against it on the way up. Garmin calls 60–100 % typical, and it rises with power ([Garmin](https://www.garmin.com/en-US/blog/fitness/power-ride-vector-pedals/)).
- **Pedal smoothness** is average power over the revolution divided by peak power. Garmin calls 10–40 % common; no one reaches 100 %.
- Neither is a target: higher doesn't mean more efficient. Use them to compare legs at the same power.

## Seated and standing

- `standCount` is how many times the athlete left the saddle; `standing` is the time, power, cadence, balance, PCO, and arc out of the saddle.
- Standing on climbs and to restart is normal and gives other muscles a turn. It raises power and lowers cadence.
- Long or frequent standing on flat ground can mean the saddle or position is uncomfortable. Ask before assuming.
- A leg that dominates only when standing, or a PCO that swings outward out of the saddle, is the useful comparison.

## Cadence, torque, and quadrants

- `cadence.avg` is pedaling cadence, without coasting. Most trained riders choose 80–100 rpm on the flat and lower on steep climbs. No single cadence is best, and preferred cadence rises with power.
- Change cadence gradually, 5 rpm at a time, and only for a reason: knees that ache when grinding, legs that fade on long climbs, or an event that demands it.
- **Quadrants** split pedaling time by force and speed. The lines are the ride's own average cadence and the torque that would make FTP at that cadence:
  - I: high force, fast (sprints, hard surges)
  - II: high force, slow (steep climbs, big gears, strength)
  - III: low force, slow (easy riding, recovery)
  - IV: low force, fast (spinning, fast group riding on the flat)
- Compare the ride's split with what the athlete's goal events demand (`get_season`). A hilly goal needs time in II; a criterium needs I and IV.

## Heart and effort

- **Aerobic decoupling** is heart-rate drift against power from the first half to the second, on steady rides only (VO2 skips unsteady or hilly ones).
  - Under 5 %: the aerobic base covers this duration.
  - 5–10 %: common when the ride is long, hot, or underfuelled.
  - Over 10 %: the ride was longer or harder than current aerobic endurance.
- **Efficiency factor** is normalized power over average heart rate. Compare it only between similar rides over weeks: it rises with aerobic fitness. It can't be compared between athletes.
- **Variability index** is normalized over average power. Around 1.05 or lower is steady, as in a time trial or endurance ride; over 1.10 is variable, as in a group ride, criterium, or hilly route. An endurance ride meant to be steady should stay low.
- **Intensity factor** is normalized power over FTP. Endurance rides sit around 0.60–0.75, and an hour at threshold is about 1.0.
- `trainingLoad` is VO2's training load for the ride. The ride already counts once, through Strava.

## Power curve and zones

- `curve` is the best average power for each duration on this ride only. Compare it with `get_personal_bests` to tell a strong day from an ordinary one; W/kg uses the athlete's weight.
- Zones, intensity factor, and quadrants all come from FTP. `anchors.ftp.source` says whether it is VO2's or the one the head unit stored. When FTP looks wrong, every zone is wrong: say so and point to Settings. A sign is a best 20 minutes × 0.95 well above FTP.

## Gears

- `crossChainSec` is time on the big ring with the two biggest cogs, or the small ring with the two smallest. It wears the chain and adds a little friction. A few minutes is fine; much more means shifting the front sooner.
- `uses` lists time, power, cadence, and speed per gear. Many front shifts on rolling ground, or a favourite gear far from the middle of the cassette, can suggest a different chainring or cassette for the athlete's terrain.

## Answering

- Lead with the one to three things that matter most for this athlete and say whether each is normal for them.
- Then give at most one or two concrete changes, sized small, and say what to look at on the next ride to see if it worked: the same metric at the same power.
- Use their numbers, not the whole table, and skip what is normal unless they asked about it.
