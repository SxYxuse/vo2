import { describe, expect, test } from "vite-plus/test";

import { visualDocument } from "./coach-visual.ts";

const theme = { "--foreground": "oklch(0.2 0 0)", "--chart-1": "#0070f3" };

describe("visual document", () => {
  test("blocks the network before any of the coach's HTML is read", () => {
    const html = visualDocument('<img src="https://example.com/x.png">', theme, "light");
    const policy = html.indexOf('http-equiv="Content-Security-Policy"');
    expect(policy).toBeGreaterThan(-1);
    expect(policy).toBeLessThan(html.indexOf("example.com"));
    expect(html).toContain("default-src 'none'");
    expect(html).not.toMatch(/content="[^"]*https?:/);
  });

  test("gives the coach's HTML the app's theme as CSS variables", () => {
    const html = visualDocument("<svg></svg>", theme, "dark");
    expect(html).toContain("--chart-1: #0070f3;");
    expect(html).toContain("color-scheme: dark");
  });

  test("drops a meta refresh, which would navigate the frame away", () => {
    const html = visualDocument(
      '<meta http-equiv="refresh" content="0;url=https://example.com/?d=1"><p>Hi</p>',
      theme,
      "light",
    );
    expect(html).not.toMatch(/http-equiv=["']?refresh/i);
    expect(html).toContain("<p>Hi</p>");
  });

  test("a theme value cannot close the style tag", () => {
    const html = visualDocument("<p>Hi</p>", { "--foreground": "red</style><script>" }, "light");
    expect(html).not.toContain("red</style><script>");
  });
});
