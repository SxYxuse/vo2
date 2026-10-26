import { describe, expect, it } from "vite-plus/test";

import { blockReason, databaseNameFrom, type GuardContext } from "./agent-guard.ts";

const worktree: GuardContext = { worktree: true, databaseName: "vo2_wt_abc" };
const sharedDb: GuardContext = { ...worktree, databaseName: "vo2" };
const mainCheckout: GuardContext = { worktree: false, databaseName: "vo2" };

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
    ["bunx drizzle-kit migrate", sharedDb],
    ["DATABASE_URL=postgresql://vo2:vo2@localhost:5432/vo2 vp run db:migrate", worktree],
  ])("blocks %s", (command, context) => {
    expect(blockReason(command, context)).not.toBeNull();
  });

  it.each([
    ["vp run db:up", worktree],
    ["kill 12345", worktree],
    ["vp run db:migrate", worktree],
    ["vp run db:migrate", mainCheckout],
    ["grep -rn pkill scripts", worktree],
    ["git commit -m 'block db:down and db:migrate'", sharedDb],
    ["cat <<'EOF'\n- a hook blocks db:down, and db:migrate on vo2\nEOF", sharedDb],
  ])("allows %s", (command, context) => {
    expect(blockReason(command, context)).toBeNull();
  });

  it("reads the database name from a connection URL", () => {
    expect(databaseNameFrom("postgresql://vo2:vo2@localhost:5432/vo2_wt_t3")).toBe("vo2_wt_t3");
    expect(databaseNameFrom("not a url")).toBeNull();
  });
});
