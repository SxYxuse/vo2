# The coach plan plans swims in metres, at zones from CSS

Supersedes, in part, [0050](0050-the-coach-plan-plans-runs-and-rides-and-the-week-planner-is-removed.md) (the coach plan plans runs and rides, and swims are the athlete's own) and extends [0054](0054-each-sports-coaching-knowledge-is-one-file-and-one-skill.md) with a swimming file and skill.

**Swims are a plan sport.** Availability gains swims a week, 0 to 6, beside runs and rides; availability saved before has none. An A swim with a distance can lead the plan, and a triathlon (one A goal per leg on the same day) builds every leg's sport. Of a multisport event's legs, the longest by time (a triathlon's ride) is the plan's A goal, so its taper is the event's. Quality sessions stay at three a week across every sport.

**Budgeted in metres.** A pool's lengths are exact and swim plans count metres, so swims are budgeted like runs, by distance, not like rides. The week grows at most 10 % over the biggest of the last four weeks, or 500 m for a small one; the floor is 60 % of the usual week after a break, or 1,500 m a swim without history. No swim is more than 15 % longer than the longest of the last 30 days (2,000 m without one): swimming carries no impact, so it may grow like rides. The long swim keeps the long ride's shares (40 %, 50 % with three swims, 60 % with two) and lasts at most 2 hours. A main goal swim tapers two weeks, 70 % then 50 %, inside the 41–60 % cut Bosquet 2007 found best. Progression and the peak work as in [0058](0058-each-sports-budget-grows-at-a-progression-the-athlete-sets-up-to-a-peak-ceiling.md), with G = 1.3 (guidance: no source sets it for swimmers) and race floors and maxes from published age-group plans: up to 1.7 km 4,000–12,000 m, 1.9 km 5,000–12,000, 3.8 km 7,000–15,000, and 5 km and more 10,000–20,000.

**Steps and zones.** A swim step is a distance at a swim zone or an effort, or rest at the wall: a recovery step by time that adds time but no metres. Swim zones reuse the ride zones' ids (recovery, endurance, tempo, threshold, VO2 max, sprint) so a step keeps one `zone` field; each is an offset from CSS, the critical swim speed, in seconds per 100 m (Swim Smooth's CSS zones, Dekerle 2005). VO2 stores each step's pace per 100 m, as it stores a ride step's watts, and the coach never writes a pace. New swim kinds: technique and open water, neither quality. Drills are named in the title and the why: steps carry no text.

**CSS from the swims.** VO2 has no swim test (ADR 0011). CSS is (t400 − t200) / 2 from the fastest 200 m and 400 m in swims of the last six months, rest at the wall included. When the two don't fit together, or one is missing, the best pace over 1,000 m or more stands in, which errs easy. Without either, swims go by effort and their time is estimated at 2:05 /100m. A CSS that moved 3 s per 100 m writes the plan again.

**Knowledge.** `src/coaching/swimming.md` holds the rules, zones, sessions, open water, and shoulder load, researched from published sources; `season.md` now covers runs, rides, and swims, and triathlon training. Plan writing loads it when swims are planned, and the chat loads it as the `swimming` skill.

Triathletes asked for every leg in one plan. Planning swims inside the same budgets and rules keeps each sport grounded in what the athlete already does in it, and adds no new planning model: a third sport with its own unit.

## Considered options

- **Swims budgeted by time, like rides:** time is what a triathlete's week is split by, but a swim's distance doesn't hang on terrain or wind, and every swim plan and pool clock counts metres.
- **A swim pace field on steps:** a closer match to how swimmers write sets, but a second target field every structured-output model must leave null for runs and rides; zones from CSS give the same pace and keep one format.
- **Yards:** pools in the United States are often 25 yards; VO2 shows metric distances everywhere else, so swims stay in metres.
- **Swim heart-rate zones as the anchor:** VO2 has swimming LTHR, but heart rate is hard to read in the water and runs lower than on land, so it steers swims poorly.
