# The calendar shows one civil month

The calendar shows one civil month of completed activities, on desktop and phones alike. Desktop draws a Monday-first month grid with the days of other months left blank and their activities left out. A phone shows the month's days as a list. The calendar pages one month at a time and never past the current one.

The month lives in a `?month=YYYY-MM` search param. The current month has no param, so a bare `/` keeps following today. Opening an activity passes the month along, and the Calendar link returns to it. If the athlete reaches an activity without one, such as from a shared link, the Calendar link returns to that activity's month.

A range of training weeks read as "Sep 14 – Oct 11", which the athlete found harder to place than "October 2026". The cost is that the month is nearly empty on the 1st and its first and last rows are partial weeks, so a training week that spans two months is split across two pages.

This supersedes [0008](0008-calendar-shows-training-weeks-not-a-month.md) and [0010](0010-calendar-return-preserves-activity-week.md).
