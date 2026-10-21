import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { activities, athleteMetrics, routePlans } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { getAthleteProfile } from "./athlete-settings.server.ts";
import {
  hasPlanningKit,
  loadFuelCatalog,
  ownedProducts,
  planningProducts,
  type FuelProduct,
} from "./fuel-catalog.ts";
import { chooseSimilarActivities, proposeFuelPlans, reviewPlacement } from "./fuel-ai.server.ts";
import {
  defaultProposals,
  solveFuelPlan,
  swapProduct,
  type FuelPlan,
  type FuelPlanInput,
  type ProposalSpec,
} from "./fuel-plan.ts";
import { buildRouteProfile, GpxError, parseGpx, type RouteProfile } from "./route-gpx.ts";
import {
  predictRoute,
  rankSimilarActivities,
  routeSportGroup,
  type RoutePrediction,
} from "./route-prediction.ts";
import { loadPredictionContext } from "./route-prediction.server.ts";
import {
  profilePoints,
  ROUTE_SPORT_TYPES,
  type RouteDefaults,
  type RoutePlanList,
  type RoutePlanView,
} from "./route-plan.ts";
import { SPORT_GROUPS } from "./sport-groups.ts";

type Chosen = { spec: ProposalSpec; plan: FuelPlan };

async function requireWeight(userId: string) {
  const { weightKg } = await getAthleteProfile(userId);
  // Onboarding asks for it, so this only trips on a profile edited outside the app.
  if (weightKg == null) throw new Error("Add your weight in Settings to plan fuel.");
  return weightKg;
}

async function fuelProductIdsFor(userId: string) {
  const [row] = await db
    .select({ ids: athleteMetrics.fuelProductIds })
    .from(athleteMetrics)
    .where(eq(athleteMetrics.userId, userId))
    .limit(1);
  return row?.ids ?? null;
}

/** The athlete's products; plans are only ever made from these. */
async function requireProducts(userId: string) {
  const products = ownedProducts(await fuelProductIdsFor(userId));
  if (products.length === 0) throw new Error("Choose the MNSTRY products you have first.");
  if (!hasPlanningKit(products)) {
    throw new Error("Choose a drink mix, a jelly or bar, and a gel to plan a route.");
  }
  return products;
}

export async function saveFuelProductsImpl(ids: string[]) {
  const session = await getRequiredSession();
  // Only ids the planner can use are kept, so the stored list never carries unknown products.
  const fuelProductIds = ownedProducts(ids).map((product) => product.id);
  await db
    .insert(athleteMetrics)
    .values({ userId: session.user.id, fuelProductIds, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: athleteMetrics.userId,
      set: { fuelProductIds, updatedAt: new Date() },
    });
  logger.info("fuel_products.saved", { count: fuelProductIds.length });
}

/** Proposals made before the athlete dropped one of their products start over from the defaults. */
function proposalsFor(stored: ProposalSpec[], input: FuelPlanInput) {
  const owned = new Set(input.products.map((product) => product.id));
  const usesMissing = stored.some((spec) =>
    [spec.drinkId, spec.solidId, spec.caffeineId, ...spec.gelIds].some(
      (id) => id != null && !owned.has(id),
    ),
  );
  return usesMissing ? defaultProposals(input) : stored;
}

async function ownedPlan(id: string, userId: string) {
  const [row] = await db
    .select()
    .from(routePlans)
    .where(and(eq(routePlans.id, id), eq(routePlans.userId, userId)))
    .limit(1);
  if (!row) throw new Error("Route not found.");
  return {
    ...row,
    prediction: row.prediction as RoutePrediction,
    proposals: row.proposals as ProposalSpec[],
    chosen: (row.chosen as Chosen | null) ?? null,
  };
}

function planInput(
  prediction: RoutePrediction,
  settings: {
    carbTarget: number;
    bottleCount: number;
    bottleMl: number;
    mixBottleCount: number | null;
  },
  bodyWeightKg: number,
  products: FuelProduct[],
): FuelPlanInput {
  return {
    sportGroup: prediction.sportGroup,
    elapsedSec: prediction.elapsedSec,
    steps: prediction.steps,
    climbs: prediction.climbs,
    carbTarget: settings.carbTarget,
    bottles: { count: settings.bottleCount, ml: settings.bottleMl, mix: settings.mixBottleCount },
    bodyWeightKg,
    products,
  };
}

/** The stored steps are the resampled route, so a new prediction needs no GPX. */
function profileFrom(prediction: RoutePrediction, name: string): RouteProfile {
  return {
    name,
    distanceM: prediction.distanceM,
    gainM: prediction.gainM,
    lossM: prediction.lossM,
    hasElevation: prediction.hasElevation,
    steps: prediction.steps.map(({ distanceM, lengthM, altitudeM, gradePct, lat, lon }) => ({
      distanceM,
      lengthM,
      altitudeM,
      gradePct,
      lat,
      lon,
    })),
  };
}

