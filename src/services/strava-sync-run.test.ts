import { describe, expect, it, vi } from "vite-plus/test";

vi.hoisted(() => {
  process.env.STRAVA_MOCK = "1";
  process.env.DATABASE_URL ??= "postgresql://vo:vo@localhost:5432/vo";
  process.env.BETTER_AUTH_SECRET ??= "test-secret";
  process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
});

import { StravaApiError, type SummaryActivity } from "@/integrations/strava/client.ts";
import { StravaDailyLimitError, StravaShortLimitError } from "@/integrations/strava/rate-limit.ts";
import {
  syncAthlete,
  type RecordedSyncRun,
  type StoredSyncRun,
  type StravaReader,
  type SyncStore,
} from "./strava-sync-run.ts";
import { STRAVA_RECONNECT_MESSAGE } from "./strava-sync.types.ts";

const NOW = Date.parse("2026-10-21T10:00:00Z");
const NEXT_WINDOW = "2026-10-21T10:15:00.000Z";
const DAY = 86_400_000;

function activity(id: number, daysAgo: number, manual = false): SummaryActivity {
  return {
    id,
    name: `Ride ${id}`,
    sport_type: "Ride",
    start_date: new Date(NOW - daysAgo * DAY).toISOString(),
    manual,
  } as SummaryActivity;
}

/** Strava as the mock server answers it: newest first, `after` and `before` exclusive. */
function fakeStrava(
  history: SummaryActivity[],
  options: { shortRemaining?: number; onRead?: () => void } = {},
) {
  const calls: string[] = [];
  let failNext: Error | null = null;
  const strava = {
    calls,
    failWith(error: Error) {
      failNext = error;
    },
    rateLimit: {
      shortRemaining: options.shortRemaining ?? 100,
      snapshot() {
        return {
          shortRemaining: this.shortRemaining,
          dailyRemaining: 900,
          nextWindowAt: NEXT_WINDOW,
        };
      },
    },
    async listAthleteActivities(params) {
      calls.push(`list after=${params.after ?? "-"} before=${params.before ?? "-"}`);
      options.onRead?.();
      if (failNext) throw failNext;
      const epoch = (item: SummaryActivity) => Date.parse(item.start_date!) / 1000;
      return history
        .filter((item) => params.after == null || epoch(item) > params.after)
        .filter((item) => params.before == null || epoch(item) < params.before)
        .sort((a, b) => epoch(b) - epoch(a))
        .slice(0, params.perPage);
    },
    async getActivityStreams(activityId) {
      calls.push(`streams ${activityId}`);
      options.onRead?.();
      if (failNext) throw failNext;
      return { time: { data: [0, 1] } } as never;
    },
  } satisfies StravaReader & Record<string, unknown>;
  return strava;
}

function fakeStore(options: { run?: StoredSyncRun; deleted?: boolean } = {}) {
  const activities = new Map<string, { startDate: Date; manual: boolean; streams: boolean }>();
  const recorded: RecordedSyncRun[] = [];
  let loadRefreshes = 0;
  const store: SyncStore = {
    async readRun() {
      return options.run ?? null;
    },
    async recordRun(run) {
      recorded.push(run);
    },
    async streamsPending() {
      return [...activities.values()].filter((row) => !row.streams).length;
    },
    async newestStartDates(limit) {
      return [...activities.values()]
        .map((row) => row.startDate)
        .sort((a, b) => b.getTime() - a.getTime())
        .slice(0, limit);
    },
    async oldestStartDate() {
      const dates = [...activities.values()].map((row) => row.startDate.getTime());
      return dates.length ? new Date(Math.min(...dates)) : null;
    },
    async upsertActivities(items) {
      for (const item of items) {
        const id = String(item.id);
        activities.set(id, {
          startDate: new Date(item.start_date!),
          manual: item.manual === true,
          streams: activities.get(id)?.streams ?? item.manual === true,
        });
      }
      return items.length;
    },
    async activitiesWithoutStreams(limit) {
      return [...activities.entries()]
        .filter(([, row]) => !row.streams)
        .sort(([, a], [, b]) => b.startDate.getTime() - a.startDate.getTime())
        .slice(0, limit)
        .map(([id, row]) => ({ id, manual: row.manual }));
    },
    async storeStreams(activityId) {
      activities.get(activityId)!.streams = true;
    },
    async stampStoredStreams() {},
    async athleteExists() {
      return !options.deleted;
    },
    async refreshTrainingLoads() {
      loadRefreshes += 1;
    },
  };
  return {
    store,
    activities,
    recorded,
    get loadRefreshes() {
      return loadRefreshes;
    },
  };
}

function sync(store: SyncStore, strava: StravaReader) {
  return syncAthlete({ store, openStrava: async () => strava, now: () => NOW });
}

