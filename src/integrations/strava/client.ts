import { StravaDailyLimitError, StravaRateLimit, StravaShortLimitError } from "./rate-limit.ts";
import type { components, operations } from "./strava.types.ts";

export type SummaryActivity = components["schemas"]["SummaryActivity"];
export type StreamSet = components["schemas"]["StreamSet"];
type StreamKey = NonNullable<
  operations["getActivityStreams"]["parameters"]["query"]
>["keys"][number];

export const DEFAULT_STREAM_KEYS = [
  "time",
  "distance",
  "latlng",
  "altitude",
  "velocity_smooth",
  "heartrate",
  "cadence",
  "watts",
  "temp",
  "moving",
  "grade_smooth",
] as const satisfies readonly StreamKey[];

const STRAVA_API_BASE = "https://www.strava.com/api/v3";

export class StravaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "StravaApiError";
  }
}

export class StravaApi {
  readonly rateLimit: StravaRateLimit;

  constructor(
    private readonly accessToken: string,
    rateLimit = new StravaRateLimit(),
  ) {
    this.rateLimit = rateLimit;
  }

  async listAthleteActivities(
    params: {
      page?: number;
      perPage?: number;
      after?: number;
      before?: number;
    } = {},
  ) {
    const search = new URLSearchParams();
    search.set("page", String(params.page ?? 1));
    search.set("per_page", String(params.perPage ?? 200));
    if (params.after != null) search.set("after", String(params.after));
    if (params.before != null) search.set("before", String(params.before));
    return this.request<SummaryActivity[]>(`/athlete/activities?${search.toString()}`);
  }

  async getActivityStreams(
    activityId: string | number,
    keys: readonly StreamKey[] = DEFAULT_STREAM_KEYS,
  ) {
    const search = new URLSearchParams();
    search.set("keys", keys.join(","));
    search.set("key_by_type", "true");
    try {
      return await this.request<StreamSet>(`/activities/${activityId}/streams?${search.toString()}`);
    } catch (error) {
      // Manual and some indoor activities have no stream data.
      if (error instanceof StravaApiError && error.status === 404) {
        return {};
      }
      throw error;
    }
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    await this.rateLimit.waitIfNeeded();
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${this.accessToken}`);
    const response = await fetch(`${STRAVA_API_BASE}${path}`, {
      ...init,
      headers,
    });
    this.rateLimit.updateFromHeaders(response.headers);

    if (response.status === 429) {
      if (this.rateLimit.dailyRemaining <= 0) {
        throw new StravaDailyLimitError();
      }
      throw new StravaShortLimitError();
    }

    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = await response.text();
      }
      throw new StravaApiError(
        `Strava request failed (${response.status}) ${path}`,
        response.status,
        body,
      );
    }

    return (await response.json()) as T;
  }
}
