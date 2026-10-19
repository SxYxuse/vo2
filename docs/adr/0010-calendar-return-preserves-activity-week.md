# The calendar's ending week lives in the URL

The calendar keeps its ending week in a `?week=` search param instead of component state, so opening an activity and coming back (browser Back or the Calendar link) shows the same training weeks. A calendar on the current week has no param, so a bare `/` keeps following today. Opening an activity passes the ending week along, and the Calendar link returns to it. If the athlete arrives at an activity without one, such as from a shared link, the Calendar link ends on that activity's training week.

We considered two other ways to remember the week. Session state would be lost on reload and could not be shared. Making the activity's own week the ending week would move the view whenever the activity was not in the last row shown.
