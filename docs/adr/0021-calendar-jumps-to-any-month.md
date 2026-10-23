# The calendar can jump to any month

This supersedes how [0014](0014-calendar-period-is-a-setting.md) pages; its cursor rules still hold.

Paging one training week at a time made last October dozens of taps away on a phone. Tapping the calendar's date label now opens a picker: a year, then its months, each with its activity count and hours (hidden sport types left out, as in the calendar). Years run from the oldest synced activity to this one; future months and months before that activity are disabled. Without any synced activity the label is not a picker.

What a picked month opens follows the calendar period:

- **Phone (one training week):** the month's training weeks, each with its hours, and the athlete picks one. One more tap than landing on the month's first week, but it lands on the right week.
- **Month grid:** that month.
- **Four weeks:** the four training weeks starting with the one that holds the 1st, so the month reads top to bottom, never past the current week. The month's last days can fall on the next page, the same split 0013 accepted.

The jump only sets the existing `?week=` or `?month=` cursor, so Back, returning from an activity, and **Today** behave as before. On phones the day list also pages a week with a horizontal swipe, alongside the buttons; it never goes past the current week. We considered a scrollable list of every week with a drag scrubber, and activity search. The scrubber needs a custom gesture that is hard to make feel right in an installed app; search answers "that ride in Mallorca" rather than "last October" and is left for its own issue.