async function predict(userId: string, profile: RouteProfile, sportType: string) {
  const context = await loadPredictionContext(userId, sportType);
  const ranked = rankSimilarActivities(profile, sportType, context.history, context.now);
  const similar = await chooseSimilarActivities(
    { sportType, distanceM: profile.distanceM, gainM: profile.gainM },
    ranked,
  );
  return predictRoute({ ...context, profile, sportType, similar });
}

export async function listRoutePlansImpl(): Promise<RoutePlanList> {
  const session = await getOptionalSession();
  if (!session) {
    return {
      signedIn: false,
      fuelProductIds: null,
      canPlan: false,
      plans: [],
      defaults: {},
      defaultSportType: "Ride",
    };
  }
  const userId = session.user.id;
  const since = new Date(Date.now() - 90 * 86_400_000);
  const [rows, sportRows, fuelProductIds] = await Promise.all([
    db
      .select({
        id: routePlans.id,
        name: routePlans.name,
        sportType: routePlans.sportType,
        carbTarget: routePlans.carbTarget,
        bottleCount: routePlans.bottleCount,
        bottleMl: routePlans.bottleMl,
        mixBottleCount: routePlans.mixBottleCount,
        distanceM: sql<number>`(${routePlans.prediction}->>'distanceM')::real`,
        gainM: sql<number>`(${routePlans.prediction}->>'gainM')::real`,
        elapsedSec: sql<number>`(${routePlans.prediction}->>'elapsedSec')::real`,
        chosenName: sql<string | null>`${routePlans.chosen}->'spec'->>'name'`,
        createdAt: routePlans.createdAt,
      })
      .from(routePlans)
      .where(eq(routePlans.userId, userId))
      .orderBy(desc(routePlans.createdAt)),
    db
      .select({ sportType: activities.sportType, count: sql<number>`count(*)::int` })
      .from(activities)
      .where(and(eq(activities.userId, userId), gte(activities.startDate, since)))
      .groupBy(activities.sportType),
    fuelProductIdsFor(userId),
  ]);

  const defaults: RouteDefaults = {};
  for (const row of rows) {
    const group = routeSportGroup(row.sportType);
    if (!group || defaults[group]) continue;
    defaults[group] = {
      carbTarget: row.carbTarget,
      bottleCount: row.bottleCount,
      bottleMl: row.bottleMl,
      mixBottleCount: row.mixBottleCount,
    };
  }
  // The canonical sport of the group the athlete does most.
  const byGroup = new Map<string, number>();
  for (const row of sportRows) {
    const group = routeSportGroup(row.sportType);
    if (group) byGroup.set(group, (byGroup.get(group) ?? 0) + row.count);
  }
  const topGroup = [...byGroup.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const canonical = SPORT_GROUPS.find((group) => group.id === topGroup)?.canonical;
  const defaultSportType = ROUTE_SPORT_TYPES.find((type) => type === canonical) ?? "Ride";

  return {
    signedIn: true,
    fuelProductIds,
    canPlan: hasPlanningKit(ownedProducts(fuelProductIds)),
    plans: rows.map((row) => ({
      id: row.id,
      name: row.name,
      sportType: row.sportType,
      distanceM: row.distanceM,
      gainM: row.gainM,
      elapsedSec: row.elapsedSec,
      chosenName: row.chosenName,
      createdAt: row.createdAt.toISOString(),
    })),
    defaults,
    defaultSportType,
  };
}

export async function getRoutePlanImpl(id: string): Promise<RoutePlanView | null> {
  const session = await getRequiredSession();
  const row = await ownedPlan(id, session.user.id).catch(() => null);
  if (!row) return null;
  const weightKg = await requireWeight(session.user.id);
  const products = ownedProducts(await fuelProductIdsFor(session.user.id));
  const input = planInput(row.prediction, row, weightKg, products);
  const { steps, ...prediction } = row.prediction;
  return {
    id: row.id,
    name: row.name,
    sportType: row.sportType,
    carbTarget: row.carbTarget,
    bottleCount: row.bottleCount,
    bottleMl: row.bottleMl,
    mixBottleCount: row.mixBottleCount,
    prediction,
    profile: profilePoints(steps),
    proposals: row.proposals.map((spec) => solveFuelPlan(input, spec)),
    // Plans saved before fluid was planned (sips, refills) are re-solved; the review's moves
    // are lost for those only.
    chosen: row.chosen
      ? "fluid" in row.chosen.plan
        ? row.chosen.plan
        : solveFuelPlan(input, row.chosen.spec)
      : null,
    catalogChanged: row.catalogFetchedAt !== loadFuelCatalog().fetchedAt,
    fuelProductIds: products.map((product) => product.id),
  };
}

export async function createRoutePlanImpl(data: {
  gpx: string;
  name?: string;
  sportType: string;
  carbTarget: number;
  bottleCount: number;
  bottleMl: number;
  mixBottleCount: number | null;
}): Promise<{ id: string }> {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const weightKg = await requireWeight(userId);
  const products = await requireProducts(userId);

  let profile: RouteProfile;
  try {
    profile = buildRouteProfile(parseGpx(data.gpx));
  } catch (error) {
    if (error instanceof GpxError) throw new Error(error.message);
    throw error;
  }
  const prediction = await predict(userId, profile, data.sportType);
  const input = planInput(prediction, data, weightKg, products);
  const proposals = await proposeFuelPlans(input, prediction, defaultProposals(input));

  const id = crypto.randomUUID();
  await db.insert(routePlans).values({
    id,
    userId,
    name: data.name?.trim() || profile.name || "Untitled route",
    sportType: data.sportType,
    carbTarget: data.carbTarget,
    bottleCount: data.bottleCount,
    bottleMl: data.bottleMl,
    mixBottleCount: data.mixBottleCount,
    prediction,
    proposals,
    chosen: null,
    catalogFetchedAt: loadFuelCatalog().fetchedAt,
  });
  logger.info("route_plan.created", {
    distanceKm: Math.round(prediction.distanceM / 1000),
    confidence: prediction.basis.confidence,
    proposals: proposals.length,
  });
  return { id };
}

/** Re-solves the chosen plan after a setting or the prediction changed; swaps are kept. */
function resolveChosen(chosen: Chosen | null, input: FuelPlanInput): Chosen | null {
  return chosen ? { spec: chosen.spec, plan: solveFuelPlan(input, chosen.spec) } : null;
}

export async function updateRoutePlanImpl(data: {
  id: string;
  carbTarget: number;
  bottleCount: number;
  bottleMl: number;
  mixBottleCount: number | null;
}) {
  const session = await getRequiredSession();
  const row = await ownedPlan(data.id, session.user.id);
  const input = planInput(
    row.prediction,
    data,
    await requireWeight(session.user.id),
    await requireProducts(session.user.id),
  );
  await db
    .update(routePlans)
    .set({
      carbTarget: data.carbTarget,
      proposals: proposalsFor(row.proposals, input),
      bottleCount: data.bottleCount,
      bottleMl: data.bottleMl,
      mixBottleCount: data.mixBottleCount,
      chosen: resolveChosen(row.chosen, input),
      catalogFetchedAt: loadFuelCatalog().fetchedAt,
      updatedAt: new Date(),
    })
    .where(eq(routePlans.id, row.id));
}

export async function chooseFuelPlanImpl(id: string, proposalId: string) {
  const session = await getRequiredSession();
  const row = await ownedPlan(id, session.user.id);
  const spec = row.proposals.find((proposal) => proposal.id === proposalId);
  if (!spec) throw new Error("Proposal not found.");
  const input = planInput(
    row.prediction,
    row,
    await requireWeight(session.user.id),
    await requireProducts(session.user.id),
  );
  const plan = await reviewPlacement(input, row.prediction, solveFuelPlan(input, spec));
  await db
    .update(routePlans)
    .set({ chosen: { spec, plan } satisfies Chosen, updatedAt: new Date() })
    .where(eq(routePlans.id, row.id));
}

export async function swapFuelProductImpl(id: string, productId: string, replacementId: string) {
  const session = await getRequiredSession();
  const row = await ownedPlan(id, session.user.id);
  if (!row.chosen) throw new Error("Choose a plan first.");
  const input = planInput(
    row.prediction,
    row,
    await requireWeight(session.user.id),
    await requireProducts(session.user.id),
  );
  const current = planningProducts().find((product) => product.id === productId);
  const plan = swapProduct(input, row.chosen.spec, productId, replacementId, current);
  await db
    .update(routePlans)
    .set({ chosen: { spec: plan.spec, plan } satisfies Chosen, updatedAt: new Date() })
    .where(eq(routePlans.id, row.id));
}

export async function repredictRoutePlanImpl(id: string) {
  const session = await getRequiredSession();
  const row = await ownedPlan(id, session.user.id);
  const prediction = await predict(
    session.user.id,
    profileFrom(row.prediction, row.name),
    row.sportType,
  );
  const input = planInput(
    prediction,
    row,
    await requireWeight(session.user.id),
    await requireProducts(session.user.id),
  );
  await db
    .update(routePlans)
    .set({
      prediction,
      proposals: proposalsFor(row.proposals, input),
      chosen: resolveChosen(row.chosen, input),
      catalogFetchedAt: loadFuelCatalog().fetchedAt,
      updatedAt: new Date(),
    })
    .where(eq(routePlans.id, row.id));
  logger.info("route_plan.repredicted", { confidence: prediction.basis.confidence });
}

export async function deleteRoutePlanImpl(id: string) {
  const session = await getRequiredSession();
  await db
    .delete(routePlans)
    .where(and(eq(routePlans.id, id), eq(routePlans.userId, session.user.id)));
}
