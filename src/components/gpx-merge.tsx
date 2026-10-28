"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  ArrowDownIcon,
  ArrowRightLeftIcon,
  ArrowUpIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FileUpIcon,
  Link2Icon,
  Link2OffIcon,
  PlusIcon,
  RotateCcwIcon,
  RouteIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import {
  buildMergedRoute,
  findAllJunctions,
  GpxError,
  junctionStops,
  parseGpx,
  suggestLegs,
  switchAtJunction,
  toGpx,
  trackLength,
  type GpxPoint,
  type Junction,
  type JunctionStop,
  type MergedRoute,
  type MergeLeg,
  type RouteLeg,
} from "@/services/gpx-merge.ts";
import {
  loadGpxMergeDraft,
  saveGpxMergePlan,
  saveGpxMergeTracks,
  type GpxMergePlan,
  type GpxMergeTrack,
} from "@/lib/gpx-merge-draft.ts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

type MapViewComponent = typeof import("./gpx-merge-map-view.tsx").GpxMergeMapView;

// The outline is the fallback, so a chunk that can't download offline still shows the route.
const GpxMergeMapView = lazy(() =>
  import("./gpx-merge-map-view.tsx")
    .then((mod) => ({ default: mod.GpxMergeMapView }))
    .catch(() => ({
      default: ({ tracks, route }: ComponentProps<MapViewComponent>) => (
        <GpxMergeOutline tracks={tracks} route={route} />
      ),
    })),
);

// Red is left out: it marks the straight jumps between legs that don't meet.
const TRACK_COLORS = [
  "var(--color-ds-blue-700)",
  "var(--color-ds-amber-700)",
  "var(--color-ds-purple-700)",
  "var(--color-ds-teal-700)",
  "var(--color-ds-pink-700)",
  "var(--color-ds-green-700)",
];

const DEFAULT_PLAN: GpxMergePlan = { legs: [], toleranceM: 25, name: "" };
const TOLERANCE_MIN_M = 5;
const TOLERANCE_MAX_M = 200;
const SLIDER_STEP_M = 10;
const PLAN_SAVE_DELAY_MS = 300;
// iOS greys out .gpx in the Files picker unless generic XML and binary types are allowed too.
const GPX_ACCEPT = ".gpx,application/gpx+xml,application/xml,text/xml,application/octet-stream";

const newId = () => crypto.randomUUID();

function formatKm(m: number) {
  return `${(m / 1000).toFixed(1)} km`;
}

function formatGap(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : formatKm(m);
}

