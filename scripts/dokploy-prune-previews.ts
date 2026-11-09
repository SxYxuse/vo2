/*
 * Deletes the Dokploy previews of pull requests that are merged or closed. Dokploy does not always
 * remove a preview when its PR closes, and only 3 previews may run at once.
 *
 *   bun scripts/dokploy-prune-previews.ts           dry run: lists what it would delete
 *   bun scripts/dokploy-prune-previews.ts --apply   deletes those previews
 *
 * A preview is deleted only when GitHub reports its PR as MERGED or CLOSED. An open PR, or one
 * whose state gh can't read, keeps its preview. Pruning these previews is pre-approved (see the
 * Safety section of docs/agents/production.md). Prod and staging are never touched: this only
 * reads the staging app's previews and deletes by preview ID.
 */

import { execFileSync } from "node:child_process";

import { REPO, dokploy, listPreviews, type Preview } from "./dokploy.ts";

const apply = process.argv.includes("--apply");

/** Looks the PR up by the URL Dokploy stored, so a PR of another repo never decides. */
function prState(preview: Preview) {
  if (!preview.pullRequestURL?.startsWith(`https://github.com/${REPO}/pull/`)) return "UNKNOWN";
  try {
    return execFileSync(
      "gh",
      ["pr", "view", preview.pullRequestURL, "--json", "state", "-q", ".state"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
  } catch {
    return "UNKNOWN";
  }
}

const previews = await listPreviews();
let pruned = 0;
for (const preview of previews) {
  const state = prState(preview);
  const prunable =
    (state === "MERGED" || state === "CLOSED") && preview.appName.startsWith("preview-");
  const verdict = !prunable ? "keep  " : apply ? "delete" : "would delete";
  console.log(`${verdict}  PR #${preview.pullRequestNumber} (${state})  ${preview.appName}`);
  if (!prunable || !apply) continue;
  await dokploy("previewDeployment.delete", { previewDeploymentId: preview.previewDeploymentId });
  pruned++;
}

console.log(
  previews.length === 0
    ? "No previews."
    : apply
      ? `Deleted ${pruned} preview(s).`
      : "Dry run: nothing deleted. Rerun with --apply to delete the previews marked above.",
);
