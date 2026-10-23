/** Resolves a CSS colour token (such as a `var(...)`) to an rgb string MapLibre paint accepts. */
export function resolveThemeColor(token: string) {
  const probe = document.createElement("span");
  probe.style.color = token;
  document.body.append(probe);
  const cssColor = getComputedStyle(probe).color;
  probe.remove();
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return cssColor || token;
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  if (a === 255) return `rgb(${r}, ${g}, ${b})`;
  return `rgba(${r}, ${g}, ${b}, ${Number((a / 255).toFixed(3))})`;
}
