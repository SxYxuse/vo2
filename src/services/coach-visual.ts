/**
 * Theme variables handed to a coach visual. The frame can't see the app's stylesheet, so
 * their computed values are copied in (ADR 0035).
 */
export const VISUAL_THEME_VARIABLES = [
  "--background",
  "--foreground",
  "--muted",
  "--muted-foreground",
  "--card",
  "--card-foreground",
  "--border",
  "--primary",
  "--primary-foreground",
  "--destructive",
  "--radius",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--ds-blue-700",
  "--ds-red-700",
  "--ds-amber-700",
  "--ds-green-700",
  "--ds-teal-700",
  "--ds-purple-700",
  "--ds-pink-700",
  "--ds-gray-700",
] as const;

/** The message a visual posts to its parent with its content height. */
export const VISUAL_HEIGHT_MESSAGE = "vo2-visual-height";

// No source is listed, so the page can fetch or load nothing from anywhere. Only its own
// inline scripts, styles, and data: images run.
const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:";

const REPORT_HEIGHT = `(() => {
  const post = () => parent.postMessage({ type: "${VISUAL_HEIGHT_MESSAGE}", height: Math.ceil(document.body.getBoundingClientRect().height) }, "*");
  const watch = () => new ResizeObserver(post).observe(document.body);
  if (document.body) watch();
  else addEventListener("DOMContentLoaded", watch);
  addEventListener("load", post);
})();`;

function cssValue(value: string) {
  return value.replace(/[<>{};]/g, "");
}

/**
 * The page a coach visual runs as: the no-network policy first, then the theme, a height
 * reporter, and the coach's HTML. A meta refresh is dropped because it would navigate the
 * frame, which the policy can't stop.
 */
export function visualDocument(
  html: string,
  theme: Record<string, string>,
  scheme: "light" | "dark",
) {
  const variables = Object.entries(theme)
    .map(([name, value]) => `${name}: ${cssValue(value)};`)
    .join(" ");
  const body = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/gi, "");
  return [
    "<!doctype html>",
    `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">`,
    '<meta charset="utf-8">',
    `<style>:root { ${variables} color-scheme: ${scheme}; } html, body { margin: 0; background: transparent; color: var(--foreground); font-family: system-ui, sans-serif; font-size: 14px; }</style>`,
    `<script>${REPORT_HEIGHT}</script>`,
    body,
  ].join("\n");
}
