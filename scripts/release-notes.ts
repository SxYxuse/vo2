// Builds the GitHub Release body: an optional AI summary above GitHub's
// generated list. Without a summary the list is the whole body, so a missing
// key or a failed model call never blocks a release.

import { readFile } from "node:fs/promises";

export const SUMMARY_MODEL = "openai/gpt-6-luna";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export function releaseBody({ summary, notes }: { summary: string | null; notes: string }): string {
  if (summary === null) return `${notes}\n`;
  return `${summary}\n\n<details>\n<summary>All changes</summary>\n\n${notes}\n\n</details>\n`;
}

export async function summarizeRelease({
  apiKey,
  notes,
}: {
  apiKey: string | undefined;
  notes: string;
}): Promise<string | null> {
  if (!apiKey) return null;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    // A hung model call must not hold the release until the job times out.
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: SUMMARY_MODEL,
      messages: [
        {
          role: "system",
          content:
            "Summarize these release notes for athletes using the app. Write two or three plain sentences about what changed for them. No headings, no lists, no PR numbers.",
        },
        { role: "user", content: notes },
      ],
    }),
  });
  if (!response.ok) return null;

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content?.trim();
  return content ? content : null;
}

// CLI: `bun scripts/release-notes.ts <generated-notes-file>` prints the body.
if (import.meta.main) {
  const notes = await readFile(process.argv[2], "utf8");
  const summary = await summarizeRelease({
    apiKey: process.env.OPENROUTER_API_KEY,
    notes,
  }).catch(() => null);
  process.stdout.write(releaseBody({ summary, notes }));
}
