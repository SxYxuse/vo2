import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vite-plus/test";

import {
  activityDetailQueryOptions,
  appShellQueryOptions,
  fitnessQueryOptions,
  homeQueryOptions,
} from "@/lib/queries.ts";
import { afterLocalCopyChanged, afterSettingsSaved, afterSignOut } from "@/lib/query-events.ts";
import { DEFAULT_ATHLETE_SETTINGS } from "@/services/athlete-settings.types.ts";

const settings = { ...DEFAULT_ATHLETE_SETTINGS, calendarPeriod: "weeks" as const };
const saved = {
  profile: { birthDate: "1990-01-01", weightKg: 70, heartRateSince: "2026-01-01" },
  settings,
  training: null,
};

function cachedClient() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(appShellQueryOptions.queryKey, {
    signedIn: true,
    training: null,
    hasProfile: false,
  });
  queryClient.setQueryData(homeQueryOptions.queryKey, {
    signedIn: true,
    activities: [],
    settings: DEFAULT_ATHLETE_SETTINGS,
    training: null,
  });
  queryClient.setQueryData(fitnessQueryOptions.queryKey, { signedIn: true, fitnessLoads: [] });
  queryClient.setQueryData(activityDetailQueryOptions("42").queryKey, {} as never);
  return queryClient;
}

function isStale(queryClient: QueryClient, queryKey: readonly unknown[]) {
  return queryClient.getQueryState(queryKey)?.isInvalidated === true;
}

describe("afterLocalCopyChanged", () => {
  it("marks an open activity detail stale, so new streams and load show", async () => {
    const queryClient = cachedClient();

    await afterLocalCopyChanged(queryClient);

    expect(isStale(queryClient, activityDetailQueryOptions("42").queryKey)).toBe(true);
    expect(isStale(queryClient, fitnessQueryOptions.queryKey)).toBe(true);
  });
});

describe("afterSettingsSaved", () => {
  it("shows the saved settings at once and refreshes fitness, which a birthday changes", async () => {
    const queryClient = cachedClient();

    await afterSettingsSaved(queryClient, saved);

    expect(queryClient.getQueryData(homeQueryOptions.queryKey)?.settings.calendarPeriod).toBe(
      "weeks",
    );
    expect(isStale(queryClient, fitnessQueryOptions.queryKey)).toBe(true);
    expect(isStale(queryClient, activityDetailQueryOptions("42").queryKey)).toBe(true);
    expect(queryClient.getQueryData(appShellQueryOptions.queryKey)?.hasProfile).toBe(false);
  });

  it("marks the profile done when onboarding saves", async () => {
    const queryClient = cachedClient();

    await afterSettingsSaved(queryClient, saved, { profileDone: true });

    expect(queryClient.getQueryData(appShellQueryOptions.queryKey)?.hasProfile).toBe(true);
  });
});

describe("afterSignOut", () => {
  it("drops every athlete query and keeps a signed-out shell", () => {
    const queryClient = cachedClient();

    afterSignOut(queryClient);

    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([appShellQueryOptions.queryKey]);
    expect(queryClient.getQueryData(appShellQueryOptions.queryKey)?.signedIn).toBe(false);
  });
});
