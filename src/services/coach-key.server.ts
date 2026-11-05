import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { defineCredentialStore, type CredentialScope } from "@tanstack/ai/byok";
import { and, eq } from "drizzle-orm";

import { env } from "@/configs/env.ts";
import { db } from "@/db/index.ts";
import { coachKeys } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getRequiredSession } from "@/lib/session.server.ts";
import { COACH_PROVIDER_IDS, type CoachProvider } from "./coach-models.ts";

/**
 * The encryption key lives in the server's environment, never next to the ciphertext in the
 * database. Rotating BETTER_AUTH_SECRET makes stored keys unreadable: athletes add theirs again.
 * Each provider gets its own derived key; OpenRouter's is the one used before ADR 0059.
 */
const sealingKeys = new Map(
  COACH_PROVIDER_IDS.map((provider) => [
    provider,
    Buffer.from(hkdfSync("sha256", env.BETTER_AUTH_SECRET, "vo2-coach-key", provider, 32)),
  ]),
);

function sealingKey(provider: CoachProvider) {
  const key = sealingKeys.get(provider);
  if (!key) throw new Error(`No coach provider ${provider}`);
  return key;
}

function seal(provider: CoachProvider, value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey(provider), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64")).join(".");
}

function open(provider: CoachProvider, sealed: string) {
  const [iv, tag, ciphertext] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", sealingKey(provider), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function isProvider(id: string): id is CoachProvider {
  return (COACH_PROVIDER_IDS as readonly string[]).includes(id);
}

/** One key per athlete and provider; tenants have no row here. */
function rowOf(scope: CredentialScope, id: string) {
  return scope.userId && isProvider(id) ? { userId: scope.userId, provider: id } : null;
}

function whereRow(row: { userId: string; provider: CoachProvider }) {
  return and(eq(coachKeys.userId, row.userId), eq(coachKeys.provider, row.provider));
}

/**
 * TanStack AI's server-side key store, on the coach_keys table (ADR 0036, ADR 0059). Scope
 * always comes from the session, never from a request body.
 */
const coachCredentials = defineCredentialStore({
  async get({ scope, id }) {
    const row = rowOf(scope, id);
    if (!row) return null;
    const [stored] = await db
      .select({ sealed: coachKeys.sealed })
      .from(coachKeys)
      .where(whereRow(row))
      .limit(1);
    if (!stored) return null;
    try {
      return { type: "api_key", value: open(row.provider, stored.sealed) };
    } catch {
      // Sealed under an earlier BETTER_AUTH_SECRET: treat it as missing so the athlete re-adds it.
      logger.warn("coach_key.unreadable", { provider: row.provider });
      return null;
    }
  },
  async set({ scope, id, credential }) {
    const row = rowOf(scope, id);
    if (!row || credential.type !== "api_key") throw new Error("Only an athlete's provider key");
    const values = { sealed: seal(row.provider, credential.value), updatedAt: new Date() };
    await db
      .insert(coachKeys)
      .values({ ...row, ...values })
      .onConflictDoUpdate({ target: [coachKeys.userId, coachKeys.provider], set: values });
  },
  async delete({ scope, id }) {
    const row = rowOf(scope, id);
    if (row) await db.delete(coachKeys).where(whereRow(row));
  },
  async list(scope) {
    if (!scope.userId) return [];
    const rows = await db
      .select({ provider: coachKeys.provider })
      .from(coachKeys)
      .where(eq(coachKeys.userId, scope.userId));
    return rows
      .map((row) => row.provider)
      .filter(isProvider)
      .map((id) => ({ id, type: "api_key" as const }));
  },
});

/** The athlete's key for a provider, or null when they have not added one. */
export async function coachKeyFor(userId: string, provider: CoachProvider) {
  const credential = await coachCredentials.get({ scope: { userId }, id: provider });
  return credential?.type === "api_key" ? credential.value : null;
}

/** When each provider's key was saved, never the key itself, not even masked. */
export async function coachKeysSavedAt(
  userId: string,
): Promise<Partial<Record<CoachProvider, string>>> {
  const rows = await db
    .select({ provider: coachKeys.provider, updatedAt: coachKeys.updatedAt })
    .from(coachKeys)
    .where(eq(coachKeys.userId, userId));
  return Object.fromEntries(
    rows
      .filter((row) => isProvider(row.provider))
      .map((row) => [row.provider, row.updatedAt.toISOString()]),
  );
}

export async function saveCoachKeyImpl(provider: CoachProvider, key: string) {
  const session = await getRequiredSession();
  await coachCredentials.set({
    scope: { userId: session.user.id },
    id: provider,
    credential: { type: "api_key", value: key },
  });
  logger.info("coach_key.saved", { provider });
}

export async function removeCoachKeyImpl(provider: CoachProvider) {
  const session = await getRequiredSession();
  await coachCredentials.delete({ scope: { userId: session.user.id }, id: provider });
  logger.info("coach_key.removed", { provider });
}
