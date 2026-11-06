import { Suspense, lazy, useCallback, useEffect, useState, type ComponentProps } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  BikeIcon,
  DownloadIcon,
  InfoIcon,
  MapPinIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  WaypointsIcon,
} from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";
import { downloadGpx } from "@/lib/gpx-download.ts";
import {
  loadRouteBuilderDraft,
  saveRouteBuilderDraft,
  type RouteBuilderDraft,
} from "@/lib/route-builder-draft.ts";
import { cn } from "@/lib/utils";
import type { LngLat } from "@/services/activity-map.types.ts";
import { proposeRoutes } from "@/services/route-builder.ts";
import {
  ROUTE_DISTANCE_KM,
  ZONE_RADIUS_KM,
  confidenceLabel,
  type ProposedRoute,
  type RideDiscipline,
  type RouteBuilderStatus,
  type StretchFit,
} from "@/services/route-builder.types.ts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import { FIT_STYLE } from "./route-builder-style.ts";

// The map is the heavy part; without it (offline, chunk missing) the page still lists the routes.
const RouteBuilderMapView = lazy(() =>
  import("./route-builder-map-view.tsx").then((module) => ({
    default: module.RouteBuilderMapView,
  })),
);

/** Where the map opens for an athlete with no outdoor ride yet, until they tap their own start. */
const FALLBACK_START: LngLat = [2.3522, 48.8566];

const DISCIPLINES: Array<{ id: RideDiscipline; label: string }> = [
  { id: "road", label: "Road" },
  { id: "gravel", label: "Gravel" },
];

function emptyDraft(home: LngLat | null): RouteBuilderDraft {
  return {
    discipline: "road",
    start: home,
    zoneRadiusKm: ZONE_RADIUS_KM.default,
    distanceKm: ROUTE_DISTANCE_KM.default,
    seed: 0,
    routes: [],
    popularityAvailable: true,
    selectedId: null,
  };
}

function useDraft(home: LngLat | null) {
  const [draft, setDraft] = useState<RouteBuilderDraft | null>(null);
  useEffect(() => {
    let live = true;
    void loadRouteBuilderDraft().then((saved) => {
      if (live) setDraft(saved ?? emptyDraft(home));
    });
    return () => {
      live = false;
    };
    // The saved draft wins; home only seeds a first visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (draft) void saveRouteBuilderDraft(draft);
  }, [draft]);
  return [draft, setDraft] as const;
}

function sliderValue(value: number | readonly number[]) {
  return Array.isArray(value) ? value[0]! : (value as number);
}

function formatKm(m: number) {
  return `${(m / 1000).toFixed(1)} km`;
}

function percent(share: number) {
  return `${Math.round(share * 100)} %`;
}

