import { useEffect, useState, useSyncExternalStore } from "react";
import { ByokBlockedError, ByokMissingError } from "@tanstack/ai/byok";
import {
  defaultByokStorage,
  defineByok,
  EMPTY_BYOK_SNAPSHOT,
  isPasskeyStorageSupported,
  type ByokClient,
} from "@tanstack/ai-react/byok";

import { APP_NAME } from "@/lib/brand.ts";
import { OPENROUTER as PROVIDER } from "@/services/coach-models.ts";

/** The browser database the passkey-encrypted key is kept in. */
const KEY_DATABASE = "vo2-coach-key";

let keyring: ByokClient | null = null;

/**
 * The athlete's OpenRouter key, encrypted on this device with a passkey and never stored by VO2's
 * server (ADR 0036). Browser only: the server sees the key only as a request header.
 */
function coachKeyring() {
  if (typeof window === "undefined") return null;
  keyring ??= defineByok({
    storage: defaultByokStorage({
      rpName: APP_NAME,
      userName: "OpenRouter key",
      dbName: KEY_DATABASE,
    }),
  });
  return keyring;
}

const noSubscribe = () => () => {};
const emptySnapshot = () => EMPTY_BYOK_SNAPSHOT;

export type CoachKey = {
  /** False until the stored key has been looked up, so no prompt flashes on first paint. */
  ready: boolean;
  /** Set or locked: a key is on this device, unlocked or waiting for the passkey. */
  hasKey: boolean;
  masked: string | null;
  state: "none" | "locked" | "set" | "error";
  /** Without passkeys the key is kept in memory and lost when the app closes. */
  remembered: boolean;
};

export function useCoachKey(): CoachKey {
  const client = coachKeyring();
  const snapshot = useSyncExternalStore(
    client?.subscribe ?? noSubscribe,
    client?.getSnapshot ?? emptySnapshot,
    emptySnapshot,
  );
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void client?.ready().then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [client]);
  const status = snapshot.status[PROVIDER];
  const state = status?.state === "empty" || !status ? "none" : status.state;
  return {
    ready,
    hasKey: state === "set" || state === "locked",
    masked: status && "masked" in status ? status.masked : null,
    state,
    remembered: client != null && isPasskeyStorageSupported() && window.isSecureContext,
  };
}

/** Saves the key; the first save on a device registers the passkey that encrypts it. */
export async function saveCoachKey(key: string) {
  const client = coachKeyring();
  if (!client) return;
  await client.update(PROVIDER, key);
}

/** Removes the key from this device without asking for the passkey. */
export async function removeCoachKey() {
  const client = coachKeyring();
  if (client) await client.clear().catch(() => undefined);
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(KEY_DATABASE);
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}

/**
 * The header a coach request carries. A locked key asks for the passkey here, on the first coach
 * use of the session, never on app open. No key sends nothing; the server answers that it's missing.
 */
export async function coachKeyHeaders(): Promise<Record<string, string>> {
  const client = coachKeyring();
  if (!client) return {};
  await client.ready();
  if (client.getSnapshot().status[PROVIDER]?.state === "locked") await client.unlock();
  return client.headers(PROVIDER);
}

/** The reason a coach request failed, in the athlete's words, without switching model or key. */
export function coachErrorMessage(error: Error) {
  const text = error.message.toLowerCase();
  if (
    error instanceof ByokMissingError ||
    error.name === "ByokMissingError" ||
    text.includes("missing openrouter")
  ) {
    return "Add your OpenRouter key in Settings → Coach to use the coach.";
  }
  // A cancelled passkey leaves the key locked; so does an unlock the browser no longer ties to a tap.
  if (
    error instanceof ByokBlockedError ||
    error.name === "ByokBlockedError" ||
    error.name === "NotAllowedError" ||
    text.includes("user action")
  ) {
    return "Your OpenRouter key is still locked. Try again and confirm with your passkey.";
  }
  if (text.includes("402") || text.includes("insufficient credits")) {
    return "Your OpenRouter account is out of credit. Top it up on openrouter.ai, then try again.";
  }
  if (
    text.includes("401") ||
    text.includes("no auth credentials") ||
    text.includes("user not found")
  ) {
    return "OpenRouter rejected your key. Check it in Settings → Coach.";
  }
  if (text.includes("no endpoints found") || text.includes("is not a valid model")) {
    return "This model isn't available on OpenRouter right now. Pick another in Settings → Coach.";
  }
  return error.message;
}
