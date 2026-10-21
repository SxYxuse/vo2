import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { MAX_CARBS_PER_HOUR, type FuelPlan, type Intake } from "./fuel-plan.ts";
import { MAX_GPX_BYTES } from "./route-gpx.ts";
import type { RoutePrediction, RouteSportGroup } from "./route-prediction.ts";

/** Sports a route can be uploaded for; virtual and e-bike types have no outdoor route. */
export const ROUTE_SPORT_TYPES = [
  "Ride",
  "GravelRide",
  "MountainBikeRide",
  "Run",
  "TrailRun",
  "Walk",
  "Hike",
] as const;

export const BOTTLE_PRESETS_ML = [500, 620, 750] as const;

const bottlesSchema = z.object({
  bottleCount: z.number().int().min(0).max(6),
  bottleMl: z.number().int().min(100).max(1500),
  /** Bottles with drink mix; null lets the plan decide. */
  mixBottleCount: z.number().int().min(1).max(6).nullable(),
});

const mixFits = (data: { bottleCount: number; mixBottleCount: number | null }) =>
  data.mixBottleCount == null || data.mixBottleCount <= data.bottleCount;
const mixFitsMessage = { message: "More bottles with mix than bottles carried." };

export const createRoutePlanSchema = bottlesSchema
  .extend({
    gpx: z.string().min(1).max(MAX_GPX_BYTES),
    name: z.string().trim().max(120).optional(),
    sportType: z.enum(ROUTE_SPORT_TYPES),
    carbTarget: z.number().min(0).max(MAX_CARBS_PER_HOUR),
  })
  .refine(mixFits, mixFitsMessage);

export const updateRoutePlanSchema = bottlesSchema
  .extend({
    id: z.string(),
    carbTarget: z.number().min(0).max(MAX_CARBS_PER_HOUR),
  })
  .refine(mixFits, mixFitsMessage);

const idSchema = z.object({ id: z.string() });

export const fuelProductsSchema = z.object({
  productIds: z.array(z.string()).max(200),
});

export type RoutePlanSummary = {
  id: string;
  name: string;
  sportType: string;
  distanceM: number;
  gainM: number;
  elapsedSec: number;
  chosenName: string | null;
  createdAt: string;
};

/** What the last route of each sport group used, so the next one starts from it. */
export type RouteDefaults = Partial<
  Record<
    RouteSportGroup,
    { carbTarget: number; bottleCount: number; bottleMl: number; mixBottleCount: number | null }
  >
>;

export type RoutePlanList = {
  signedIn: boolean;
  /** MNSTRY products the athlete has; null until they choose. */
  fuelProductIds: string[] | null;
  /** Drink mix + solid + gel: enough to build a proposal. */
  canPlan: boolean;
  plans: RoutePlanSummary[];
  defaults: RouteDefaults;
  defaultSportType: (typeof ROUTE_SPORT_TYPES)[number];
};

export type ProfilePoint = {
  km: number;
  altitudeM: number;
  atSec: number;
  gradePct: number;
  lat: number;
  lon: number;
};

export type TraceSegment = {
  coordinates: [number, number][];
  climb: boolean;
  startSec: number | null;
};

export type RoutePlanView = {
  id: string;
  name: string;
  sportType: string;
  carbTarget: number;
  bottleCount: number;
  bottleMl: number;
  mixBottleCount: number | null;
  prediction: Omit<RoutePrediction, "steps">;
  profile: ProfilePoint[];
  /** Solved from the stored proposals with today's weight and catalog. */
  proposals: FuelPlan[];
  chosen: FuelPlan | null;
  /** The plans were made from an older catalog snapshot than the app ships now. */
  catalogChanged: boolean;
  /** Products the athlete has: swaps offer only these. */
  fuelProductIds: string[];
};

const MAX_PROFILE_POINTS = 400;

/** Thins the route to a few hundred points for the elevation chart and the mini map. */
export function profilePoints(steps: RoutePrediction["steps"]): ProfilePoint[] {
  const every = Math.max(1, Math.ceil(steps.length / MAX_PROFILE_POINTS));
  const points = steps.flatMap((step, index) =>
    index % every === 0 || index === steps.length - 1
      ? [
          {
            km: Math.round(step.distanceM / 10) / 100,
            altitudeM: Math.round(step.altitudeM),
            atSec: step.atSec,
            gradePct: step.gradePct,
            lat: step.lat,
            lon: step.lon,
          },
        ]
      : [],
  );
  return points;
}

/** Round altitude ticks (100, 200 or 500 m apart) that span the profile in about four steps. */
export function elevationTicks(minM: number, maxM: number): number[] {
  const step = [100, 200, 500, 1000].find((size) => (maxM - minM) / size <= 4) ?? 1000;
  const low = Math.floor(minM / step) * step;
  const high = Math.max(low + step, Math.ceil(maxM / step) * step);
  const ticks: number[] = [];
  for (let tick = low; tick <= high; tick += step) ticks.push(tick);
  return ticks;
}

export type IntakeHour = {
  /** Hour from the start: 0 is 0:00-1:00. */
  hour: number;
  /** Everything eaten and sipped that hour. */
  carbsG: number;
  /** Food to take, in order; sips aren't listed one by one. */
  intakes: Intake[];
};

/** The timeline grouped by hour, so the athlete reads "hour 3: 95 g, two gels and a jelly". */
export function intakeHours(intakes: Intake[]): IntakeHour[] {
  const hours = new Map<number, IntakeHour>();
  for (const intake of intakes) {
    const hour = Math.floor(intake.atSec / 3600);
    const entry = hours.get(hour) ?? { hour, carbsG: 0, intakes: [] };
    entry.carbsG += intake.carbsG;
    if (intake.role !== "drink") entry.intakes.push(intake);
    hours.set(hour, entry);
  }
  return [...hours.values()]
    .sort((a, b) => a.hour - b.hour)
    .map((entry) => ({ ...entry, carbsG: Math.round(entry.carbsG) }));
}