describe("syncAthlete", () => {
  it("answers from a stored pause without opening Strava", async () => {
    const local = fakeStore({
      run: {
        status: "paused",
        pausedUntil: new Date(NOW + 60_000),
        lastError: "Strava 15-minute read rate limit reached",
        shortLimitRemaining: 0,
        dailyLimitRemaining: 400,
      },
    });
    const openStrava = vi.fn();

    const result = await syncAthlete({ store: local.store, openStrava, now: () => NOW });

    expect(openStrava).not.toHaveBeenCalled();
    expect(result.pausedUntil).toBe(new Date(NOW + 60_000).toISOString());
    expect(local.recorded).toEqual([]);
  });

  it("stops after the newest page on the first copy (ADR 0012)", async () => {
    const local = fakeStore();
    const strava = fakeStrava([activity(1, 1), activity(2, 2)]);

    const result = await sync(local.store, strava);

    expect(strava.calls).toEqual(["list after=- before=-"]);
    expect(result).toMatchObject({ activitiesUpserted: 2, historyComplete: false, done: false });
    expect(local.recorded[0]?.status).toBe("incomplete");
  });

  it("copies older history before streams, then streams on the next call", async () => {
    const local = fakeStore();
    const strava = fakeStrava([activity(1, 1), activity(2, 2), activity(3, 30, true)]);
    await sync(local.store, strava);
    strava.calls.length = 0;

    const second = await sync(local.store, strava);

    expect(strava.calls.slice(0, 2)).toEqual([
      expect.stringMatching(/^list after=\d+ before=-$/),
      expect.stringMatching(/^list after=- before=\d+$/),
    ]);
    // The manual activity has no streams to fetch.
    expect(strava.calls.slice(2)).toEqual(["streams 1", "streams 2"]);
    expect(second).toMatchObject({ historyComplete: true, streamsPending: 0, done: true });
    expect(local.recorded.at(-1)?.status).toBe("complete");
  });

  it("re-reads the three newest stored activities so late Strava edits land", async () => {
    const local = fakeStore();
    const history = [1, 2, 3, 4].map((id) => activity(id, id));
    const strava = fakeStrava(history);
    await sync(local.store, strava);
    strava.calls.length = 0;

    await sync(local.store, strava);

    const thirdNewest = Date.parse(history[2]!.start_date!) / 1000;
    expect(strava.calls[0]).toBe(`list after=${thirdNewest - 1} before=-`);
  });

  it("pauses until the next window when Strava answers with the short limit", async () => {
    const local = fakeStore();
    const strava = fakeStrava([activity(1, 1)]);
    strava.failWith(new StravaShortLimitError());

    const result = await sync(local.store, strava);

    expect(result.pausedUntil).toBe(NEXT_WINDOW);
    expect(local.recorded[0]).toMatchObject({
      status: "paused",
      pausedUntil: new Date(NEXT_WINDOW),
    });
  });

  it("pauses until the next UTC day on the daily limit", async () => {
    const local = fakeStore();
    const strava = fakeStrava([activity(1, 1)]);
    strava.failWith(new StravaDailyLimitError());

    const result = await sync(local.store, strava);

    expect(result.pausedUntil).toBe("2026-10-22T00:00:00.000Z");
  });

  it("pauses before Strava refuses when few reads are left and work remains", async () => {
    const local = fakeStore();
    const strava = fakeStrava([activity(1, 1), activity(2, 40)], { shortRemaining: 3 });

    const result = await sync(local.store, strava);

    expect(result.pausedUntil).toBe(NEXT_WINDOW);
    expect(local.recorded[0]?.status).toBe("paused");
  });

  it("asks the athlete to reconnect when Strava answers 401", async () => {
    const local = fakeStore();
    const strava = fakeStrava([activity(1, 1)]);
    strava.failWith(new StravaApiError("Unauthorized", 401));

    await expect(sync(local.store, strava)).rejects.toThrow(STRAVA_RECONNECT_MESSAGE);
    expect(local.recorded[0]).toMatchObject({
      status: "failed",
      lastError: STRAVA_RECONNECT_MESSAGE,
    });
  });

  it("stops quietly without recording a run when the athlete was deleted mid-sync", async () => {
    const local = fakeStore({ deleted: true });
    const strava = fakeStrava([activity(1, 1)]);
    strava.failWith(new Error("insert or update violates foreign key constraint"));

    const result = await sync(local.store, strava);

    expect(result).toMatchObject({ lastError: null, pausedUntil: null, done: false });
    expect(local.recorded).toEqual([]);
  });

  it("stops copying streams when the request budget runs out", async () => {
    const local = fakeStore();
    let clock = NOW;
    // Each read takes 2.5 s of the 6 s request budget.
    const strava = fakeStrava([activity(1, 1), activity(2, 2)], { onRead: () => (clock += 2_500) });
    const sync = () =>
      syncAthlete({ store: local.store, openStrava: async () => strava, now: () => clock });
    await sync();
    strava.calls.length = 0;

    const result = await sync();

    // Two history reads, then one stream read spends the rest of the budget.
    expect(strava.calls.filter((call) => call.startsWith("streams"))).toEqual(["streams 1"]);
    expect(result).toMatchObject({ streamsFetched: 1, streamsPending: 1, done: false });
    // Too little budget left to recompute training load; the next call does it.
    expect(local.loadRefreshes).toBe(1);
  });
});
