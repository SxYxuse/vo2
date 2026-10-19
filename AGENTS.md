## Product constraints

VO2 is a PWA first, installed to the athlete's home screen and used on a phone far more than a desktop. Design and build for that:

- **PWA first:** every change should work as an installed standalone app (`public/manifest.webmanifest`, touch icons, offline-tolerant behavior). Don't add anything that assumes a browser tab, a URL bar, or a desktop-only window.
- **Mobile first:** lay out for a narrow viewport first and scale up. Touch targets, safe-area insets, and thumb reach matter more than hover states or dense tables.
- Prefer solutions that keep working when the app is backgrounded, resumed, or briefly offline.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for `SxYxuse/vo2` and are managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `GLOSSARY.md` plus `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Preview deploys

Add the `preview` label in its own step after the PR exists, never with `gh pr create --label`. See `.agents/skills/preview-deploy/SKILL.md`.

### Before pushing

Run `vp check` (format, lint, types); CI fails on it before tests run. The pre-commit hook runs `vp check --fix` on staged files once `bun install` has installed it.
