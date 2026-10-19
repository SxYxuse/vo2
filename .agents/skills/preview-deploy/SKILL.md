---
name: preview-deploy
description: Use when asked to trigger, start, or request a preview build/deploy for a PR, or to open a PR "with the preview label". Adds the `preview` label in its own step so Dokploy deploys once.
---

# Preview deploy

Dokploy builds a preview for any PR labelled `preview`. It does not deduplicate webhooks: `gh pr create --label preview` sends `opened` plus two `labeled` events within a second, and Dokploy creates three separate previews, each rebuilt on every later push (PR #27).

## Steps

1. Create the PR **without** labels. Never pass `--label preview` to `gh pr create`.

   ```bash
   gh pr create --base main --title "..." --body-file <file>
   ```

2. Add the label in a separate command once the PR exists:

   ```bash
   gh pr edit <number> --add-label preview
   ```

   For an existing PR, step 2 is the only step. Skip it if the PR already has the label: pushing to a labelled PR already redeploys.

3. Check that Dokploy posted exactly **one** "Dokploy Preview Deployment" comment:

   ```bash
   gh api repos/SxYxuse/vo2/issues/<number>/comments \
     -q '[.[] | select(.body | startswith("### Dokploy Preview Deployment"))] | length'
   ```

   If it is more than 1, tell the user which preview URLs are extra so they can delete them in Dokploy. Do not remove and re-add the label to "fix" it; that triggers another deploy.
