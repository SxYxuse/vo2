import type { StretchFit } from "@/services/route-builder.types.ts";

/** One colour per stretch fit, shared by the map line, its legend, and the share bar. */
export const FIT_STYLE: Record<StretchFit, { label: string; color: string; swatch: string }> = {
  good: { label: "Suits the bike", color: "var(--color-ds-green-700)", swatch: "bg-ds-green-700" },
  likely: { label: "Likely fine", color: "var(--color-ds-teal-700)", swatch: "bg-ds-teal-700" },
  uncertain: { label: "Unsure", color: "var(--color-ds-amber-700)", swatch: "bg-ds-amber-700" },
  unsuitable: { label: "Unsuitable", color: "var(--color-ds-red-700)", swatch: "bg-ds-red-700" },
};