function fileSlug(name: string) {
  return (
    name
      .replace(/[^\p{L}\p{N}\- ]+/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "merged-route"
  );
}

/** Saves tracks when files change and the plan shortly after edits, flushing when the app is hidden. */
function useDraftSaving(ready: boolean, tracks: GpxMergeTrack[], plan: GpxMergePlan) {
  const savedTracks = useRef<GpxMergeTrack[] | null>(null);
  useEffect(() => {
    if (!ready) return;
    // The first render after loading holds exactly what was loaded.
    if (savedTracks.current === null) {
      savedTracks.current = tracks;
      return;
    }
    if (savedTracks.current === tracks) return;
    savedTracks.current = tracks;
    void saveGpxMergeTracks(tracks);
  }, [ready, tracks]);

  const pending = useRef<GpxMergePlan | null>(null);
  useEffect(() => {
    if (!ready) return;
    pending.current = plan;
    const flush = () => {
      if (!pending.current) return;
      void saveGpxMergePlan(pending.current);
      pending.current = null;
    };
    const timer = window.setTimeout(flush, PLAN_SAVE_DELAY_MS);
    // A backgrounded app may be unloaded before the timer fires.
    const onHide = () => {
      if (document.visibilityState === "hidden") flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [ready, plan]);
  // Leaving the page within the delay still keeps the last edit.
  useEffect(
    () => () => {
      if (pending.current) void saveGpxMergePlan(pending.current);
    },
    [],
  );
}

export function GpxMerge() {
  const [ready, setReady] = useState(false);
  const [tracks, setTracks] = useState<GpxMergeTrack[]>([]);
  const [plan, setPlan] = useState<GpxMergePlan>(DEFAULT_PLAN);
  const [importing, setImporting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const tracksRef = useRef(tracks);
  tracksRef.current = tracks;

  useEffect(() => {
    let cancelled = false;
    void loadGpxMergeDraft().then((draft) => {
      if (cancelled) return;
      setTracks(draft.tracks);
      if (draft.plan) setPlan(draft.plan);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useDraftSaving(ready, tracks, plan);

  // Dragging the meeting distance re-searches every pair of files; let the slider stay smooth.
  const toleranceM = useDeferredValue(plan.toleranceM);
  const junctions = useMemo(() => findAllJunctions(tracks, toleranceM), [toleranceM, tracks]);
  const route = useMemo(() => buildMergedRoute(tracks, plan.legs), [plan.legs, tracks]);
  const mapRoute = useDeferredValue(route);

  const setLegs = useCallback((update: (legs: MergeLeg[]) => MergeLeg[]) => {
    setPlan((current) => ({ ...current, legs: update(current.legs) }));
  }, []);

  const addFiles = async (files: FileList | File[]) => {
    const list = [...files];
    if (!list.length) return;
    setImporting(true);
    const parsed: GpxMergeTrack[] = [];
    const used = new Set(tracksRef.current.map((track) => track.color));
    for (const file of list) {
      try {
        const name = file.name.replace(/\.gpx$/i, "");
        const track = parseGpx(await file.text(), newId(), name);
        const color =
          TRACK_COLORS.find((candidate) => !used.has(candidate)) ??
          TRACK_COLORS[(tracksRef.current.length + parsed.length) % TRACK_COLORS.length]!;
        used.add(color);
        parsed.push({ ...track, color });
      } catch (error) {
        toast.add({
          type: "error",
          title: `Could not read ${file.name}`,
          description: error instanceof GpxError ? error.message : "The file could not be read.",
        });
      }
    }
    setImporting(false);
    if (!parsed.length) return;
    const next = [...tracksRef.current, ...parsed];
    setTracks(next);
    // Until the athlete has a route of their own, offer one through every file.
    setPlan((current) =>
      current.legs.length < 2
        ? {
            ...current,
            legs: suggestLegs(next, findAllJunctions(next, current.toleranceM), newId),
          }
        : current,
    );
  };

  const removeTrack = (id: string) => {
    setTracks((current) => current.filter((track) => track.id !== id));
    setLegs((legs) => legs.filter((leg) => leg.trackId !== id));
  };

  const switchAt = (junction: Junction) => {
    const legs = switchAtJunction(route, tracks, junction, newId);
    if (legs) setLegs(() => legs);
    else
      toast.add({
        type: "info",
        title: "Not on your route",
        description: "No leg passes this meeting point. Extend a leg to reach it first.",
      });
  };

  const addLeg = () => {
    setLegs((legs) => {
      const last = legs.at(-1);
      const lastIndex = tracks.findIndex((track) => track.id === last?.trackId);
      const track = tracks[(lastIndex + 1) % tracks.length]!;
      return [
        ...legs,
        { id: newId(), trackId: track.id, fromM: 0, toM: trackLength(track), linked: !!last },
      ];
    });
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    void addFiles(event.dataTransfer.files);
  };

  const filePicker = (
    <input
      ref={fileInput}
      type="file"
      accept={GPX_ACCEPT}
      multiple
      hidden
      onChange={(event) => {
        const files = [...(event.currentTarget.files ?? [])];
        // Clearing lets the same file be picked again after removing it.
        event.currentTarget.value = "";
        void addFiles(files);
      }}
    />
  );
  const pickFiles = () => fileInput.current?.click();

  if (!ready) return <Skeleton className="min-h-80 w-full flex-1 rounded-xl" />;

  if (!tracks.length) {
    return (
      <Empty
        className={cn("min-h-80 border", dragging && "border-primary bg-primary/5")}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {filePicker}
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <RouteIcon />
          </EmptyMedia>
          <EmptyTitle>Merge GPX routes</EmptyTitle>
          <EmptyDescription>
            Add two or more GPX files that cross or share a road. Pick where to switch from one to
            the next and download the result as a single route.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={pickFiles} disabled={importing}>
            <FileUpIcon />
            {importing ? "Reading…" : "Add GPX files"}
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div
      className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start lg:gap-6"
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
    >
      {filePicker}
      {/* On phones the map stays in view while the legs below are edited. */}
      <div
        className={cn(
          "bg-muted/40 sticky top-0 z-10 h-[38svh] min-h-56 overflow-hidden rounded-xl border lg:order-2 lg:h-[calc(100svh-9rem)]",
          dragging && "ring-primary ring-2",
        )}
      >
        <MapSurface tracks={tracks} route={mapRoute} junctions={junctions} onSwitch={switchAt} />
      </div>
      <div className="flex min-w-0 flex-col gap-3 lg:order-1">
        <FilesCard tracks={tracks} importing={importing} onAdd={pickFiles} onRemove={removeTrack} />
        <MeetingDistanceCard
          toleranceM={plan.toleranceM}
          junctionCount={junctions.length}
          trackCount={tracks.length}
          onChange={(value) => setPlan((current) => ({ ...current, toleranceM: value }))}
        />
        {tracks.length >= 2 ? (
          <>
            <LegsCard
              tracks={tracks}
              plan={plan}
              route={route}
              junctions={junctions}
              onLegsChange={setLegs}
              onSwitch={switchAt}
              onAddLeg={addLeg}
              onReset={() => setLegs(() => suggestLegs(tracks, junctions, newId))}
            />
            <ExportCard
              tracks={tracks}
              plan={plan}
              route={route}
              onNameChange={(name) => setPlan((current) => ({ ...current, name }))}
            />
          </>
        ) : null}
      </div>
    </div>
  );
}

function MapSurface(props: Omit<ComponentProps<MapViewComponent>, "onFail">) {
  const [failed, setFailed] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const fail = useCallback(() => setFailed(true), []);
  const outline = <GpxMergeOutline tracks={props.tracks} route={props.route} />;
  if (failed) return outline;
  return (
    <Suspense fallback={outline}>
      <GpxMergeMapView {...props} onFail={fail} />
    </Suspense>
  );
}

/** The files and the merged route on a plain background: no tiles, so it draws offline. */
function GpxMergeOutline({ tracks, route }: { tracks: GpxMergeTrack[]; route: MergedRoute }) {
  const shape = useMemo(() => {
    const all = tracks.flatMap((track) => track.points);
    if (all.length < 2) return null;
    const lats = all.map((point) => point.lat);
    const midLat = ((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180);
    const project = (point: GpxPoint) => [point.lng * Math.cos(midLat), -point.lat] as const;
    const projected = all.map(project);
    const xs = projected.map(([x]) => x);
    const ys = projected.map(([, y]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const width = Math.max(...xs) - minX;
    const height = Math.max(...ys) - minY;
    const pad = Math.max(width, height) * 0.06 || 0.001;
    const path = (points: GpxPoint[]) => points.map((point) => project(point).join(",")).join(" ");
    return {
      viewBox: `${minX - pad} ${minY - pad} ${width + pad * 2} ${height + pad * 2}`,
      path,
    };
  }, [tracks]);
  if (!shape) return null;
  const colorOf = (trackId: string) =>
    tracks.find((track) => track.id === trackId)?.color ?? TRACK_COLORS[0]!;

  return (
    <svg viewBox={shape.viewBox} className="size-full" aria-hidden>
      {tracks.map((track) => (
        <polyline
          key={track.id}
          points={shape.path(track.points)}
          fill="none"
          stroke={track.color}
          strokeOpacity={0.35}
          strokeWidth={3}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {route.legs.map((leg) => (
        <polyline
          key={leg.id}
          points={shape.path(leg.points)}
          fill="none"
          stroke={colorOf(leg.trackId)}
          strokeWidth={4.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function TrackDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

function FilesCard({
  tracks,
  importing,
  onAdd,
  onRemove,
}: {
  tracks: GpxMergeTrack[];
  importing: boolean;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Files</CardTitle>
        <CardAction>
          <Button variant="outline" size="sm" onClick={onAdd} disabled={importing}>
            <PlusIcon />
            {importing ? "Reading…" : "Add GPX"}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {tracks.map((track) => (
          <div key={track.id} className="flex min-h-10 items-center gap-2">
            <TrackDot color={track.color} />
            <span className="min-w-0 flex-1 truncate font-medium">{track.name}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {formatKm(trackLength(track))}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove ${track.name}`}
              onClick={() => onRemove(track.id)}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        {tracks.length < 2 ? (
          <p className="text-muted-foreground pt-1">
            Add at least one more file that crosses or shares a road with this one.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function MeetingDistanceCard({
  toleranceM,
  junctionCount,
  trackCount,
  onChange,
}: {
  toleranceM: number;
  junctionCount: number;
  trackCount: number;
  onChange: (value: number) => void;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Meeting distance</CardTitle>
        <CardAction className="text-muted-foreground tabular-nums">{toleranceM} m</CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Slider
          aria-label="Meeting distance in metres"
          value={[toleranceM]}
          min={TOLERANCE_MIN_M}
          max={TOLERANCE_MAX_M}
          step={5}
          onValueChange={(value) => onChange(Array.isArray(value) ? value[0]! : (value as number))}
          className="py-2"
        />
        <p className="text-muted-foreground">
          How close two files must pass to count as meeting. Raise it for files drawn on different
          maps or recorded by different devices.
        </p>
        {trackCount >= 2 ? (
          junctionCount ? (
            <p>
              {junctionCount} meeting {junctionCount === 1 ? "point" : "points"} found. Tap one on
              the map to switch there.
            </p>
          ) : (
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertDescription>
                These files never come within {toleranceM} m of each other. Raise the meeting
                distance, or merge anyway: legs that don't meet are joined by a straight line.
              </AlertDescription>
            </Alert>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

function LegsCard({
  tracks,
  plan,
  route,
  junctions,
  onLegsChange,
  onSwitch,
  onAddLeg,
  onReset,
}: {
  tracks: GpxMergeTrack[];
  plan: GpxMergePlan;
  route: MergedRoute;
  junctions: Junction[];
  onLegsChange: (update: (legs: MergeLeg[]) => MergeLeg[]) => void;
  onSwitch: (junction: Junction) => void;
  onAddLeg: () => void;
  onReset: () => void;
}) {
  const update = (id: string, patch: Partial<MergeLeg>) =>
    onLegsChange((legs) => legs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)));
  const move = (index: number, by: -1 | 1) =>
    onLegsChange((legs) => {
      const next = [...legs];
      const [leg] = next.splice(index, 1);
      next.splice(index + by, 0, leg!);
      return next;
    });

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Legs</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcwIcon />
            Suggest
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {plan.legs.length === 0 ? (
          <p className="text-muted-foreground">No legs yet. Add one to start the route.</p>
        ) : null}
        {plan.legs.map((leg, index) => {
          const track = tracks.find((candidate) => candidate.id === leg.trackId);
          const resolved = route.legs.find((candidate) => candidate.id === leg.id);
          if (!track || !resolved) return null;
          return (
            <LegEditor
              key={leg.id}
              index={index}
              count={plan.legs.length}
              leg={leg}
              resolved={resolved}
              track={track}
              tracks={tracks}
              toleranceM={plan.toleranceM}
              stops={junctionStops(junctions, leg.trackId)}
              onChange={(patch) => update(leg.id, patch)}
              onMove={(by) => move(index, by)}
              onRemove={() => onLegsChange((legs) => legs.filter((item) => item.id !== leg.id))}
              onSwitch={onSwitch}
            />
          );
        })}
        <Button variant="outline" onClick={onAddLeg}>
          <PlusIcon />
          Add leg
        </Button>
      </CardContent>
    </Card>
  );
}

function LegEditor({
  index,
  count,
  leg,
  resolved,
  track,
  tracks,
  toleranceM,
  stops,
  onChange,
  onMove,
  onRemove,
  onSwitch,
}: {
  index: number;
  count: number;
  leg: MergeLeg;
  resolved: RouteLeg;
  track: GpxMergeTrack;
  tracks: GpxMergeTrack[];
  toleranceM: number;
  stops: JunctionStop[];
  onChange: (patch: Partial<MergeLeg>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
  onSwitch: (junction: Junction) => void;
}) {
  const length = trackLength(track);
  const linked = leg.linked && index > 0;
  const low = Math.min(resolved.fromM, resolved.toM);
  const high = Math.max(resolved.fromM, resolved.toM);
  // The junction this leg starts from is no place to switch again.
  const ahead = stops.filter(
    (stop) =>
      stop.m > low &&
      stop.m < high &&
      Math.abs(stop.m - resolved.fromM) > toleranceM * 2 &&
      Math.abs(stop.m - resolved.toM) > toleranceM * 2,
  );
  if (resolved.toM < resolved.fromM) ahead.reverse();
  const trackOf = (id: string) => tracks.find((candidate) => candidate.id === id);

  return (
    <section
      aria-label={`Leg ${index + 1}`}
      className="flex flex-col gap-3 rounded-lg border p-3"
      style={{ borderLeftColor: track.color, borderLeftWidth: 4 }}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground shrink-0 font-semibold tabular-nums">
          {index + 1}
        </span>
        <NativeSelect
          className="min-w-0 flex-1"
          aria-label={`Leg ${index + 1} file`}
          value={leg.trackId}
          onChange={(event) => {
            const next = tracks.find((candidate) => candidate.id === event.target.value);
            if (next) onChange({ trackId: next.id, fromM: 0, toM: trackLength(next) });
          }}
        >
          {tracks.map((option) => (
            <NativeSelectOption key={option.id} value={option.id}>
              {option.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon-sm" aria-label={`Leg ${index + 1} actions`} />
            }
          >
            <EllipsisVerticalIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem
              onClick={() => onChange({ fromM: resolved.toM, toM: resolved.fromM, linked: false })}
            >
              <ArrowRightLeftIcon />
              Reverse direction
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUpIcon />
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDownIcon />
              Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onRemove}>
              <Trash2Icon />
              Remove leg
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {linked ? (
        <div className="flex items-center gap-2">
          <Link2Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
          <p className="min-w-0 flex-1">
            From <span className="tabular-nums">{formatKm(resolved.fromM)}</span>, where leg {index}{" "}
            ends
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange({ linked: false, fromM: resolved.fromM })}
          >
            <Link2OffIcon />
            Unlink
          </Button>
        </div>
      ) : (
        <PositionField
          label="From"
          valueM={resolved.fromM}
          lengthM={length}
          onChange={(fromM) => onChange({ fromM })}
          action={
            index > 0 ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Start where leg ${index} ends`}
                onClick={() => onChange({ linked: true })}
              >
                <Link2Icon />
              </Button>
            ) : null
          }
        />
      )}
      <PositionField
        label="To"
        valueM={resolved.toM}
        lengthM={length}
        onChange={(toM) => onChange({ toM })}
      />

      <p className="text-muted-foreground flex flex-wrap items-center gap-x-2">
        <span className="text-foreground font-medium tabular-nums">
          {formatKm(resolved.distanceM)}
        </span>
        {resolved.toM < resolved.fromM ? <span>· ridden backward</span> : null}
        <span>· file is {formatKm(length)}</span>
      </p>

      {index > 0 && resolved.gapM > toleranceM ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertDescription>
            Starts {formatGap(resolved.gapM)} from the end of leg {index}, joined by a straight
            line.
          </AlertDescription>
        </Alert>
      ) : null}

      {ahead.length ? (
        <div className="flex flex-col gap-1.5">
          <p className="text-muted-foreground">Switch along the way</p>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
            {ahead.map((stop) => {
              const other = trackOf(stop.other.trackId);
              return (
                <Button
                  key={stop.junction.id}
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onSwitch(stop.junction)}
                >
                  <span className="tabular-nums">{formatKm(stop.m)}</span>
                  <ArrowRightLeftIcon />
                  {other ? <TrackDot color={other.color} className="size-2" /> : null}
                  <span className="max-w-28 truncate">{other?.name}</span>
                </Button>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** A km position on a file: a slider for the thumb and a field for exact values. */
function PositionField({
  label,
  valueM,
  lengthM,
  onChange,
  action,
}: {
  label: string;
  valueM: number;
  lengthM: number;
  onChange: (valueM: number) => void;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-9 shrink-0">{label}</span>
      <Slider
        aria-label={`${label} position`}
        value={[valueM]}
        min={0}
        max={lengthM}
        step={SLIDER_STEP_M}
        onValueChange={(value) => {
          const m = Array.isArray(value) ? value[0]! : (value as number);
          // Steps rarely land on the file's exact length; the ends must reach it.
          onChange(m >= lengthM - SLIDER_STEP_M ? lengthM : m <= SLIDER_STEP_M ? 0 : m);
        }}
        className="min-w-0 flex-1 py-3"
      />
      <KmInput label={label} valueM={valueM} lengthM={lengthM} onCommit={onChange} />
      {action}
    </div>
  );
}

function KmInput({
  label,
  valueM,
  lengthM,
  onCommit,
}: {
  label: string;
  valueM: number;
  lengthM: number;
  onCommit: (valueM: number) => void;
}) {
  const shown = (valueM / 1000).toFixed(2);
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  const commit = () => {
    setEditing(false);
    const km = Number(text.replace(",", "."));
    if (Number.isFinite(km)) onCommit(Math.min(lengthM, Math.max(0, km * 1000)));
  };
  return (
    <div className="relative w-22 shrink-0">
      <Input
        aria-label={`${label} km`}
        inputMode="decimal"
        value={editing ? text : shown}
        onFocus={(event) => {
          setText(shown);
          setEditing(true);
          event.currentTarget.select();
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
        className="pr-7 text-right tabular-nums"
      />
      <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 -translate-y-1/2">
        km
      </span>
    </div>
  );
}

function ExportCard({
  tracks,
  plan,
  route,
  onNameChange,
}: {
  tracks: GpxMergeTrack[];
  plan: GpxMergePlan;
  route: MergedRoute;
  onNameChange: (name: string) => void;
}) {
  const defaultName = [
    ...new Set(
      route.legs.map((leg) => tracks.find((track) => track.id === leg.trackId)?.name ?? ""),
    ),
  ]
    .filter(Boolean)
    .join(" + ");
  const hasElevation = route.points.some((point) => point.ele !== null);
  const jumps = route.legs.filter((leg, index) => index > 0 && leg.gapM > plan.toleranceM);

  const download = async () => {
    const name = plan.name.trim() || defaultName || "Merged route";
    const file = new File([toGpx(name, route.points)], `${fileSlug(name)}.gpx`, {
      type: "application/gpx+xml",
    });
    // Phones hand the file to the share sheet, so it can go straight to a bike computer app.
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
  };

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Merged route</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Input
          aria-label="Route name"
          placeholder={defaultName || "Merged route"}
          value={plan.name}
          onChange={(event) => onNameChange(event.target.value)}
        />
        <dl className="grid grid-cols-3 gap-2">
          {[
            { label: "Distance", value: formatKm(route.distanceM) },
            { label: "Climb", value: hasElevation ? `${Math.round(route.gainM)} m` : "–" },
            { label: "Descent", value: hasElevation ? `${Math.round(route.lossM)} m` : "–" },
          ].map((stat) => (
            <div key={stat.label} className="bg-muted/50 rounded-md px-2 py-1.5">
              <dt className="text-muted-foreground">{stat.label}</dt>
              <dd className="text-sm font-semibold tabular-nums">{stat.value}</dd>
            </div>
          ))}
        </dl>
        {jumps.length ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>
              {jumps.length === 1 ? "One leg doesn't" : `${jumps.length} legs don't`} meet the leg
              before. The file joins them with a straight line.
            </AlertDescription>
          </Alert>
        ) : null}
        <Button size="lg" disabled={route.points.length < 2} onClick={() => void download()}>
          <DownloadIcon />
          Download GPX
        </Button>
      </CardContent>
    </Card>
  );
}
