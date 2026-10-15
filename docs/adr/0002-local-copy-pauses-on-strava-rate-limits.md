# Keep a local copy of activities and pause on Strava rate limits

Activities and their streams are copied into VO2's database. The calendar, maps, fitness chart, and field-test scoring read that copy, not live Strava.

Strava caps reads (typically 100 per 15 minutes and 1,000 per day). Fetching streams for a full history will hit that cap. VO2 pages activities, then fetches streams in small batches, and pauses until the next window or the next UTC day. The athlete resumes with Sync from Strava.

The alternative was querying Strava on every page load, or running a silent background queue. Live queries would burn the quota on maps and charts. A hidden queue would keep going after the athlete left and still stall on the daily cap. An explicit pause makes the limit visible and keeps the rest of the app usable on data already copied.
