"use client";

import { lazy, Suspense, useCallback, useMemo, useState, type ComponentProps } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { XIcon } from "lucide-react";

import { activityMapTrace, type ActivityMapTrace } from "@/services/activity-map.types.ts";
import { Button } from "@/components/ui/button";

type MapViewComponent = typeof import("./activity-detail-map-view.tsx").ActivityDetailMapView;

// The outline is the fallback, so a chunk that can't download offline still leaves a map card.
const ActivityDetailMapView = lazy(() =>
  import("./activity-detail-map-view.tsx")
    .then((mod) => ({ default: mod.ActivityDetailMapView }))
    .catch(() => ({
      default: ({ trace, color }: ComponentProps<MapViewComponent>) => (
        <ActivityOutline trace={trace} color={color} />
      ),
    })),
);

const DEFAULT_COLOR = "var(--color-ds-blue-700)";

/** The line on a plain background: no map library, no tiles, so it draws at once and offline. */
function ActivityOutline({ trace, color }: { trace: ActivityMapTrace; color: string }) {
  const { path, start, finish, viewBox } = useMemo(() => {
    const lats = trace.coordinates.map(([, lat]) => lat);
    const midLat = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
    // Squash longitude by latitude so the shape matches the map's.
    const project = ([lng, lat]: [number, number]) => [lng * Math.cos(midLat), -lat] as const;
    const points = trace.coordinates.map(project);
    const xs = points.map(([x]) => x);
    const ys = points.map(([, y]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX;
    const height = Math.max(...ys) - minY;
    const pad = Math.max(width, height) * 0.08 || 0.001;
    return {
      path: points.map(([x, y]) => `${x},${y}`).join(" "),
      start: project(trace.start),
      finish: project(trace.finish),
      viewBox: `${minX - pad} ${minY - pad} ${width + pad * 2} ${height + pad * 2}`,
    };
  }, [trace]);

  return (
    <svg viewBox={viewBox} className="bg-muted/40 size-full" aria-hidden>
      <polyline
        points={path}
        fill="none"
        stroke={color}
        strokeWidth={3.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* Zero-length round-capped lines keep the dots a fixed pixel size at any viewBox scale. */}
      {[
        { point: start, color: "var(--color-ds-green-700)" },
        { point: finish, color: "var(--color-ds-gray-1000)" },
      ].map(({ point, color: dot }) =>
        [
          { stroke: "white", width: 12 },
          { stroke: dot, width: 8 },
        ].map(({ stroke, width }) => (
          <line
            key={`${dot}-${width}`}
            x1={point[0]}
            y1={point[1]}
            x2={point[0]}
            y2={point[1]}
            stroke={stroke}
            strokeWidth={width}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        )),
      )}
    </svg>
  );
}

function ActivityMapSurface({
  trace,
  color,
  interactive,
}: {
  trace: ActivityMapTrace;
  color: string;
  interactive: boolean;
}) {
  const [failed, setFailed] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const fail = useCallback(() => setFailed(true), []);
  const outline = <ActivityOutline trace={trace} color={color} />;
  if (failed) return outline;
  return (
    <Suspense fallback={outline}>
      <ActivityDetailMapView trace={trace} color={color} interactive={interactive} onFail={fail} />
    </Suspense>
  );
}

/**
 * Where the activity happened. A still card on the page that opens a pannable map full screen;
 * activities without an outline (indoor sessions) get no card at all.
 */
export function ActivityDetailMap({
  outline,
  title,
  color,
  open,
  onOpenChange,
}: {
  outline: string | null;
  title: string;
  color?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const trace = useMemo(() => activityMapTrace(outline), [outline]);
  if (!trace) return null;
  const lineColor = color ?? DEFAULT_COLOR;

  return (
    <>
      <div className="relative h-50 w-full overflow-hidden rounded-xl border sm:h-80">
        {open ? null : <ActivityMapSurface trace={trace} color={lineColor} interactive={false} />}
        <button
          type="button"
          aria-label="Open the map full screen"
          className="absolute inset-0 z-10 cursor-zoom-in rounded-xl focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => onOpenChange(true)}
        />
      </div>
      <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Popup className="bg-background fixed inset-0 z-50 pb-[env(safe-area-inset-bottom)] outline-none">
            <DialogPrimitive.Title className="sr-only">{title} map</DialogPrimitive.Title>
            <ActivityMapSurface trace={trace} color={lineColor} interactive />
            <DialogPrimitive.Close
              render={
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] z-10 shadow-md"
                />
              }
            >
              <XIcon />
              <span className="sr-only">Close map</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
