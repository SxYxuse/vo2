import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import type { PowerFileView } from "./power-file-analysis.ts";

export type {
  Pedaling,
  PowerFileView,
  PowerZoneRow,
  Quadrants,
  SidePedaling,
  StrokeAngles,
} from "./power-file-analysis.ts";

/** The synced Strava ride that started within a few minutes of the file (ADR 0056). */
export type MatchedActivity = { id: string; name: string };

export type PowerFileListItem = {
  id: string;
  fileName: string;
  start: string;
  sportType: string;
  distanceM: number | null;
  movingSec: number;
  avgWatts: number;
  normalizedWatts: number | null;
  rightPct: number | null;
  activity: MatchedActivity | null;
};

export type PowerFileDetail = {
  id: string;
  fileName: string;
  importedAt: string;
  activity: MatchedActivity | null;
  analysis: PowerFileView;
};

export type PowerFileImport =
  | { status: "imported" | "duplicate"; id: string }
  | { status: "rejected"; reason: string };

/** A ride's title: the synced ride's name, else the kind of ride and its date. */
export function powerFileTitle(file: { activity: MatchedActivity | null; start: string }) {
  if (file.activity) return file.activity.name;
  const day = new Date(file.start).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  return `Ride · ${day}`;
}

export const listPowerFiles = createServerFn({ method: "GET" }).handler(
  async (): Promise<PowerFileListItem[]> => {
    const { listPowerFilesImpl } = await import("./power-file.server.ts");
    return listPowerFilesImpl();
  },
);

export const getPowerFile = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }): Promise<PowerFileDetail | null> => {
    const { getPowerFileImpl } = await import("./power-file.server.ts");
    return getPowerFileImpl(data.id);
  });

/** Takes the file as form data: a ride's FIT file is a few megabytes of binary. */
export const importPowerFile = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("Expected a file upload");
    return data;
  })
  .handler(async ({ data }): Promise<PowerFileImport> => {
    const { importPowerFileImpl } = await import("./power-file.server.ts");
    return importPowerFileImpl(data);
  });

export const deletePowerFile = createServerFn({ method: "POST" })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }): Promise<void> => {
    const { deletePowerFileImpl } = await import("./power-file.server.ts");
    await deletePowerFileImpl(data.id);
  });
