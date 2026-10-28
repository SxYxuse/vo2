import { createFileRoute } from "@tanstack/react-router";

import { RouteIcon } from "lucide-react";

import { GpxMerge } from "@/components/gpx-merge.tsx";

if (typeof window !== "undefined") {
  void import("@/components/gpx-merge-map-view.tsx");
}

export const Route = createFileRoute("/_app/merge-gpx")({
  // Files are read and kept on the device, so there is nothing to render on the server.
  ssr: false,
  component: MergeGpxPage,
});

function MergeGpxPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex shrink-0 flex-col gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <RouteIcon aria-hidden className="size-5" />
          Merge GPX
        </h1>
        <p className="text-muted-foreground hidden text-sm sm:block">
          Join routes where they meet. Your files stay on this device.
        </p>
      </div>
      <GpxMerge />
    </div>
  );
}
