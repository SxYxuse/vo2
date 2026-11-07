# Field tests are out; FTP and LTHR come from estimates

Partly superseded by [0021](0021-athletes-set-heart-rate-anchors-and-pick-a-zone-method.md): athletes can set their own LTHR and max heart rate, which are stored.

VO2 no longer publishes field-test protocols, flags activities as tests, or stores those results. FTP and sport-specific LTHR come from estimates on copied activities.

Keeping a Tests page, a flag on every activity, and a `field_tests` table was extra product surface for a protocol the athlete already does (or does not) outside the app. Estimates are good enough for training load and remaining-week cues. The cost is that a true 20-min FTP or Friel LTHR is not stored as an override.

This supersedes [0005](0005-field-tests-are-flagged-not-inferred.md).
