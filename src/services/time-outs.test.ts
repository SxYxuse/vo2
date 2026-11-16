import { describe, expect, it } from "vite-plus/test";

import { timeOutsBetween, type TimeOut } from "./time-outs.ts";

const sick: TimeOut = { id: "sick", kind: "sick", start: "2026-06-12", end: "2026-06-14" };

describe("timeOutsBetween", () => {
  it("clips a time out to the days a chart shows", () => {
    expect(timeOutsBetween([sick], "2026-06-13", "2026-06-20")).toEqual([
      { timeOut: sick, from: "2026-06-13", to: "2026-06-14" },
    ]);
  });

  it("runs an open time out to the last day and leaves out one outside the days", () => {
    const injured: TimeOut = { id: "injured", kind: "injured", start: "2026-06-15", end: null };
    expect(timeOutsBetween([sick, injured], "2026-06-15", "2026-06-17")).toEqual([
      { timeOut: injured, from: "2026-06-15", to: "2026-06-17" },
    ]);
  });
});
