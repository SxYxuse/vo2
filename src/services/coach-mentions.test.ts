import { describe, expect, test } from "vite-plus/test";

import { activityIdFromHref, withActivityLinks } from "./coach-mentions.ts";

const morning = { id: "101", name: "Morning Run" };
const ride = { id: "202", name: "Col [du] Galibier" };

describe("activity mentions", () => {
  test("each mention becomes a link where it was typed", () => {
    expect(withActivityLinks("Compare @Morning Run with @Col [du] Galibier", [morning, ride])).toBe(
      "Compare [Morning Run](/activities/101) with [Col \\[du\\] Galibier](/activities/202)",
    );
  });

  test("a name that starts another mentioned name links the right one", () => {
    const second = { id: "102", name: "Morning Run 2" };
    expect(withActivityLinks("Compare @Morning Run 2 with @Morning Run", [morning, second])).toBe(
      "Compare [Morning Run 2](/activities/102) with [Morning Run](/activities/101)",
    );
  });

  test("a mention whose text was edited away still reaches the coach", () => {
    expect(withActivityLinks("How did it go?", [morning])).toBe(
      "How did it go?\n\n[Morning Run](/activities/101)",
    );
  });

  test("reads the activity id back from a link", () => {
    expect(activityIdFromHref("/activities/101")).toBe("101");
    expect(activityIdFromHref("https://example.com/activities/101")).toBeNull();
    expect(activityIdFromHref("/activities/101/edit")).toBeNull();
  });
});
