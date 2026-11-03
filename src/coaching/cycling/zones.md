# Cycling zones

A ride step targets a **zone** (or an effort, when the athlete rides by feel). VO2 turns the zone into the athlete's own numbers: watts from their FTP when VO2 has one, otherwise heart rate from their cycling LTHR, otherwise the zone's name and feel. Never write a number of watts or bpm yourself.

The levels are Coggan's, as a share of FTP, with sweet spot between tempo and threshold ([TrainingPeaks power levels](https://www.trainingpeaks.com/learn/articles/power-training-levels/), [TrainerRoad sweet spot](https://www.trainerroad.com/sweet-spot-training)). Heart rate is a share of cycling LTHR: cycling LTHR runs lower than running LTHR, so never borrow one sport's ([Friel](https://www.trainingpeaks.com/learn/articles/joe-friel-s-quick-guide-to-setting-zones/)).

| Zone        | % FTP    | % cycling LTHR | Feel                             | For                             |
| ----------- | -------- | -------------- | -------------------------------- | ------------------------------- |
| `recovery`  | < 55 %   | < 68 %         | Barely pedalling                 | Recovery rides, recoveries      |
| `endurance` | 56–75 %  | 69–83 %        | All day, full sentences          | Most riding, long rides         |
| `tempo`     | 76–87 %  | 84–90 %        | Steady pressure, short sentences | Muscular endurance, long events |
| `sweetSpot` | 88–94 %  | 91–95 %        | Comfortably hard, a few words    | Threshold gains at low cost     |
| `threshold` | 95–105 % | 95–102 %       | Hard, about an hour's effort     | FTP, time trials, long climbs   |
| `vo2max`    | 106–120% | —              | Very hard, 3–8 minutes           | VO2 max                         |
| `anaerobic` | 121–150% | —              | Near all-out, 30 s to 3 min      | Crits, short climbs, surges     |
| `sprint`    | Max      | —              | All-out, under 30 s              | Neuromuscular power, sprints    |

- Heart rate lags behind short efforts and drifts on long ones. Above threshold it can't steer an effort: VO2 shows power, or the feel.
- Efforts (`easy`, `steady`, `comfortablyHard`, `hard`, `fastRelaxed`) map to endurance, tempo, threshold, VO2 max, and anaerobic. Use an effort instead of a zone when the athlete has neither power nor heart rate, or on rough ground where power swings.
- Work above threshold rarely exceeds 30–40 minutes in one session (TrainingPeaks).

## Where FTP comes from

VO2 estimates FTP from the athlete's rides with power. A tested or race value is better; the athlete's best 20 minutes × 0.95 is the usual estimate ([CTS](https://trainright.com/ftp-tests-how-to-perform-20-minute-8-minute-and-ramp-tests/)). Without power, the heart-rate zones above carry the plan.
