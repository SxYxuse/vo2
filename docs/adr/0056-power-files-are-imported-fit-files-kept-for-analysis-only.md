# Power files are imported FIT files, kept for analysis only

Strava keeps a ride's power but drops what a dual-sided power meter records beside it: each leg's share of power, where on the pedal the force goes (platform center offset), the crank arc of each stroke (power phase and peak power phase), seated and standing, and electronic shifting. The head unit's FIT file has all of it. The athlete imports a ride's FIT file, or Garmin Connect's "Export original" zip around it, on the Power page, and VO2 shows that analysis there.

A power file is kept on the server: the original file, a short summary for the list, and the analysis. Unlike a GPX merge (ADR 0043), it is the athlete's record of a ride, read again later and on another device, so it follows the athlete and is removed with them. The original file stays so a better analysis can read it again without asking for the file; the analysis carries a version and is rebuilt from the file when that version changes. Importing the same file twice opens the first import.

The analysis is stored without FTP or weight. Zones, intensity, quadrants, and watts per kilogram are worked out when the page is read, from VO2's FTP and body weight, or the ones the head unit stored in the file when VO2 has none. Changing FTP never needs a new import.

A power file never changes training load, fitness, form, bests, or the coach plan: Strava stays the one source of activities, and counting the file too would count the ride twice. It is linked to the synced ride that started within five minutes of it, both ways: the analysis opens the ride, and the ride's page opens the analysis. A file with no synced ride still shows its analysis.

Only rides are accepted, and only with power: runs and other sports are turned away with the reason, since a running FIT file has none of this. A one-sided power meter still gets power, cadence, and gears, without balance or the pedal stroke. The list is saved on the device for offline reading like other lists (ADR 0031); an analysis is not, like an activity's streams, and importing or deleting needs a connection.
