import { describe, expect, it } from "vite-plus/test";

import { releaseBody, summarizeRelease } from "./release-notes.ts";

const notes = "## What's Changed\n* fix(plan): keep the week by @someone in #12";

describe("releaseBody", () => {
  it("puts the summary above the generated notes, folded under details", () => {
    const body = releaseBody({ summary: "Fixes the plan week.", notes });

    expect(body).toBe(
      `Fixes the plan week.\n\n<details>\n<summary>All changes</summary>\n\n${notes}\n\n</details>\n`,
    );
  });

  it("falls back to the generated notes alone when there is no summary", () => {
    expect(releaseBody({ summary: null, notes })).toBe(`${notes}\n`);
  });
});

describe("summarizeRelease", () => {
  it("skips the model call and returns null when no key is set", async () => {
    let called = false;
    const fetchFn = async () => {
      called = true;
      return new Response("{}");
    };

    expect(await summarizeRelease({ apiKey: undefined, notes, fetchFn })).toBeNull();
    expect(called).toBe(false);
  });

  it("returns null when OpenRouter answers with an error, so the release still ships", async () => {
    const fetchFn = async () => new Response("rate limited", { status: 429 });

    expect(await summarizeRelease({ apiKey: "key", notes, fetchFn })).toBeNull();
  });

  it("asks the pinned model with the key and returns the trimmed summary", async () => {
    let request: { url: string; init: RequestInit | undefined } | undefined;
    const fetchFn = async (url: string, init: RequestInit) => {
      request = { url, init };
      return Response.json({
        choices: [{ message: { content: "  Keeps the training week on screen.  " } }],
      });
    };

    const summary = await summarizeRelease({ apiKey: "key", notes, fetchFn });

    expect(summary).toBe("Keeps the training week on screen.");
    expect(request?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(request?.init?.headers).toMatchObject({ Authorization: "Bearer key" });
    expect(JSON.parse(request?.init?.body as string).model).toBe("openai/gpt-6-luna");
  });
});
