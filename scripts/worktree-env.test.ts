import { readFileSync } from "node:fs";

import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_DEV_PORT,
  inPortRange,
  assertSafeIdentifier,
  pathHash,
  pickPort,
  planEnv,
  readEnvValue,
  setEnvValues,
  usesRenamedVoDatabase,
  worktreeDatabaseName,
} from "./worktree-env.ts";

const path = "/Users/me/.t3/worktrees/sxyxuse-vo2/t3-763c4ce5";

describe("worktreeDatabaseName", () => {
  it("sanitizes the branch and ends with a hash of the worktree path", () => {
    expect(worktreeDatabaseName("fix/app-slowness", path)).toBe(
      `vo2_wt_fix_app_slowness_${pathHash(path)}`,
    );
    expect(worktreeDatabaseName("Feat/Ünïcode--Branch", path)).toMatch(
      /^vo2_wt_feat_n_code_branch_[0-9a-f]{6}$/,
    );
  });

  it("gives two checkouts of the same branch different databases", () => {
    expect(worktreeDatabaseName("main", "/a")).not.toBe(worktreeDatabaseName("main", "/b"));
  });

  it("stays within Postgres's 63-character identifier limit", () => {
    const name = worktreeDatabaseName(`feat/${"x".repeat(200)}`, path);
    expect(name).toHaveLength(63);
    expect(name.endsWith(`_${pathHash(path)}`)).toBe(true);
    expect(() => assertSafeIdentifier(name)).not.toThrow();
  });

  it("never produces the shared database name", () => {
    expect(worktreeDatabaseName("vo2", path)).not.toBe("vo2");
    expect(worktreeDatabaseName("", path)).toBe(`vo2_wt_head_${pathHash(path)}`);
  });
});

describe("assertSafeIdentifier", () => {
  it("rejects anything that could escape the quoted identifier", () => {
    expect(() => assertSafeIdentifier('vo2"; DROP DATABASE vo2; --')).toThrow();
    expect(() => assertSafeIdentifier("Vo_wt")).toThrow();
  });
});

describe("planEnv", () => {
  const own = worktreeDatabaseName("fix/app-slowness", path);
  const sharedEnv = "DATABASE_URL=postgresql://vo2:vo2@localhost:55432/vo2\nPORT=3000\n";

  it("leaves an existing .env that still shares vo2 alone", () => {
    expect(planEnv(sharedEnv, own, false)).toEqual({ kind: "keep", database: "vo2" });
  });

  it("switches a shared .env only with --isolate", () => {
    expect(planEnv(sharedEnv, own, true)).toEqual({ kind: "write" });
  });

  it("writes a missing .env and refreshes one already on this worktree's database", () => {
    expect(planEnv(undefined, own, false)).toEqual({ kind: "write" });
    expect(
      planEnv(`DATABASE_URL=postgresql://vo2:vo2@localhost:55432/${own}\n`, own, false),
    ).toEqual({
      kind: "write",
    });
  });
});

describe("usesRenamedVoDatabase", () => {
  it("flags a pre-rename URL by its user or its database", () => {
    expect(usesRenamedVoDatabase("DATABASE_URL=postgresql://vo:vo@localhost:5432/vo\n")).toBe(true);
    expect(
      usesRenamedVoDatabase("DATABASE_URL=postgresql://vo:vo@localhost:5432/vo_wt_x_abc123\n"),
    ).toBe(true);
  });

  it("accepts vo2 URLs and an .env without one", () => {
    expect(usesRenamedVoDatabase("DATABASE_URL=postgresql://vo2:vo2@localhost:55432/vo2\n")).toBe(
      false,
    );
    expect(usesRenamedVoDatabase("PORT=3100\n")).toBe(false);
  });
});

describe("setEnvValues", () => {
  it("rewrites only the given keys and keeps comments and secrets", () => {
    const before = "# secret\nBETTER_AUTH_SECRET=s3cret\nDATABASE_URL=old\n";
    expect(setEnvValues(before, { DATABASE_URL: "new", PORT: "3100" })).toBe(
      "# secret\nBETTER_AUTH_SECRET=s3cret\nDATABASE_URL=new\nPORT=3100\n",
    );
  });
});

describe("pickPort", () => {
  const nothingListens = async () => false;

  it("keeps the port this worktree already has", async () => {
    expect(await pickPort(3105, new Set(), nothingListens)).toBe(3105);
  });

  it("skips ports other worktrees own and ports that are listening", async () => {
    const listening = async (port: number) => port === 3101;
    expect(await pickPort(undefined, new Set([3100]), listening)).toBe(3102);
    expect(await pickPort(3000, new Set(), nothingListens)).toBe(3100);
  });
});

describe("DEFAULT_DEV_PORT", () => {
  it("is what .env.example gives the main checkout", () => {
    const example = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
    expect(readEnvValue(example, "PORT")).toBe(String(DEFAULT_DEV_PORT));
    expect(readEnvValue(example, "BETTER_AUTH_URL")).toBe(`http://localhost:${DEFAULT_DEV_PORT}`);
  });

  // e2e/env.ts puts a checkout's e2e server at PORT+1000 and its browser at PORT+2000.
  it("keeps its dev, e2e and browser ports clear of every worktree's", () => {
    const offsets = [0, 1000, 2000];
    for (const ours of offsets) {
      for (const theirs of offsets) {
        expect(inPortRange(DEFAULT_DEV_PORT + ours - theirs)).toBe(false);
      }
    }
  });
});
