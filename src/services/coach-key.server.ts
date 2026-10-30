import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { defineCredentialStore, type CredentialScope } from "@tanstack/ai/byok";
import { eq } from "drizzle-orm";

import { env } from "@/configs/env.ts";
import { db } from "@/db/index.ts";
import { coachKeys } from "@/db/schema.ts";
import { logger } from "@/lib/logger.server.ts";
import { getRequiredSession } from "@/lib/session.server.ts";
import { OPENROUTER } from "./coach-models.ts";

/**
 * The encryption key lives in the server's environment, never next to the ciphertext in the
 * database. Rotating BETTER_AUTH_SECRET makes stored keys unreadable: athletes add theirs again.
 */
const sealingKey = Buffer.from(
  hkdfSync("sha256", env.BETTER_AUTH_SECRET, "vo2-coach-key", OPENROUTER, 32),
);

function seal(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", sealingKey, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64")).join(".");
}

function open(sealed: string) {
  const [iv, tag, ciphertext] = sealed.split(".").map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", sealingKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** One OpenRouter key per athlete; tenants and other providers have no row here. */
function athleteOf(scope: CredentialScope, id: string) {
  return scope.userId && id === OPENROUTER ? scope.userId : null;
}

/**
 * TanStack AI's server-side key store, on the coach_keys table (ADR 0036). Scope always comes
 * from the session, never from a request body.
 */
const coachCredentials = defineCredentialStore({
  async get({ scope, id }) {
    const userId = athleteOf(scope, id);
    if (!userId) return null;
    const [row] = await db
      .select({ sealed: coachKeys.sealed })
      .from(coachKeys)
      .where(eq(coachKeys.userId, userId))
      .limit(1);
    if (!row) return null;
    try {
      return { type: "api_key", value: open(row.sealed) };
    } catch {
      // Sealed under an earlier BETTER_AUTH_SECRET: treat it as missing so the athlete re-adds it.
      logger.warn("coach_key.unreadable");
      return null;
    }
  },
  async set({ scope, id, credential }) {
    const userId = athleteOf(scope, id);
    if (!userId || credential.type !== "api_key")
      throw new Error("Only an athlete's OpenRouter key");
    const values = { sealed: seal(credential.value), updatedAt: new Date() };
    await db
      .insert(coachKeys)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: coachKeys.userId, set: values });
  },
  async delete({ scope, id }) {
    const userId = athleteOf(scope, id);
    if (userId) await db.delete(coachKeys).where(eq(coachKeys.userId, userId));
  },
  async list(scope) {
    const userId = athleteOf(scope, OPENROUTER);
    if (!userId) return [];
    const [row] = await db
      .select({ userId: coachKeys.userId })
      .from(coachKeys)
      .where(eq(coachKeys.userId, userId))
      .limit(1);
    return row ? [{ id: OPENROUTER, type: "api_key" as const }] : [];
  },
});

/** The athlete's OpenRouter key, or null when they have not added one. */
export async function coachKeyFor(userId: string) {
  const credential = await coachCredentials.get({ scope: { userId }, id: OPENROUTER });
  return credential?.type === "api_key" ? credential.value : null;
}

/** When the key was saved, never the key itself, not even masked. */
export async function coachKeySavedAt(userId: string) {
  const [row] = await db
    .select({ updatedAt: coachKeys.updatedAt })
    .from(coachKeys)
    .where(eq(coachKeys.userId, userId))
    .limit(1);
  return row?.updatedAt.toISOString() ?? null;
}

export async function saveCoachKeyImpl(key: string) {
  const session = await getRequiredSession();
  await coachCredentials.set({
    scope: { userId: session.user.id },
    id: OPENROUTER,
    credential: { type: "api_key", value: key },
  });
  logger.info("coach_key.saved");
}

export async function removeCoachKeyImpl() {
  const session = await getRequiredSession();
  await coachCredentials.delete({ scope: { userId: session.user.id }, id: OPENROUTER });
  logger.info("coach_key.removed");
}
