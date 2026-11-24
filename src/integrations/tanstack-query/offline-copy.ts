import { noop, type Query, type QueryClient } from "@tanstack/react-query";
import {
  persistQueryClient,
  type PersistedClient,
  type Persister,
} from "@tanstack/query-persist-client-core";
import { del, get, set } from "idb-keyval";

const OFFLINE_QUERY_KEYS = [
  "app-shell",
  "home",
  "coach-plan",
  "season",
  "fitness",
  "time-outs",
  "progress",
  "bests",
  "heart-rate",
  "power-files",
  "training-paces",
  "predicted-time-trend",
  "settings-snapshot",
  "coach-chats",
  "coach-chat",
  "coach-spending",
] as const;

const OFFLINE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const SAVE_DELAY_MS = 1000;
const STORAGE_KEY = "vo2-offline-copy";

const BUILD_ID: string = import.meta.env.VITE_BUILD_ID ?? "dev";

type OfflineStorage = {
  get: (key: string) => Promise<PersistedClient | undefined>;
  set: (key: string, value: PersistedClient) => Promise<void>;
  del: (key: string) => Promise<void>;
};

const indexedDbStorage: OfflineStorage = { get, set, del };

// IndexedDB stores the snapshot by structured clone, so dates and maps in query data come back
// as they were, which JSON would not do.
function throttledPersister(storage: OfflineStorage, delay = SAVE_DELAY_MS): Persister {
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

function isOfflineQuery(query: Pick<Query, "queryKey" | "state">) {
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

export async function removeOfflineCopy() {
  await Promise.resolve(persister.removeClient()).catch(noop);
}
