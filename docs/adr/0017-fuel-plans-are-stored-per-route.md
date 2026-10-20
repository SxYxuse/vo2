# Fuel plans are stored per route, apart from the week target

The athlete uploads the GPX of a route they plan to do. VO2 predicts how it will go from their own activities and builds fuel plans from MNSTRY products: what to drink and eat, and roughly when. A route and its plans are stored on their own and never count toward the week target, the calendar, or training load; [0016](0016-week-target-replaces-the-week-bucket.md) removed stored planned sessions from the week and this does not bring them back.

The product catalog is a committed JSON snapshot that a developer refreshes with `vp run catalog:mnstry`. The app never fetches mnstry.com, so a plan does not depend on the store being up, and every change to a product shows as a diff. Values come only from what the store states: carbs from the per-serving column of its nutrition table, otherwise from its description; the glucose:fructose ratio, caffeine, and a drink mix's water volume from its own sentences. A value it does not state stays missing. Products without stated carbs, drink mixes without a stated water volume, and caffeine products without a stated dose are never planned. The athlete ticks the products they have, stored with their profile; plans, the coach model and swaps use only those, and a route can't be planned until they have chosen some. Dropping a product later turns the default proposals of each route that used it back on at the next update or prediction.

The prediction is deterministic. Speed per gradient comes from the athlete's last six months in that sport, filled by a power model on rides and by Minetti's cost of transport on foot where data is thin. Comparable past activities set how such a session usually goes and how long the stops are. Form and fitness each move speed by at most 3 %, and a route longer than anything comparable slows toward the end. Major climbs use the same detection as activity analysis.

The plan engine owns every number. With an API key, the coach model may pick and weight the comparable activities, propose plans by product id and share, and move intakes by up to 10 minutes; it never outputs grams or times. Each answer is validated, and anything that fails, or any run without a key, keeps the deterministic result.

Swimming has no route to upload and is not offered. Walking and hiking are.

Assumptions, each a constant in the code:

- Default carb targets: 80 g/h for rides, 60 g/h for runs, 40 g/h for walks and hikes. The athlete changes it per route; 120 g/h is the most an hour may hold.
- The total is the target times the predicted time, taken between 15 minutes after the start and 15 minutes before the end.
- Absorption lead times: drink 10 min, gel with a sip 12 min, gel alone 20 min, chew 20 min, bar 35 min, caffeine peak 45 min.
- A gel is ready at the start of each major climb. Caffeine, in one serving, peaks as the last major climb in the second half starts.
- Bars only on rides of 2 hours or more, in the first half, on flat ground. Nothing is planned on steep descents.
- Each rolling hour stays within 0.8 to 1.25 times the rate the window needs, give or take one serving, since servings come in whole units.
- Drinks are limited to the bottles carried, with no refills, at the store's concentration, and to 750 ml an hour on rides and 500 ml on foot. Bottles left over are planned as water.
- Caffeine stays under 3 mg per kg of body weight per route, counting only stated doses. Weight is a required profile field for this reason.
- Times are suggestions from the start ("around 1:45 · km 38") with an earliest-to-latest window, never clock times.
