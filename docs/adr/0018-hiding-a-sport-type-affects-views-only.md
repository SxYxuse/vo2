# Hiding a sport type affects views only

A hidden sport type stays out of the calendar, map, and heart-rate views and nothing else. Everything that models the athlete still reads it: training load, fitness, fatigue, and form (ADR 0015), the load anchors, the week target, and planning's guess at which sensors the athlete owns.

0015 settled training load but left planning open (#40). Planning used to look only at shown sport types to decide whether the athlete trains with a heart-rate belt or a power meter. An athlete who hid VirtualRide to declutter the calendar could lose the power-based key sessions their indoor rides support. Hiding a type is a display choice, and the sensors are still worn.

The views apply the rule in one place: the server leaves hidden sport types out of the calendar, map, and heart-rate data, so a new view gets it right without repeating the check. Settings still list every sport type so the athlete can show it again.
