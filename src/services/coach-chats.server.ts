import { and, asc, desc, eq, type SQL } from "drizzle-orm";
import type { ModelMessage } from "@tanstack/ai";
import { defineAIPersistence } from "@tanstack/ai-persistence";
import type {
  ChatWithInterruptsPersistence,
  InterruptRecord,
  InterruptStore,
  MessageStore,
  RunRecord,
  RunStore,
} from "@tanstack/ai-persistence";

import { db } from "@/db/index.ts";
import { coachChatInterrupts, coachChatRuns, coachChats } from "@/db/schema.ts";
import type { CoachChatSummary } from "./coach-chats.ts";

const TITLE_LENGTH = 80;

function messageText(message: ModelMessage) {
  const { content } = message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part) => (part.type === "text" ? [part.content] : [])).join(" ");
}

function chatTitle(messages: readonly ModelMessage[]) {
  const first = messages.find((message) => message.role === "user");
  const text = (first ? messageText(first) : "")
    .replace(/\[((?:\\.|[^\]\\])*)\]\([^)]*\)/g, (_link, label: string) =>
      label.replace(/\\(.)/g, "$1"),
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "New chat";
  return text.length > TITLE_LENGTH ? `${text.slice(0, TITLE_LENGTH - 1).trimEnd()}…` : text;
}

function messageStore(userId: string): MessageStore {
  const owned = (threadId: string) =>
    and(eq(coachChats.id, threadId), eq(coachChats.userId, userId));
  return {
    async loadThread(threadId: string) {
      const [row] = await db
        .select({ messages: coachChats.messages })
        .from(coachChats)
        .where(owned(threadId))
        .limit(1);
      return (row?.messages as ModelMessage[] | undefined) ?? [];
    },
    async saveThread(threadId, messages) {
      const now = new Date();
      await db
        .insert(coachChats)
        .values({ id: threadId, userId, title: chatTitle(messages), messages, updatedAt: now })
        .onConflictDoUpdate({
          target: coachChats.id,
          set: { messages, updatedAt: now },
          setWhere: eq(coachChats.userId, userId),
        });
    },
  } as MessageStore;
}

function runStore(userId: string): RunStore {
  const select = async (where: SQL | undefined, order: "asc" | "desc" = "asc", limit?: number) => {
    const query = db
      .select({ record: coachChatRuns.record })
      .from(coachChatRuns)
      .where(and(eq(coachChatRuns.userId, userId), where))
      .orderBy(order === "asc" ? asc(coachChatRuns.startedAt) : desc(coachChatRuns.startedAt));
    const rows = await (limit ? query.limit(limit) : query);
    return rows.map((row) => row.record as RunRecord);
  };
  const get = async (runId: string) =>
    (await select(eq(coachChatRuns.runId, runId), "asc", 1))[0] ?? null;

  return {
    get,
    async createOrResume(input) {
      const existing = await get(input.runId);
      if (existing) return existing;
      const record: RunRecord = { ...input, status: input.status ?? "running" };
      await db
        .insert(coachChatRuns)
        .values({
          runId: record.runId,
          userId,
          threadId: record.threadId,
          status: record.status,
          startedAt: new Date(record.startedAt),
          record,
        })
        .onConflictDoNothing({ target: coachChatRuns.runId });
      return (await get(input.runId)) ?? record;
    },
    async update(runId, patch) {
      const existing = await get(runId);
      if (!existing) return;
      const fields: Record<string, unknown> = { ...existing };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete fields[key];
        else fields[key] = value;
      }
      const record = fields as unknown as RunRecord;
      await db
        .update(coachChatRuns)
        .set({ status: record.status, record })
        .where(and(eq(coachChatRuns.runId, runId), eq(coachChatRuns.userId, userId)));
    },
    async findActiveRun(threadId) {
      const [run] = await select(
        and(eq(coachChatRuns.threadId, threadId), eq(coachChatRuns.status, "running")),
        "desc",
        1,
      );
      return run ?? null;
    },
    listByThread: (threadId) => select(eq(coachChatRuns.threadId, threadId)),
  };
}

