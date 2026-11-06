import { toGpx, type GpxPoint } from "@/services/gpx-merge.ts";

function fileSlug(name: string) {
  return (
    name
      .replace(/[^\p{L}\p{N}\- ]+/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "route"
  );
}

/** Saves a route as GPX: phones hand it to the share sheet, so it can go straight to a bike computer app. */
export async function downloadGpx(name: string, points: GpxPoint[]) {
  const file = new File([toGpx(name, points)], `${fileSlug(name)}.gpx`, {
    type: "application/gpx+xml",
  });
  if (window.matchMedia("(pointer: coarse)").matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
