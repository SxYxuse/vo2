# Onboarding waits for the newest page only; the copy finishes while the app is open

Partly superseded by [0020](0020-app-open-checks-for-new-activities.md): opening the app also checks for new activities, not only to finish an incomplete local copy.

The first onboarding step lets the athlete continue once the newest page of activity summaries is copied: up to 200 of their latest activities, in one Strava read. Older history and streams keep copying after that, history first, then streams newest first. While the app is open and in the foreground, the copy resumes on its own when a rate-limit pause ends or the app comes back to the foreground, but only to finish an incomplete local copy.

An athlete with years of Strava history used to wait in the first step while streams were copied, close to a full 15-minute read window, before they could move on. On a phone that wait is long enough to lose them. Onboarding defaults only read the last three months of training load, and that comes from summaries, not streams.

The alternatives were capping the local copy at the last N activities, or gating on a time window such as 90 days. A cap would cut fitness and the calendar short for good, and change what a sync means. A count or a time window treats a 2-session week very differently from a 14-session week, and a 90-day window shows nothing for an athlete coming back from a break. The newest page costs the same single read whether it holds 50 activities or 200, and it always holds the athlete's most recent training.

Resuming on its own replaces 0002's rule that the athlete always resumes by hand. On a phone, the PWA is backgrounded constantly, and a copy that waits for a tap stays half done. It still is not a hidden queue: it runs on the client, only while the app is open, shows the header sync spinner, and never runs during an active pause. Checking for new activities on open is decided in [0020](0020-app-open-checks-for-new-activities.md).
