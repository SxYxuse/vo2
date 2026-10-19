## Agent skills

### Issue tracker

Issues live in GitHub Issues for `SxYxuse/vo2` and are managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Preview deploys

Add the `preview` label in its own step after the PR exists, never with `gh pr create --label`. See `.agents/skills/preview-deploy/SKILL.md`.

### Before pushing

Run `vp check` (format, lint, types); CI fails on it before tests run. The pre-commit hook runs `vp check --fix` on staged files once `bun install` has installed it.
