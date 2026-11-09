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
  ArrowRightLeftIcon,
  DownloadIcon,
  FileUpIcon,
  Link2Icon,
  Link2OffIcon,
  PlusIcon,
  RotateCcwIcon,
  RouteIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";

import {
  addLeg,
  buildMergedRoute,
  changeLegTrack,
  findAllJunctions,
  GpxError,
  junctionStops,
  legDirection,
  parseGpx,
  planLegs,
  removeLeg,
  stopsAhead,
  suggestLegs,
  switchAtJunction,
  switchLegAt,
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
import { downloadGpx } from "@/lib/gpx-download.ts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
// A position this close to a meeting point or a file end is shown as that place.
const SAME_PLACE_M = 1;
// iOS greys out .gpx in the Files picker unless generic XML and binary types are allowed too.
const GPX_ACCEPT = ".gpx,application/gpx+xml,application/xml,text/xml,application/octet-stream";

const newId = () => crypto.randomUUID();

function formatKm(m: number) {
  return `${(m / 1000).toFixed(1)} km`;
}

function formatGap(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : formatKm(m);
}

/** The meeting point the leg starts from is no place to switch again. */
const switchMargin = (toleranceM: number) => toleranceM * 2;

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
  const marginM = switchMargin(toleranceM);

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
            Add two or more GPX files that cross or share a road. You then pick where to switch from
            one file to the next, and download the result as one GPX.
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
      {/* On phones the map stays in view while the route below is edited. */}
      <div
        className={cn(
          "bg-muted/40 sticky top-0 z-10 h-[38svh] min-h-56 overflow-hidden rounded-xl border lg:order-2 lg:h-[calc(100svh-9rem)]",
          dragging && "ring-primary ring-2",
        )}
      >
        <MapSurface tracks={tracks} route={mapRoute} junctions={junctions} onSwitch={switchAt} />
      </div>
      <div className="flex min-w-0 flex-col gap-3 lg:order-1">
        <FilesCard
          tracks={tracks}
          importing={importing}
          toleranceM={plan.toleranceM}
          junctionCount={junctions.length}
          onAdd={pickFiles}
          onRemove={removeTrack}
          onToleranceChange={(value) => setPlan((current) => ({ ...current, toleranceM: value }))}
        />
        {tracks.length >= 2 ? (
          <>
            <RouteCard
              tracks={tracks}
              route={route}
              junctions={junctions}
              toleranceM={toleranceM}
              onPatch={(id, patch) =>
                setLegs((legs) => legs.map((leg) => (leg.id === id ? { ...leg, ...patch } : leg)))
              }
              onTrack={(index, trackId) =>
                setLegs(() => changeLegTrack(route, index, trackId, tracks, junctions, marginM))
              }
              onSwitchAt={(index, stop) =>
                setLegs(() => switchLegAt(planLegs(route), index, stop, tracks))
              }
              onRemove={(index) => setLegs(() => removeLeg(route, index, tracks))}
              onAdd={() => setLegs(() => addLeg(route, tracks, junctions, marginM, newId))}
              onReset={() => setLegs(() => suggestLegs(tracks, junctions, newId))}
            />
            <DownloadCard
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
  toleranceM,
  junctionCount,
  onAdd,
  onRemove,
  onToleranceChange,
}: {
  tracks: GpxMergeTrack[];
  importing: boolean;
  toleranceM: number;
  junctionCount: number;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onToleranceChange: (value: number) => void;
}) {
  const [adjusting, setAdjusting] = useState(false);
  // Files that never meet need the setting, so it stays open with the reason.
  const apart = junctionCount === 0;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Add your files</CardTitle>
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
        ) : (
          <>
            {apart ? (
              <Alert variant="warning" className="mt-1">
                <TriangleAlertIcon />
                <AlertDescription>
                  These files never come within {toleranceM} m of each other. Raise the distance
                  below, or carry on: the route will jump between them in a straight line.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="flex min-h-10 items-center gap-2">
                <p className="text-muted-foreground min-w-0 flex-1">
                  {junctionCount} meeting {junctionCount === 1 ? "point" : "points"} found
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={adjusting}
                  onClick={() => setAdjusting((open) => !open)}
                >
                  <SlidersHorizontalIcon />
                  {adjusting ? "Done" : "Adjust"}
                </Button>
              </div>
            )}
            {adjusting || apart ? (
              <div className="flex flex-col gap-2 pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span>Files meet within</span>
                  <span className="text-muted-foreground tabular-nums">{toleranceM} m</span>
                </div>
                <Slider
                  aria-label="Meeting distance in metres"
                  value={[toleranceM]}
                  min={TOLERANCE_MIN_M}
                  max={TOLERANCE_MAX_M}
                  step={5}
                  onValueChange={(value) =>
                    onToleranceChange(Array.isArray(value) ? value[0]! : (value as number))
                  }
                  className="py-2"
                />
                <p className="text-muted-foreground">
                  How close two files must pass to count as meeting. Raise it for files drawn on
                  different maps or recorded by different devices.
                </p>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

type Place = { value: string; label: string; m: number; stop?: JunctionStop };

const KIND_VERB = { cross: "Crosses", join: "Joins", split: "Leaves" } as const;
const KIND_NOUN = {
  cross: "Crossing",
  join: "Where they join",
  split: "Where they split",
} as const;

/** Shows the place matching `m`, or `fallback` when it matches none (fine-tuned by hand). */
function PlaceSelect({
  label,
  places,
  m,
  fallback = `km ${(m / 1000).toFixed(1)} (adjusted)`,
  onPick,
}: {
  label: string;
  places: Place[];
  m: number;
  fallback?: string;
  onPick: (place: Place) => void;
}) {
  const current = places.find((place) => Math.abs(place.m - m) < SAME_PLACE_M);
  return (
    <NativeSelect
      className="min-w-0 flex-1"
      aria-label={label}
      value={current?.value ?? "adjusted"}
      onChange={(event) => {
        const place = places.find((candidate) => candidate.value === event.target.value);
        if (place) onPick(place);
      }}
    >
      {current ? null : (
        <NativeSelectOption value="adjusted" disabled>
          {fallback}
        </NativeSelectOption>
      )}
      {places.map((place) => (
        <NativeSelectOption key={place.value} value={place.value}>
          {place.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

function RouteCard({
  tracks,
  route,
  junctions,
  toleranceM,
  onPatch,
  onTrack,
  onSwitchAt,
  onRemove,
  onAdd,
  onReset,
}: {
  tracks: GpxMergeTrack[];
  route: MergedRoute;
  junctions: Junction[];
  toleranceM: number;
  onPatch: (id: string, patch: Partial<MergeLeg>) => void;
  onTrack: (index: number, trackId: string) => void;
  onSwitchAt: (index: number, stop: JunctionStop) => void;
  onRemove: (index: number) => void;
  onAdd: () => void;
  onReset: () => void;
}) {
  const trackOf = (id: string) => tracks.find((track) => track.id === id);
  const last = route.legs.at(-1);
  const lastTrack = last ? trackOf(last.trackId) : undefined;

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Plan your route</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcwIcon />
            Start over
          </Button>
        </CardAction>
        <CardDescription>
          Choose where to switch files below, or tap a meeting point on the map.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <ol className="flex flex-col">
          {route.legs.map((leg, index) => {
            const track = trackOf(leg.trackId);
            if (!track) return null;
            const previous = route.legs[index - 1];
            return (
              <RouteStep
                key={leg.id}
                index={index}
                leg={leg}
                track={track}
                previous={previous}
                previousTrack={previous ? trackOf(previous.trackId) : undefined}
                tracks={tracks}
                junctions={junctions}
                toleranceM={toleranceM}
                onPatch={(patch) => onPatch(leg.id, patch)}
                onTrack={(trackId) => onTrack(index, trackId)}
                onSwitchAt={(stop) => onSwitchAt(index, stop)}
                onRemove={index > 0 ? () => onRemove(index) : undefined}
              />
            );
          })}
          {last && lastTrack ? (
            <FinishStep
              leg={last}
              track={lastTrack}
              tracks={tracks}
              junctions={junctions}
              toleranceM={toleranceM}
              onPick={(toM) => onPatch(last.id, { toM })}
            />
          ) : null}
        </ol>
        <Button variant="outline" onClick={onAdd}>
          <PlusIcon />
          Add a switch
        </Button>
      </CardContent>
    </Card>
  );
}

/** One file in the route: where it is joined, how far it is followed, and its fine-tuning. */
function RouteStep({
  index,
  leg,
  track,
  previous,
  previousTrack,
  tracks,
  junctions,
  toleranceM,
  onPatch,
  onTrack,
  onSwitchAt,
  onRemove,
}: {
  index: number;
  leg: RouteLeg;
  track: GpxMergeTrack;
  previous: RouteLeg | undefined;
  previousTrack: GpxMergeTrack | undefined;
  tracks: GpxMergeTrack[];
  junctions: Junction[];
  toleranceM: number;
  onPatch: (patch: Partial<MergeLeg>) => void;
  onTrack: (trackId: string) => void;
  onSwitchAt: (stop: JunctionStop) => void;
  onRemove: (() => void) | undefined;
}) {
  const [adjusting, setAdjusting] = useState(false);
  const length = trackLength(track);
  const direction = legDirection(leg);
  const nameOf = (id: string) => tracks.find((candidate) => candidate.id === id)?.name ?? "";

  let where: ReactNode;
  if (!previous || !previousTrack) {
    // The first file can start at its own start or at any meeting point along it.
    const places: Place[] = [
      { value: "start", label: "Start of file", m: 0 },
      ...junctionStops(junctions, track.id).map((stop) => ({
        value: stop.junction.id,
        label: `${KIND_VERB[stop.junction.kind]} ${nameOf(stop.other.trackId)}, km ${(stop.m / 1000).toFixed(1)}`,
        m: stop.m,
      })),
    ];
    where = (
      <StepRow label="from">
        <PlaceSelect
          label="Where the route starts"
          places={places}
          m={leg.fromM}
          onPick={({ m }) => {
            // A start past the finish rides on to the file's end instead of turning back.
            const pastFinish = (leg.toM - m) * direction <= 0;
            onPatch(pastFinish ? { fromM: m, toM: direction > 0 ? length : 0 } : { fromM: m });
          }}
        />
      </StepRow>
    );
  } else {
    const stops = junctionStops(junctions, previous.trackId).filter(
      (stop) => stop.other.trackId === track.id,
    );
    const ahead = stopsAhead(stops, previous, switchMargin(toleranceM));
    // The meeting point it switches at now, even when it is no longer ahead.
    const here = leg.linked
      ? stops.find((stop) => Math.abs(stop.m - previous.toM) < SAME_PLACE_M)
      : undefined;
    const choices = here && !ahead.includes(here) ? [here, ...ahead] : ahead;
    const places: Place[] = choices.map((stop) => ({
      value: stop.junction.id,
      label: `${KIND_NOUN[stop.junction.kind]}, km ${(stop.m / 1000).toFixed(1)}`,
      m: stop.m,
      stop,
    }));
    where = choices.length ? (
      <StepRow label="at">
        <PlaceSelect
          label={`Where to switch from ${previousTrack.name} to ${track.name}`}
          places={places}
          m={leg.linked ? previous.toM : Number.NaN}
          fallback={
            leg.linked
              ? `km ${(previous.toM / 1000).toFixed(1)} (adjusted)`
              : "Choose a meeting point"
          }
          onPick={({ stop }) => stop && onSwitchAt(stop)}
        />
      </StepRow>
    ) : null;
  }

  const jump = previous && leg.gapM > toleranceM;

  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3">
      <div className="flex flex-col items-center pt-2">
        <span
          aria-hidden
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-[0.625rem] font-semibold text-white"
          style={{ backgroundColor: track.color }}
        >
          {index + 1}
        </span>
        <span
          aria-hidden
          className="my-1 w-1 flex-1 rounded-full opacity-60"
          style={{ backgroundColor: track.color }}
        />
      </div>
      <div className="flex min-w-0 flex-col gap-2 pb-4">
        <StepRow label={index === 0 ? "Start on" : "Switch to"}>
          <NativeSelect
            className="min-w-0 flex-1"
            aria-label={index === 0 ? "File the route starts on" : `File to switch to`}
            value={track.id}
            onChange={(event) => onTrack(event.target.value)}
          >
            {tracks.map((option) => (
              <NativeSelectOption key={option.id} value={option.id}>
                {option.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </StepRow>
        {where}
        {jump && previousTrack ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>
              {track.name} doesn't meet {previousTrack.name} ahead, so the route jumps{" "}
              {formatGap(leg.gapM)} in a straight line here.
            </AlertDescription>
          </Alert>
        ) : null}
        <div className="text-muted-foreground flex min-h-8 items-center gap-2">
          <p className="min-w-0 flex-1">
            <span className="text-foreground font-medium tabular-nums">
              {formatKm(leg.distanceM)}
            </span>{" "}
            on {track.name}
            {direction < 0 ? ", ridden backward" : null}
          </p>
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={adjusting}
            onClick={() => setAdjusting((open) => !open)}
          >
            <SlidersHorizontalIcon />
            {adjusting ? "Done" : "Adjust"}
          </Button>
        </div>
        {adjusting ? (
          <div className="bg-muted/40 flex flex-col gap-3 rounded-lg p-3">
            {previous && previousTrack && leg.linked ? (
              <div className="flex items-center gap-2">
                <Link2Icon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                <p className="min-w-0 flex-1">Starts where {previousTrack.name} ends</p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onPatch({ linked: false, fromM: leg.fromM })}
                >
                  <Link2OffIcon />
                  Start elsewhere
                </Button>
              </div>
            ) : (
              <PositionField
                label="From"
                valueM={leg.fromM}
                lengthM={length}
                onChange={(fromM) => onPatch({ fromM })}
                action={
                  previous && previousTrack ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Start where ${previousTrack.name} ends`}
                      onClick={() => onPatch({ linked: true })}
                    >
                      <Link2Icon />
                    </Button>
                  ) : null
                }
              />
            )}
            <PositionField
              label="To"
              valueM={leg.toM}
              lengthM={length}
              onChange={(toM) => onPatch({ toM })}
            />
            <p className="text-muted-foreground">Positions are km along {track.name}.</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onPatch({ fromM: leg.toM, toM: leg.fromM, linked: false })}
              >
                <ArrowRightLeftIcon />
                Reverse direction
              </Button>
              {onRemove ? (
                <Button variant="ghost" size="sm" className="text-destructive" onClick={onRemove}>
                  <Trash2Icon />
                  Remove this switch
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}

function FinishStep({
  leg,
  track,
  tracks,
  junctions,
  toleranceM,
  onPick,
}: {
  leg: RouteLeg;
  track: GpxMergeTrack;
  tracks: GpxMergeTrack[];
  junctions: Junction[];
  toleranceM: number;
  onPick: (toM: number) => void;
}) {
  const forward = legDirection(leg) > 0;
  const nameOf = (id: string) => tracks.find((candidate) => candidate.id === id)?.name ?? "";
  const ahead = stopsAhead(
    junctionStops(junctions, track.id),
    { fromM: leg.fromM, toM: leg.toM },
    switchMargin(toleranceM),
  );
  const places: Place[] = [
    ...ahead.map((stop) => ({
      value: stop.junction.id,
      label: `${KIND_VERB[stop.junction.kind]} ${nameOf(stop.other.trackId)}, km ${(stop.m / 1000).toFixed(1)}`,
      m: stop.m,
    })),
    forward
      ? { value: "end", label: `End of ${track.name}`, m: trackLength(track) }
      : { value: "end", label: `Start of ${track.name}`, m: 0 },
  ];

  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3 pb-3">
      <span aria-hidden className="flex size-5 items-center justify-center">
        <span className="bg-ds-gray-1000 block size-3.5 rounded-full border-2 border-white shadow" />
      </span>
      <StepRow label="Finish at">
        <PlaceSelect
          label="Where the route finishes"
          places={places}
          m={leg.toM}
          onPick={({ m }) => onPick(m)}
        />
      </StepRow>
    </li>
  );
}

function StepRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground w-16 shrink-0">{label}</span>
      {children}
    </div>
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

function DownloadCard({
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

  const download = () =>
    downloadGpx(plan.name.trim() || defaultName || "Merged route", route.points);

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Download</CardTitle>
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
              The route jumps in a straight line{" "}
              {jumps.length === 1 ? "once" : `${jumps.length} times`} where files don't meet. Check
              it on the map before riding it.
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
