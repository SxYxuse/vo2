import { describe, expect, it } from "vite-plus/test";

import { isVersionOnlyBump } from "./release-check.ts";

const before = {
  name: "vo2",
  version: "0.7.0",
  dependencies: { react: "19.0.0" },
};

describe("isVersionOnlyBump", () => {
  it("accepts a change that only moves the version", () => {
    expect(isVersionOnlyBump(before, { ...before, version: "0.7.1" })).toBe(true);
  });

  it("rejects a bump that also changes another field", () => {
    expect(
      isVersionOnlyBump(before, {
        ...before,
        version: "0.7.1",
        dependencies: { react: "19.1.0" },
      }),
    ).toBe(false);
  });

  it("rejects a bump that leaves the version unchanged", () => {
    expect(isVersionOnlyBump(before, { ...before })).toBe(false);
  });
});