export function climbAtKm<T extends { startKm: number; endKm: number }>(
  climbs: T[],
  km: number,
): T | null {
  return climbs.find((climb) => km >= climb.startKm && km <= climb.endKm) ?? null;
}

export function pointAtKm(points: ProfilePoint[], km: number): ProfilePoint | null {
  if (points.length === 0) return null;
  let best = points[0]!;
  let bestDelta = Math.abs(best.km - km);
  for (const point of points) {
    const delta = Math.abs(point.km - km);
    if (delta < bestDelta) {
      best = point;
      bestDelta = delta;
    }
  }
  return best;
}

/** Splits the thinned track into flat vs climb stretches for the map. */
export function traceSegments(
  points: ProfilePoint[],
  climbs: { startKm: number; endKm: number; startSec: number }[],
): TraceSegment[] {
  const located = points.filter(
    (point) => Number.isFinite(point.lat) && Number.isFinite(point.lon),
  );
  if (located.length < 2) return [];
  const segments: TraceSegment[] = [];
  let current: TraceSegment | null = null;
  for (const point of located) {
    const climb = climbAtKm(climbs, point.km);
    const onClimb = climb != null;
    const coord: [number, number] = [point.lon, point.lat];
    if (!current || current.climb !== onClimb || current.startSec !== (climb?.startSec ?? null)) {
      const join: [number, number] | undefined = (current as TraceSegment | null)?.coordinates.at(
        -1,
      );
      current = {
        coordinates: join ? [join, coord] : [coord],
        climb: onClimb,
        startSec: climb?.startSec ?? null,
      };
      segments.push(current);
    } else {
      current.coordinates.push(coord);
    }
  }
  return segments.filter((segment) => segment.coordinates.length >= 2);
}

export const saveFuelProducts = createServerFn({ method: "POST" })
  .validator(fuelProductsSchema)
  .handler(async ({ data }): Promise<void> => {
    const { saveFuelProductsImpl } = await import("./route-plan.server.ts");
    await saveFuelProductsImpl(data.productIds);
  });

export const listRoutePlans = createServerFn({ method: "GET" }).handler(
  async (): Promise<RoutePlanList> => {
    const { listRoutePlansImpl } = await import("./route-plan.server.ts");
    return listRoutePlansImpl();
  },
);

export const getRoutePlan = createServerFn({ method: "GET" })
  .validator(idSchema)
  .handler(async ({ data }): Promise<RoutePlanView | null> => {
    const { getRoutePlanImpl } = await import("./route-plan.server.ts");
    return getRoutePlanImpl(data.id);
  });

export const createRoutePlan = createServerFn({ method: "POST" })
  .validator(createRoutePlanSchema)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { createRoutePlanImpl } = await import("./route-plan.server.ts");
    return createRoutePlanImpl(data);
  });

export const updateRoutePlan = createServerFn({ method: "POST" })
  .validator(updateRoutePlanSchema)
  .handler(async ({ data }): Promise<void> => {
    const { updateRoutePlanImpl } = await import("./route-plan.server.ts");
    await updateRoutePlanImpl(data);
  });

export const chooseFuelPlan = createServerFn({ method: "POST" })
  .validator(idSchema.extend({ proposalId: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    const { chooseFuelPlanImpl } = await import("./route-plan.server.ts");
    await chooseFuelPlanImpl(data.id, data.proposalId);
  });

export const swapFuelProduct = createServerFn({ method: "POST" })
  .validator(idSchema.extend({ productId: z.string(), replacementId: z.string() }))
  .handler(async ({ data }): Promise<void> => {
    const { swapFuelProductImpl } = await import("./route-plan.server.ts");
    await swapFuelProductImpl(data.id, data.productId, data.replacementId);
  });

export const repredictRoutePlan = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }): Promise<void> => {
    const { repredictRoutePlanImpl } = await import("./route-plan.server.ts");
    await repredictRoutePlanImpl(data.id);
  });

export const deleteRoutePlan = createServerFn({ method: "POST" })
  .validator(idSchema)
  .handler(async ({ data }): Promise<void> => {
    const { deleteRoutePlanImpl } = await import("./route-plan.server.ts");
    await deleteRoutePlanImpl(data.id);
  });

type NamedProduct = { id: string; name: string };

/** "2 × 750 ml bottles: 1 POWER CARB (128 g powder, 122 g carbs each), 1 water · 4 × GEL 40 Mango". */
export function carryList(plan: FuelPlan, products: NamedProduct[]): string[] {
  const nameOf = (id: string) => products.find((product) => product.id === id)?.name ?? id;
  const lines: string[] = [];
  const bottles = (plan.drink?.bottles ?? 0) + plan.waterBottles;
  if (bottles > 0) {
    const parts: string[] = [];
    if (plan.drink) {
      const powder =
        plan.drink.powderPerBottleG == null ? "" : `${plan.drink.powderPerBottleG} g powder, `;
      parts.push(
        `${plan.drink.bottles} ${nameOf(plan.drink.productId)} (${powder}${Math.round(plan.drink.carbsPerBottleG)} g carbs each)`,
      );
    }
    if (plan.waterBottles > 0) parts.push(`${plan.waterBottles} water`);
    lines.push(`${bottles} × ${plan.bottleMl} ml bottles: ${parts.join(", ")}`);
  }
  for (const item of plan.items) lines.push(`${item.count} × ${nameOf(item.productId)}`);
  return lines;
}
