# Max heart rate is the recent peak, checked against age, with sensor spikes dropped

Each sport family's max heart rate is the highest Strava activity max from the last 18 months. Older peaks are used only when there is nothing recent, and the age prediction (Tanaka, 208 − 0.7 × age) only when there are no peaks at all. A peak is dropped as a sensor spike when it is more than 25 bpm above the age prediction, or when it sits more than 8 bpm above every other peak on a session whose average was under 70 % of it. The same rule feeds the heart rate page, activity zones, and the LTHR that scores heart-rate training load, so changing the birth date refreshes training load.

An all-time peak would set zones too high as the athlete ages (max HR falls about 0.7 bpm per year), and one optical spike would move every zone and every heart-rate load. Using the age formula as the anchor would be simpler but wrong for many athletes: its spread is about ±10 bpm, so it only checks and fills in, it never overrides a recorded peak. A recorded peak far below the prediction is shown as a hint, not corrected.

The trade-off is that a genuine one-off max on an otherwise easy day is ignored, and a max from more than 18 months ago no longer counts even if the athlete has not tested since.
