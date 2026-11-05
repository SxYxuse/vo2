# Each sport's coaching knowledge is one file and one skill

Supersedes, in part, [0046](0046-the-coach-chat-loads-running-knowledge-as-skills.md) and [0050](0050-the-coach-plan-plans-runs-and-rides-and-the-week-planner-is-removed.md): the chat's one skill per knowledge file.

The running knowledge was three files (`principles.md`, `paces.md`, `sessions.md`) and the cycling knowledge three more (`principles.md`, `zones.md`, `sessions.md`). They are now one file per sport, `src/coaching/running.md` and `src/coaching/cycling.md`, each in sections, and the coach chat loads each as one skill: `running`, `cycling`, and `season-multisport` as before.

The split didn't follow how the knowledge is used. The plan writer always read all three files of a sport together (ADR 0037), the files kept pointing at each other (a session sized by a cap in `paces.md` against a rule in `principles.md`), and a plan change in the chat needs all three anyway. One file is easier to keep consistent and to read top to bottom.

What it costs: a chat question about a single pace now loads the whole running file, about 4,700 words instead of 900. A plan change already needed more than one file, so the extra cost lands on narrow questions only.
