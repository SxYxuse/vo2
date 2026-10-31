# The coach chat can propose plan changes the athlete applies

The coach chat answered questions without changing anything. With the coach plan (ADR 0037) it can now change the plan, but only through a proposal the athlete applies. The athlete says what changed ("I'm away Tuesday and Wednesday", "Sunday's long run was too hard") and the coach first sends a proposed change to a tool that checks it against the coach plan's rules and returns either the change, day by day before and after, or the rules it breaks so the coach can fix it. Only a change that passed is offered with TanStack AI's tool approval: the chat shows it with Apply and Decline. Applying saves it if the plan has not changed since; otherwise the athlete is asked to try again. Notes on a day of the plan go through the same path without opening the chat. The chat still never changes the local copy, the season, or the athlete's settings.

Athletes asked to adjust a plan in their own words, which a form of fixed choices can't cover. A model editing the plan directly would make every rule a request and every mistake silent. Checking before asking, and asking before saving, means the athlete only ever sees changes that keep the rules, and nothing changes without their tap.

This supersedes, for the coach plan only, the rule that the coach chat changes nothing.
