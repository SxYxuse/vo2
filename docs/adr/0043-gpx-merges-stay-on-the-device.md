# GPX merges stay on the device

Merge GPX joins two or more GPX files into one route. The athlete picks which stretch of each file to follow and where to switch from one to the next. The files are read, matched, and merged in the browser. Nothing is uploaded and no table holds them. The merge in progress (files, legs, meeting distance, name) is kept in IndexedDB on that device so the installed app comes back to it after the phone unloads it in the background. It is removed when the athlete signs out.

Files meet where they pass within the meeting distance (25 m by default, 5 to 200 m). A brief contact is one crossing. A shared stretch gets one meeting point where it joins and one where it splits. A leg can start where the previous leg ends, at the nearest point of its own file. Legs that don't meet still merge: the exported file joins them with a straight line, and the page warns about each jump.

A merge is a one-off planning task. It has no use on another device, and it would only add a table, an upload limit, and athlete deletion work. Working on the device also lets the preview redraw on every slider move and keeps merging possible offline. The map tiles need a signal; without one the page draws a plain outline instead.
