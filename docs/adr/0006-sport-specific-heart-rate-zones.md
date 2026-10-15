# Heart-rate zones use a sport-specific anchor; LTHR is never shared across sports

Cycling zones are Coggan cuts of cycling LTHR. Running zones are Friel cuts of running LTHR. Swimming uses a CSS-style LTHR model. Walking and other sports use Polar-style cuts of max heart rate.

One set of %max-HR zones for every sport would be simpler and wrong: threshold is sport-specific, and a bike LTHR copied onto a run over-reads easy running. The cost is three anchors (cycling LTHR, running LTHR, max HR) and field tests that must be done in the sport they belong to.
