# Labels

The mstack skills speak in terms of label roles. This file maps those roles to the actual label strings used in this repo's issue tracker.

| Role                  | Label in our tracker  | Applied by              | Meaning                                         |
| --------------------- | --------------------- | ----------------------- | ----------------------------------------------- |
| `ready-for-agent`     | `ready-for-agent`     | `to-spec`, `to-tickets` | Fully specified, ready for an AFK agent         |
| `in-progress`         | `in-progress`         | `conduct`               | A ticket's agent thread is launched             |
| `in-review`           | `in-review`           | `conduct`               | A ticket's PR or MR is filed                    |
| `wayfinder:map`       | `wayfinder:map`       | `wayfinder`             | The map of a wayfinding effort                  |
| `wayfinder:research`  | `wayfinder:research`  | `wayfinder`             | Decision ticket resolved by research (AFK)      |
| `wayfinder:prototype` | `wayfinder:prototype` | `wayfinder`             | Decision ticket resolved by a prototype (HITL)  |
| `wayfinder:grilling`  | `wayfinder:grilling`  | `wayfinder`             | Decision ticket resolved by conversation (HITL) |
| `wayfinder:task`      | `wayfinder:task`      | `wayfinder`             | Manual work a decision waits on                 |

`ready-for-agent`, `in-progress` and `in-review` are **status** labels: an issue carries at most one, and setting one removes the other two. Done is the issue being closed, not a label.

When a skill mentions a role (e.g. "apply the `ready-for-agent` triage label"), use the corresponding label string from this table.

Edit the "Label in our tracker" column to match whatever vocabulary you actually use.
