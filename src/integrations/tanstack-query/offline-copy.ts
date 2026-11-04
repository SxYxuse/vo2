import { noop, type Query, type QueryClient } from "@tanstack/react-query";
import {
  persistQueryClient,
  type PersistedClient,
  type Persister,
} from "@tanstack/query-persist-client-core";
import { del, get, set } from "idb-keyval";

/*
 * The athlete's last loaded views, saved on the device so the installed app can show them with
 * no signal (ADR 0031). Offline is read-only: nothing is queued to send later.
 */

/**
 * Views worth reading with no signal. Activity details and power file analyses (streams), the
 * map (needs tiles), and top-effort celebrations (marked seen on the server) stay out.
 */
export const OFFLINE_QUERY_KEYS = [
  "app-shell",
  "home",
  "coach-plan",
  "season",
  "fitness",
  "progress",
  "bests",
  "heart-rate",
  "power-files",
  "training-paces",
  "settings-snapshot",
  "coach-chats",
  "coach-chat",
] as const;

/** A week plan older than this is no use to read offline. */
export const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

/** The cache writes on every query event; one write a second is plenty. */
const SAVE_DELAY_MS = 1000;
const STORAGE_KEY = "vo2-offline-copy";

/** Data saved by another build may not have the shape this build's code reads. */
const BUILD_ID: string = import.meta.env.VITE_BUILD_ID ?? "dev";

export type OfflineStorage = {
  get: (key: string) => Promise<PersistedClient | undefined>;
  set: (key: string, value: PersistedClient) => Promise<void>;
  del: (key: string) => Promise<void>;
};

const indexedDbStorage: OfflineStorage = { get, set, del };

/**
 * Saves the latest snapshot at most once per `delay`. IndexedDB stores it by structured clone,
 * so dates and maps in query data come back as they were, which JSON would not do.
 */
export function throttledPersister(storage: OfflineStorage, delay = SAVE_DELAY_MS): Persister {
  let latest: PersistedClient | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    persistClient(client) {
      latest = client;
      timer ??= setTimeout(() => {
        timer = undefined;
        const snapshot = latest;
        latest = null;
        if (snapshot) void storage.set(STORAGE_KEY, snapshot).catch(noop);
      }, delay);
    },
    restoreClient: () => storage.get(STORAGE_KEY),
    removeClient() {
      clearTimeout(timer);
      timer = undefined;
      latest = null;
      return storage.del(STORAGE_KEY);
    },
  };
}

export function isOfflineQuery(query: Pick<Query, "queryKey" | "state">) {
  return (
    query.state.status === "success" &&
    (OFFLINE_QUERY_KEYS as readonly unknown[]).includes(query.queryKey[0])
  );
}

const persister = throttledPersister(indexedDbStorage);

/**
 * Restores the saved views into `queryClient` and keeps saving them. Resolves once restored,
 * even when IndexedDB is unavailable (a private window), so loaders can wait on it safely.
 */
export function keepOfflineCopy(queryClient: QueryClient) {
  // A saved query dropped from memory would drop from the saved copy at the next write.
  for (const key of OFFLINE_QUERY_KEYS) {
    queryClient.setQueryDefaults([key], { gcTime: OFFLINE_MAX_AGE_MS });
  }
  const [, restored] = persistQueryClient({
    queryClient,
    persister,
    maxAge: OFFLINE_MAX_AGE_MS,
    buster: BUILD_ID,
    dehydrateOptions: {
      shouldDehydrateQuery: isOfflineQuery,
      shouldDehydrateMutation: () => false,
    },
  });
  return restored.catch(noop);
}

/** Signing out or deleting the athlete must not leave their data on the device. */
export async function removeOfflineCopy() {
  await Promise.resolve(persister.removeClient()).catch(noop);
}
