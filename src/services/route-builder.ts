import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import {
  RIDE_DISCIPLINES,
  ROUTE_DISTANCE_KM,
  ZONE_RADIUS_KM,
  type RouteBuilderStatus,
  type RouteProposal,
} from "./route-builder.types.ts";

export const getRouteBuilderStatus = createServerFn({ method: "GET" }).handler(
  async (): Promise<RouteBuilderStatus> => {
    const { loadRouteBuilderStatusImpl } = await import("./route-builder.server.ts");
    return loadRouteBuilderStatusImpl();
  },
);

const routeRequestSchema = z.object({
  discipline: z.enum(RIDE_DISCIPLINES),
  start: z.tuple([z.number().min(-180).max(180), z.number().min(-85).max(85)]),
  zoneRadiusKm: z.number().min(ZONE_RADIUS_KM.min).max(ZONE_RADIUS_KM.max),
  distanceKm: z.number().min(ROUTE_DISTANCE_KM.min).max(ROUTE_DISTANCE_KM.max),
  seed: z.number().int().min(0).max(1000),
});

export const proposeRoutes = createServerFn({ method: "POST" })
  .validator(routeRequestSchema)
  .handler(async ({ data }): Promise<RouteProposal> => {
    const { proposeRoutesImpl } = await import("./route-builder.server.ts");
    return proposeRoutesImpl(data);
  });