export function RouteBuilder({ status }: { status: RouteBuilderStatus }) {
  const online = useOnline();
  const [draft, setDraft] = useDraft(status.home);
  const [message, setMessage] = useState<string | null>(null);
  const update = useCallback(
    (change: Partial<RouteBuilderDraft>) =>
      // A loop drawn for another start, bike, or distance no longer answers the question, so
      // changing any of them clears the proposals.
      setDraft((current) =>
        current ? { ...current, ...change, routes: [], selectedId: null } : current,
      ),
    [setDraft],
  );

  const propose = useMutation({
    mutationFn: (input: { draft: RouteBuilderDraft; seed: number }) =>
      proposeRoutes({
        data: {
          discipline: input.draft.discipline,
          start: input.draft.start!,
          zoneRadiusKm: input.draft.zoneRadiusKm,
          distanceKm: input.draft.distanceKm,
          seed: input.seed,
        },
      }),
    onSuccess: (result, input) => {
      if (result.status === "ok") {
        setMessage(null);
        setDraft((current) =>
          current
            ? {
                ...current,
                seed: input.seed,
                routes: result.routes,
                popularityAvailable: result.popularityAvailable,
                selectedId: result.routes[0]?.id ?? null,
              }
            : current,
        );
      } else if (result.status === "noRoute") {
        setMessage(result.message);
      } else if (result.status === "unavailable") {
        setMessage("The route builder isn't set up on this server yet.");
      } else {
        setMessage("Sign in again to find routes.");
      }
    },
    onError: () => setMessage("Finding routes failed. Try again in a moment."),
  });

  if (!draft) return <Skeleton className="min-h-80 w-full flex-1 rounded-xl" />;

  const start = draft.start;
  const find = (seed: number) => {
    setMessage(null);
    propose.mutate({ draft, seed });
  };
  const selected = draft.routes.find((route) => route.id === draft.selectedId) ?? null;

  return (
    <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
      <div className="bg-muted/30 relative h-[52svh] min-h-72 overflow-hidden rounded-xl border lg:sticky lg:top-4 lg:order-2 lg:h-[calc(100svh-8rem)]">
        <MapSurface
          start={start}
          center={FALLBACK_START}
          zoneRadiusKm={draft.zoneRadiusKm}
          routes={draft.routes}
          selectedId={draft.selectedId}
          onStartChange={(next) => update({ start: next })}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-3 lg:order-1">
        {!status.available ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>
              The route builder needs a BRouter server, and none is set up here yet.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card size="sm">
          <CardHeader>
            <CardTitle>Your ride</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <ToggleGroup
              variant="outline"
              spacing={0}
              value={[draft.discipline]}
              onValueChange={(next) => {
                const value = DISCIPLINES.find((item) => item.id === next[0]);
                if (value && value.id !== draft.discipline) update({ discipline: value.id });
              }}
              className="w-full"
            >
              {DISCIPLINES.map((item) => (
                <ToggleGroupItem key={item.id} value={item.id} className="h-11 flex-1">
                  <BikeIcon />
                  {item.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>

            <SliderField
              label="Distance"
              value={draft.distanceKm}
              unit="km"
              min={ROUTE_DISTANCE_KM.min}
              max={ROUTE_DISTANCE_KM.max}
              step={5}
              onChange={(distanceKm) => update({ distanceKm })}
            />
            <SliderField
              label="Zone radius"
              value={draft.zoneRadiusKm}
              unit="km"
              min={ZONE_RADIUS_KM.min}
              max={ZONE_RADIUS_KM.max}
              step={1}
              onChange={(zoneRadiusKm) => update({ zoneRadiusKm })}
            />
            {draft.distanceKm > draft.zoneRadiusKm * 4.5 ? (
              <p className="text-muted-foreground text-xs">
                A loop this long rarely fits in this zone. Routes may come out shorter, or leave it.
              </p>
            ) : null}

            <p className="text-muted-foreground flex items-start gap-1.5 text-xs">
              <MapPinIcon aria-hidden className="mt-px size-3.5 shrink-0" />
              {start
                ? "Loops start and finish at the pin. Tap the map or drag the pin to move it."
                : "Tap the map where your loop should start and finish."}
            </p>

            <Button
              size="lg"
              disabled={!start || !online || !status.available || propose.isPending}
              onClick={() => find(draft.seed)}
            >
              {propose.isPending ? <Spinner /> : <WaypointsIcon />}
              {propose.isPending ? "Finding routes…" : "Find routes"}
            </Button>
            {!online ? (
              <p className="text-muted-foreground text-xs">
                Finding routes needs a connection. Saved routes still download.
              </p>
            ) : null}
          </CardContent>
        </Card>

        {message ? (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        ) : null}

        {draft.routes.length ? (
          <>
            {!draft.popularityAvailable ? (
              <Alert variant="info">
                <InfoIcon />
                <AlertDescription>
                  Strava didn't share its popular segments, so confidence comes from OpenStreetMap
                  alone.
                </AlertDescription>
              </Alert>
            ) : null}
            <ul className="flex flex-col gap-2" aria-label="Proposed routes">
              {draft.routes.map((route, index) => (
                <li key={route.id}>
                  <RouteCard
                    route={route}
                    index={index}
                    selected={route.id === draft.selectedId}
                    showPopularity={draft.popularityAvailable}
                    onSelect={() => setDraft({ ...draft, selectedId: route.id })}
                  />
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="lg"
                className="sm:flex-1"
                disabled={!selected}
                onClick={() => {
                  if (!selected) return;
                  const label = selected.discipline === "road" ? "Road" : "Gravel";
                  void downloadGpx(
                    `${label} loop ${Math.round(selected.distanceM / 1000)} km`,
                    selected.coordinates.map(([lng, lat, ele]) => ({ lng, lat, ele })),
                  );
                }}
              >
                <DownloadIcon />
                Download GPX
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="sm:flex-1"
                disabled={!online || !status.available || propose.isPending}
                onClick={() => find((draft.seed + 1) % 1000)}
              >
                <RefreshCwIcon />
                Other routes
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

function SliderField({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  // The value moves with the thumb; the draft (which clears the routes) changes on release.
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums">
          {shown} {unit}
        </span>
      </div>
      <Slider
        aria-label={`${label} in ${unit}`}
        value={[shown]}
        min={min}
        max={max}
        step={step}
        onValueChange={(next) => setShown(sliderValue(next))}
        onValueCommitted={(next) => {
          const committed = sliderValue(next);
          if (committed !== value) onChange(committed);
        }}
        className="py-2"
      />
    </div>
  );
}

const FIT_ORDER: StretchFit[] = ["good", "likely", "uncertain", "unsuitable"];

function RouteCard({
  route,
  index,
  selected,
  showPopularity,
  onSelect,
}: {
  route: ProposedRoute;
  index: number;
  selected: boolean;
  showPopularity: boolean;
  onSelect: () => void;
}) {
  const label = confidenceLabel(route.confidence);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "bg-card flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition-colors",
        selected ? "border-foreground ring-foreground/10 ring-2" : "hover:bg-muted/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">Route {index + 1}</span>
        <Badge
          variant={label === "High" ? "success" : label === "Medium" ? "warning" : "destructive"}
        >
          {label} confidence · {route.confidence}
        </Badge>
      </div>
      <dl className="grid grid-cols-3 gap-2 text-xs">
        {[
          { label: "Distance", value: formatKm(route.distanceM) },
          { label: "Climb", value: `${Math.round(route.climbM)} m` },
          { label: "Unpaved", value: percent(route.shares.unpaved) },
        ].map((stat) => (
          <div key={stat.label} className="bg-muted/50 rounded-md px-2 py-1.5">
            <dt className="text-muted-foreground">{stat.label}</dt>
            <dd className="text-sm font-semibold tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>
      <div
        className="flex h-1.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={FIT_ORDER.map(
          (fit) => `${FIT_STYLE[fit].label} ${percent(route.shares[fit])}`,
        ).join(", ")}
      >
        {FIT_ORDER.map((fit) => (
          <span
            key={fit}
            className={FIT_STYLE[fit].swatch}
            style={{ width: `${route.shares[fit] * 100}%` }}
          />
        ))}
      </div>
      {showPopularity ? (
        <p className="text-muted-foreground text-xs">
          {route.segments.length
            ? `Rides ${route.segments.slice(0, 2).join(", ")}${route.segments.length > 2 ? ` and ${route.segments.length - 2} more popular segments` : ""}.`
            : `${percent(route.shares.popular)} on popular Strava segments.`}
        </p>
      ) : null}
      {route.issues.length ? (
        <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
          {route.issues.map((issue) => (
            <li key={issue.text} className="flex items-start gap-1.5">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 block size-1.5 shrink-0 rounded-full",
                  issue.kind === "unsuitable" ? "bg-ds-red-700" : "bg-ds-amber-700",
                )}
              />
              {issue.text}
            </li>
          ))}
        </ul>
      ) : null}
    </button>
  );
}

type MapViewProps = Omit<ComponentProps<typeof RouteBuilderMapView>, "onFail">;

function MapSurface(props: MapViewProps) {
  const [failed, setFailed] = useState(() => typeof navigator !== "undefined" && !navigator.onLine);
  const fail = useCallback(() => setFailed(true), []);
  const fallback = (
    <div className="text-muted-foreground flex size-full items-center justify-center p-6 text-center text-sm">
      The map needs a connection. Your routes are below.
    </div>
  );
  if (failed) return fallback;
  return (
    <Suspense fallback={<Skeleton className="size-full" />}>
      <RouteBuilderMapView {...props} onFail={fail} />
    </Suspense>
  );
}
