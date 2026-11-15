import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/index.ts";
import { timeOuts } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getOptionalSession, getRequiredSession } from "@/lib/session.server.ts";
import { addDayKey, dayKey, weekStartKey } from "./day-key.ts";
import {
  timeOutProblem,
  timeOutStartWindow,
  type TimeOut,
  type TimeOutInput,
  type TimeOutsData,
} from "./time-outs.ts";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const columns = {
  id: timeOuts.id,
  kind: timeOuts.kind,
  start: timeOuts.startDay,
  end: timeOuts.endDay,
};

/** The athlete's time outs, oldest first. */
export function timeOutsFor(userId: string, tx: Tx | typeof db = db): Promise<TimeOut[]> {
  return tx
    .select(columns)
    .from(timeOuts)
    .where(eq(timeOuts.userId, userId))
    .orderBy(asc(timeOuts.startDay));
}

export async function listTimeOutsImpl(): Promise<TimeOutsData> {
  const session = await getOptionalSession();
  if (!session) return { signedIn: false, timeOuts: [] };
  return { signedIn: true, timeOuts: await timeOutsFor(session.user.id) };
}

function startWindow(timeZone: string) {
  const now = new Date();
  return timeOutStartWindow(dayKey(now, timeZone), weekStartKey(now, timeZone));
}

/**
 * Checks the athlete's other time outs and writes in one transaction, with their rows locked, so
 * an edit and a save at once can't both pass the overlap check.
 */
async function writeChecked(
  userId: string,
  check: (others: TimeOut[], current: TimeOut | undefined) => string | null,
  write: (tx: Tx) => Promise<unknown>,
  id?: string,
) {
  await db.transaction(async (tx) => {
    const all = await tx
      .select(columns)
      .from(timeOuts)
      .where(eq(timeOuts.userId, userId))
      .for("update");
    const problem = check(
      all.filter((timeOut) => timeOut.id !== id),
      all.find((timeOut) => timeOut.id === id),
    );
    if (problem) throw new Error(problem);
    await write(tx);
  });
}

/**
 * Every write to a time out makes the coach plan's writing due, or pauses it while one is open,
 * as a load of Plan would; nothing happens under another planning style (ADR 0066). Imported
 * here, since the coach plan reads time outs from this module.
 */
async function replan(userId: string) {
  const { startCoachPlanIfDue } = await import("./coach-plan.server.ts");
  await startCoachPlanIfDue(userId);
}

export async function createTimeOutImpl({ timeZone, ...data }: TimeOutInput) {
  const session = await getRequiredSession();
  const userId = session.user.id;
  await writeChecked(
    userId,
    (others) => timeOutProblem(data, others, startWindow(timeZone)),
    (tx) =>
      tx.insert(timeOuts).values({
        id: crypto.randomUUID(),
        userId,
        kind: data.kind,
        startDay: data.start,
        endDay: data.end,
      }),
  );
  logger.info("time_out.created", { kind: data.kind, open: data.end == null });
  await replan(userId);
}

export async function updateTimeOutImpl({ id, timeZone, ...data }: TimeOutInput & { id: string }) {
  const session = await getRequiredSession();
  const userId = session.user.id;
  await writeChecked(
    userId,
    (others, current) => {
      if (!current) return "Those days are no longer marked.";
      const window = current.start === data.start ? null : startWindow(timeZone);
      return timeOutProblem(data, others, window);
    },
    (tx) =>
      tx
        .update(timeOuts)
        .set({ kind: data.kind, startDay: data.start, endDay: data.end, updatedAt: new Date() })
        .where(and(eq(timeOuts.id, id), eq(timeOuts.userId, userId))),
    id,
  );
  logger.info("time_out.updated", { kind: data.kind, open: data.end == null });
  await replan(userId);
}

export async function endTimeOutImpl(id: string, timeZone: string) {
  const session = await getRequiredSession();
  const userId = session.user.id;
  const today = dayKey(new Date(), timeZone);
  const where = and(eq(timeOuts.id, id), eq(timeOuts.userId, userId));
  const [current] = await db.select(columns).from(timeOuts).where(where);
  if (!current || (current.end != null && current.end < today)) return;
  // A time out from today on held no day yet, so being back means it never happened.
  if (current.start >= today) {
    await db.delete(timeOuts).where(where);
  } else {
    await db
      .update(timeOuts)
      .set({ endDay: addDayKey(today, -1), updatedAt: new Date() })
      .where(where);
  }
  logger.info("time_out.ended", { kind: current.kind, deleted: current.start >= today });
  await replan(userId);
}

export async function deleteTimeOutImpl(id: string) {
  const session = await getRequiredSession();
  await db.delete(timeOuts).where(and(eq(timeOuts.id, id), eq(timeOuts.userId, session.user.id)));
  logger.info("time_out.deleted");
  await replan(session.user.id);
}
