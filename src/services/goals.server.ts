import { eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { goals } from "@/db/schema.ts";
import type { Goal } from "./season.types.ts";

const goalColumns = {
  id: goals.id,
  name: goals.name,
  sportType: goals.sportType,
  date: goals.date,
  distanceM: goals.distanceM,
  elevationGainM: goals.elevationGainM,
  priority: goals.priority,
  effort: goals.effort,
};

export async function goalsFor(userId: string): Promise<Goal[]> {
  const rows = await db.select(goalColumns).from(goals).where(eq(goals.userId, userId));
  return rows as Goal[];
}
