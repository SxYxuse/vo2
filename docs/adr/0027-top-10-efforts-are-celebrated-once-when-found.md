# Top 10 efforts are celebrated once, when found

An athlete can turn on a setting (off by default) so that VO2 congratulates them in the app when a new activity is a top 10 effort, all time or within its year. "Congratulate whatever ranks" would fire constantly, because the local copy fills up over time, so the celebration follows narrower rules:

- **Only recent activities.** The activity must have started within 7 days of when its effort is found. Effort is found when the stream arrives, so if old history backfills, or a stream arrives late after a rate-limit pause, nothing pops up.
- **Rank is fixed when found.** The rank is measured against the local copy at that moment and is never revised. If older history later pushes the effort down, the celebration already shown stands; the bests page always shows the current ranking.
- **A year's board needs 10 earlier efforts.** Until the year's board has 10 efforts before this one, only the all-time rank counts there. Otherwise every January activity would rank on every board.
- **Nothing retroactive.** Turning the setting on celebrates only efforts found afterwards, and turning it off drops celebrations not yet seen.
- **Seen once, on the server.** Each celebration is stored per athlete and marked seen when dismissed, so it never shows twice across devices or reinstalls. It is deleted with the athlete.

It is an in-app dialog, not a push notification: push would need a service worker sender, a permission prompt, and a server to send it, all for a moment the athlete will see the next time they open the app anyway.
