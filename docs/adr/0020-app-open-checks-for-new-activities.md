# Opening the app checks Strava for new activities, at most every 15 minutes

When the app opens or comes back to the foreground with a complete local copy, it syncs on its own if the last sync of any kind was at least 15 minutes ago. The check is silent: only the header sync spinner shows. A sync of a complete copy no longer re-reads older history, so a check costs one Strava read for the newest page plus one read per new activity's streams.

Before, an activity uploaded in the morning stayed out of VO2 until the athlete tapped **Sync from Strava**, so the week target and fitness lagged behind their real week. Reads are shared: 100 per 15 minutes and 1,000 per day (ADR 0002). A check on every open would let an athlete who flicks in and out of the PWA spend reads that history and streams need. Fifteen minutes matches Strava's short window, so at most one check lands in each window. The gap is measured from the server's last sync time, so it survives app restarts, is shared between devices, and a sync by hand also resets it.

The alternatives were a timestamp kept on the device, which resets on reinstall and differs between devices, and Strava webhooks, which need a public subscription endpoint VO2 does not have yet. The check never runs during a pause, before the first copy, or after a failed sync; those still wait for the athlete, as in 0012. A complete copy no longer catches an activity uploaded with a date older than its oldest activity; a full re-walk would cost a read on every sync for that rare case.

This supersedes the part of [0012](0012-onboarding-waits-for-newest-page-only.md) that resumed on its own only to finish an incomplete local copy.
