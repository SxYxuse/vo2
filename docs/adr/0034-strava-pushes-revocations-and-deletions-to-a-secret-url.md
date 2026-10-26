# Strava pushes revocations and activity deletions to a secret URL

VO2 subscribes to Strava's push events. When an athlete revokes VO2 on Strava, VO2 runs Athlete deletion, without the step that revokes Strava access because Strava has already done it. When an athlete deletes an activity on Strava, VO2 removes it from the local copy, so it stops counting toward training load. Other events are acknowledged and ignored; new activities still arrive through sync ([0020](0020-app-open-checks-for-new-activities.md)).

Strava's API agreement expects an app to delete an athlete's data once they revoke it, and sync alone never sees a deletion. Finding one by re-listing history would spend reads on every sync from the budget all athletes share ([0002](0002-local-copy-pauses-on-strava-rate-limits.md)).

Strava does not sign its events. Strava posts them to `/api/strava-webhook/<STRAVA_WEBHOOK_SECRET>`, and any other path returns 404. The secret also serves as the subscription's verify token. The alternative was to confirm each event with Strava, by refreshing the athlete's token or reading the activity back. That costs reads and needs a token outside any session. Better Auth also reports a refused refresh the same way as an unreachable Strava, so a forged deauthorize could delete an athlete during an outage.

Strava allows one subscription per app, so only the deployment it points at receives events. Previews that share the production Strava app receive none. Without `STRAVA_WEBHOOK_SECRET`, the webhook is off.
