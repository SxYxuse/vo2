import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { QueryClient } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSave,
  type PersistedClient,
} from "@tanstack/query-persist-client-core";

import * as queries from "@/lib/queries.ts";
import {
  OFFLINE_QUERY_KEYS,
  ONLINE_ONLY_QUERY_KEYS,
  isOfflineQuery,
  throttledPersister,
  type OfflineStorage,
} from "./offline-copy.ts";

function memoryStorage() {
  const saved = new Map<string, PersistedClient>();
  const storage: OfflineStorage = {
    get: async (key) => saved.get(key),
    set: async (key, value) => void saved.set(key, structuredClone(value)),
    del: async (key) => void saved.delete(key),
  };
  return { saved, storage, set: vi.spyOn(storage, "set") };
}

function client(timestamp: number): PersistedClient {
  return { timestamp, buster: "", clientState: { queries: [], mutations: [] } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("throttledPersister", () => {
  it("writes only the latest snapshot once per delay", async () => {
    vi.useFakeTimers();
    const { storage, set, saved } = memoryStorage();
    const persister = throttledPersister(storage, 1000);

    persister.persistClient(client(1));
    persister.persistClient(client(2));
    persister.persistClient(client(3));
    expect(set).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(set).toHaveBeenCalledTimes(1);
    expect([...saved.values()][0]?.timestamp).toBe(3);
  });

  it("drops a pending write when the copy is removed", async () => {
    vi.useFakeTimers();
    const { storage, saved } = memoryStorage();
    const persister = throttledPersister(storage, 1000);

    persister.persistClient(client(1));
    await persister.removeClient();
    await vi.advanceTimersByTimeAsync(1000);
    expect(saved.size).toBe(0);
  });
});

describe("offline copy", () => {
  it("saves the views worth reading offline and restores their data as it was", async () => {
    const { storage } = memoryStorage();
    const persister = throttledPersister(storage, 0);
    const source = new QueryClient();
    const plannedAt = new Date("2026-10-26T07:12:00Z");
    source.setQueryData(["week-target"], { plannedAt, days: new Map([["mon", 45]]) });
    source.setQueryData(["activity", "42"], { streams: [1, 2, 3] });
    source.setQueryData(["activity-analysis", "42"], { text: "Good ride" });

    await persistQueryClientSave({
      queryClient: source,
      persister,
      dehydrateOptions: { shouldDehydrateQuery: isOfflineQuery },
    });
    await vi.waitFor(async () => expect(await persister.restoreClient()).toBeDefined());

    const restored = new QueryClient();
    await persistQueryClientRestore({ queryClient: restored, persister });

    const week = restored.getQueryData<{ plannedAt: Date; days: Map<string, number> }>([
      "week-target",
    ]);
    expect(week?.plannedAt).toEqual(plannedAt);
    expect(week?.days.get("mon")).toBe(45);
    expect(restored.getQueryData(["activity", "42"])).toBeUndefined();
    expect(restored.getQueryData(["activity-analysis", "42"])).toBeUndefined();
  });
});

describe("every query decides whether it works offline", () => {
  const keys = Object.values(queries).flatMap((value) => {
    const options = typeof value === "function" ? (value as (arg: string) => unknown)("x") : value;
    const queryKey = (options as { queryKey?: unknown[] } | null)?.queryKey;
    return Array.isArray(queryKey) ? [String(queryKey[0])] : [];
  });

  it("finds the queries", () => {
    expect(keys).toContain("week-target");
  });

  it.each(keys)("%s is saved for offline or listed as online-only", (key) => {
    const decided = [...OFFLINE_QUERY_KEYS, ...ONLINE_ONLY_QUERY_KEYS] as string[];
    expect(decided).toContain(key);
  });
});
