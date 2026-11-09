---
name: preview-deploy
description: Use when asked to trigger, start, or request a preview build/deploy for a PR, to open a PR "with the preview label", to wait for a preview to deploy, or to prune previews after a PR merges or closes. Adds the `preview` label in its own step so Dokploy deploys once.
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

4. To wait for the build, run `bun scripts/dokploy.ts wait pr-<number>` with `run_in_background`, then wait on that task. It polls Dokploy for the PR's head commit and exits 0 when it is deployed, or 1 on a failed build or after `--timeout` (default 900 seconds). On a failure it prints the `logs` command for the build log. If Dokploy rejects the key, follow the renewal steps it prints.

## After the PR merges or closes

Dokploy may leave its preview running, and only 3 run at once. Run `bun scripts/dokploy-prune-previews.ts`: it lists each preview with its PR's state and deletes nothing. If it marks previews `would delete`, run it again with `--apply`. It only deletes previews whose PR is merged or closed.
