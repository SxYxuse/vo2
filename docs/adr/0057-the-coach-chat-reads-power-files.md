# The coach chat reads power files

Extends [0056](0056-power-files-are-imported-fit-files-kept-for-analysis-only.md).

A power file's numbers (balance, platform center offset, power phase, quadrants) mean little without knowing what is normal and what to change. The athlete asks the coach. **Ask the coach** on a power file, and a question at the end of each section, open the coach chat with that file brought in as a chip, the way **Ask about this activity** brings in an activity (ADR 0044). A section's question is placed in the message box, not sent: the athlete's own key pays for each answer (ADR 0036), so the athlete taps Send. There is no saved write-up, for the same reasons as ADR 0044.

The chat gets two tools: `find_power_files` lists the imported files, and `get_power_file` reads one as the page shows it, without the chart series. The reading uses VO2's FTP and weight, with the file's own as the fallback. `get_activity` gives a ride's power file id, so a question about the ride can reach its file. The athlete and the coach link a power file as `/power/<id>`, and the chat shows that link as a chip.

What a number means, how normal it is, and what to change come from `src/coaching/power-files.md`, loaded as its own skill, `power-files`. It isn't a section of `cycling.md` (ADR 0054). That file is how VO2 plans rides: the plan writer reads all of it on every plan (ADR 0037), and every ride question in the chat loads it. Pedaling dynamics never shape a plan, so about 1,600 more words there would cost every plan and every ride question.

Pedaling norms come from manufacturers, coaches, and riders, not population studies. The guide tells the coach to compare the athlete with themselves, to check data quality first, and to send pain or a large lasting asymmetry to a fitter or physio.
