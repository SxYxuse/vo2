# The route builder proposes loops from BRouter, scored on OSM tags and popular segments

The route builder proposes road and gravel loops that start and finish at a point the athlete places and stay inside a circular zone around it. It returns the three best of eight candidate loops, each with a route confidence from 0 to 100.

**No Strava heatmap.** Strava's API offers no heatmap and cannot create routes. Its heatmap tiles load only with a signed-in browser session, and its terms forbid scraping them. The one popularity signal the API offers is `/segments/explore`, which returns the ten most popular ride segments in a box. VO2 asks it for the zone's four quadrants. Strava reserves the explorer for Extended Access apps, so an app without that grant gets a refusal. Confidence then rests on OSM tags alone, and the page says so.

**BRouter, self-hosted.** A bike router over OpenStreetMap decides whether a way can be ridden: surface, smoothness, track grade, access, steps. VO2 runs [BRouter](https://github.com/abrensch/brouter) 1.7.10 with its stock profiles: `fastbike` for road (no steps, no ferries), and `gravel` with `prefer_unpaved_paths`. `docker/brouter` builds it from the pinned release. `vp run routing:up` downloads the 5° map tiles it needs (`scripts/brouter-segments.ts`) and starts it. `BROUTER_URL` names the server. Unset, the route builder is off, except beside mock Strava, where the app's own mock BRouter (`/api/mock-brouter`) answers.

**Loops.** Each candidate puts three waypoints on a circle through the start, sized to the distance and kept inside the zone. A waypoint near the start of a popular segment moves onto it, so the loop rides the segment end to end. A loop that misses the distance by over 12 % is resized once. BRouter snaps a waypoint to the nearest way, so a waypoint dropped in a forest drags a road loop onto a path. Up to twice, a waypoint beside an unsuitable stretch slides 15° along the circle, and the better loop is kept.

**Route confidence.** Every stretch's OSM tags are read for the discipline:

- **Suits the bike:** paved surfaces for road; gravel, compacted, and grade 1–3 tracks for gravel.
- **Likely fine:** road kinds that are paved nearly everywhere VO2 is used but carry no surface tag.
- **Unsure:** untagged tracks and paths, cobbles on a road bike, and footways, where bikes are often not allowed.
- **Unsuitable:** unpaved surfaces on a road bike; sand, mud, grass, and grade 5 for gravel; steps; lifts; and ways closed to bikes.

Confidence is the distance-weighted fit (1, 0.85, 0.45, 0). A loop that can't be ridden in one place can't be ridden at all, so it loses four times its unsuitable share. Riding the same road twice costs up to 80 % of its share, leaving the zone up to 60 %, and missing the distance by more than 10 % costs the excess, down to half. Popular segments can lift it by at most 10 %, reached at a fifth of the loop on them, and never over its own surface problems. Confidence is High from 80, Medium from 60, and Low below. Busy roads can be ridden, so they don't lower confidence, but the quieter of two loops ranks first. A gravel loop under 40 % unpaved ranks lower. A loop that mostly overlaps a better one is dropped.

**On the device.** As with GPX merges (ADR 0043), the zone and the last proposals are kept in IndexedDB on the device and removed on sign-out. Nothing about them is stored on the server. The selected loop downloads as GPX, offline too. Only finding new loops needs a connection.

Rides only: runs and other sports are not offered here.

## Considered options

- **Strava's heatmap tiles:** the best popularity data, but they need a signed-in browser session, and Strava's terms forbid using them this way.
- **Hosted routers (GraphHopper, OpenRouteService):** no infrastructure, but daily quotas, and gravel tuning needs paid custom models.
- **BRouter's public server or its own round-trip mode:** brouter.de is meant for light use. The round-trip mode can't keep a loop inside a zone or steer it onto popular segments.
- **The athlete's own past rides as a heat layer:** rejected for now. Confidence should rest on what is known about the ways, and the athlete's own rides are already on the activity map.
- **Saving routes per athlete:** a table, athlete deletion work, and an upload for every proposal, all for a one-off planning task.
