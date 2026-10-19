import { describe, expect, it } from "vite-plus/test";

import { deleteAthlete } from "./athlete-deletion.ts";

describe("deleteAthlete", () => {
  it("revokes Strava access before removing the athlete", async () => {
    const calls: string[] = [];

    const result = await deleteAthlete("athlete-1", {
      revokeStrava: async (userId) => void calls.push(`revoke ${userId}`),
      removeAthlete: async (userId) => void calls.push(`remove ${userId}`),
    });

    expect(calls).toEqual(["revoke athlete-1", "remove athlete-1"]);
    expect(result).toEqual({ stravaRevoked: true });
  });

  it("still removes the athlete when Strava refuses to revoke", async () => {
    const removed: string[] = [];

    const result = await deleteAthlete("athlete-1", {
      revokeStrava: async () => {
        throw new Error("Strava is down");
      },
      removeAthlete: async (userId) => void removed.push(userId),
    });

    expect(removed).toEqual(["athlete-1"]);
    expect(result).toEqual({ stravaRevoked: false });
  });
});
