import { describe, expect, it } from "vite-plus/test";

import { blockReason, databaseNameFrom, type GuardContext } from "./agent-guard.ts";

const worktree: GuardContext = { worktree: true, databaseName: "vo2_wt_abc", branch: "feat/x" };
const sharedDb: GuardContext = { ...worktree, databaseName: "vo2" };
const mainCheckout: GuardContext = { worktree: false, databaseName: "vo2", branch: "main" };

describe("agent guard", () => {
  it.each([
    ["vp run db:down", worktree],
    ["docker compose down", worktree],
    ["pkill -f vite", worktree],
    ["killall bun", worktree],
    ["kill $(pgrep -f 'vp dev')", worktree],
    ["pgrep bun | xargs kill", worktree],
    ["fuser -k 3000/tcp", worktree],
    ["vp run db:migrate", sharedDb],
    ["DATABASE_URL=postgresql://vo2:vo2@localhost:5432/vo2 vp run db:migrate", worktree],
    ["vp dlx drizzle-kit push", mainCheckout],
    ["bunx drizzle-kit migrate", sharedDb],
    ["drizzle-kit push", mainCheckout],
    ["gh pr create --base main --title x --label preview", worktree],
    ["gh pr create -l preview", worktree],
    ["git push origin main", worktree],
    ["git push --force origin HEAD:main", worktree],
    ["git push", mainCheckout],
    ["git stash", worktree],
    ["git stash -u", worktree],
    ["git stash pop", worktree],
    ["git stash push -u", worktree],
    ["vp check && git stash", worktree],
  ])("blocks %s", (command, context) => {
    expect(blockReason(command, context)).not.toBeNull();
  });

  it.each([
    ["vp run db:up", worktree],
    ["kill 12345", worktree],
    ["vp run db:migrate", worktree],
    ["vp run db:migrate", mainCheckout],
    ["grep -rn pkill scripts", worktree],
    ["gh pr create --base main --title x --body-file body.md", worktree],
    ["gh pr edit 121 --add-label preview", worktree],
    ["git push -u origin feat/x", worktree],
    ["git push --force-with-lease", worktree],
    ["git stash push -u -m wip-offline", worktree],
    ["git stash list", worktree],
    ["git stash apply 0a1b2c", worktree],
    ["git commit -m 'block db:down and drizzle-kit push'", sharedDb],
    ["cat <<'EOF'\n- a hook blocks db:down, and db:migrate on vo2\nEOF", sharedDb],
    ["grep -n db:migrate package.json", sharedDb],
  ])("allows %s", (command, context) => {
    expect(blockReason(command, context)).toBeNull();
  });

  it("reads the database name from a connection URL", () => {
    expect(databaseNameFrom("postgresql://vo2:vo2@localhost:5432/vo2_wt_t3")).toBe("vo2_wt_t3");
    expect(databaseNameFrom("not a url")).toBeNull();
  });
});
