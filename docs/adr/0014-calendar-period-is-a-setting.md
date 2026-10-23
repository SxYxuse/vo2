# The calendar period is a setting; phones show one week

Paging superseded by [0021](0021-calendar-jumps-to-any-month.md).

On desktop the calendar shows one civil month by default, as in [0013](0013-calendar-shows-one-civil-month.md): a Monday-first grid with the days of other months left blank and their activities left out. Settings → Calendar can switch it to the last four training weeks instead. Previous and next page by the period shown, a month or four weeks, and never past the present.

A phone ignores the setting and shows the current training week as a day list, paging one week at a time. A month or four weeks as a list was a long scroll on a narrow screen.

The cursor lives in the URL as `?month=YYYY-MM` for the month grid and `?week=YYYY-MM-DD` (the last week shown) for the week views. The present has neither, so a bare `/` keeps following today. Opening an activity passes the cursor along and the Calendar link returns to it. When a link carries the other view's cursor, such as a month opened on desktop and returned to on a phone, the calendar converts it to keep its place in time. Without either, the Calendar link returns to the activity's own month and week.

This supersedes [0013](0013-calendar-shows-one-civil-month.md).
