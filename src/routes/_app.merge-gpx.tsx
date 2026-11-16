import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header.tsx";
import { RouteIcon } from "lucide-react";

import { GpxMerge } from "@/components/gpx-merge.tsx";

if (typeof window !== "undefined") {
  void import("@/components/gpx-merge-map-view.tsx");
}

export const Route = createFileRoute("/_app/merge-gpx")({
  ssr: false,
  component: MergeGpxPage,
});

function MergeGpxPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader icon={RouteIcon} title="Merge GPX" />
      <GpxMerge />
    </div>
  );
}