function interruptStore(userId: string): InterruptStore {
  const list = async (where: SQL | undefined) => {
    const rows = await db
      .select({ record: coachChatInterrupts.record })
      .from(coachChatInterrupts)
      .where(and(eq(coachChatInterrupts.userId, userId), where))
      .orderBy(asc(coachChatInterrupts.requestedAt));
    return rows.map((row) => row.record as InterruptRecord);
  };
  const get = async (interruptId: string) =>
    (await list(eq(coachChatInterrupts.interruptId, interruptId)))[0] ?? null;
  const finish = async (
    interruptId: string,
    status: "resolved" | "cancelled",
    response?: unknown,
  ) => {
    const existing = await get(interruptId);
    if (!existing) return;
    const record: InterruptRecord = {
      ...existing,
      status,
      resolvedAt: Date.now(),
      ...(response !== undefined ? { response } : {}),
    };
    await db
      .update(coachChatInterrupts)
      .set({ status, record })
      .where(
        and(
          eq(coachChatInterrupts.interruptId, interruptId),
          eq(coachChatInterrupts.userId, userId),
        ),
      );
  };
  const pending = eq(coachChatInterrupts.status, "pending");

  return {
    async create(input) {
      const record: InterruptRecord = { ...input, status: "pending" };
      await db
        .insert(coachChatInterrupts)
        .values({
          interruptId: record.interruptId,
          userId,
          threadId: record.threadId,
          runId: record.runId,
          status: record.status,
          requestedAt: new Date(record.requestedAt),
          record,
        })
        .onConflictDoNothing({ target: coachChatInterrupts.interruptId });
    },
    resolve: (interruptId, response) => finish(interruptId, "resolved", response),
    cancel: (interruptId) => finish(interruptId, "cancelled"),
    get,
    list: (threadId) => list(eq(coachChatInterrupts.threadId, threadId)),
    listPending: (threadId) => list(and(eq(coachChatInterrupts.threadId, threadId), pending)),
    listByRun: (runId) => list(eq(coachChatInterrupts.runId, runId)),
    listPendingByRun: (runId) => list(and(eq(coachChatInterrupts.runId, runId), pending)),
  };
}

export function coachChatPersistence(userId: string): ChatWithInterruptsPersistence {
  return defineAIPersistence({
    stores: {
      messages: messageStore(userId),
      runs: runStore(userId),
      interrupts: interruptStore(userId),
    },
  });
}

export async function chatOwnedByOther(userId: string, threadId: string) {
  const [row] = await db
    .select({ userId: coachChats.userId })
    .from(coachChats)
    .where(eq(coachChats.id, threadId))
    .limit(1);
  return row != null && row.userId !== userId;
}

export async function listCoachChatsFor(userId: string): Promise<CoachChatSummary[]> {
  const rows = await db
    .select({ id: coachChats.id, title: coachChats.title, updatedAt: coachChats.updatedAt })
    .from(coachChats)
    .where(eq(coachChats.userId, userId))
    .orderBy(desc(coachChats.updatedAt))
    .limit(200);
  return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() }));
}

export async function deleteCoachChatFor(userId: string, threadId: string) {
  await db.transaction(async (tx) => {
    const chat = and(eq(coachChats.id, threadId), eq(coachChats.userId, userId));
    const deleted = await tx.delete(coachChats).where(chat).returning({ id: coachChats.id });
    if (!deleted.length) return;
    await tx
      .delete(coachChatRuns)
      .where(and(eq(coachChatRuns.threadId, threadId), eq(coachChatRuns.userId, userId)));
    await tx
      .delete(coachChatInterrupts)
      .where(
        and(eq(coachChatInterrupts.threadId, threadId), eq(coachChatInterrupts.userId, userId)),
      );
  });
}
