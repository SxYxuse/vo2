import { env } from "@/configs/env.ts";

import type { StreamSet, SummaryActivity } from "./client.ts";

/**
 * Local stand-in for www.strava.com, mounted at MOCK_STRAVA_PATH when STRAVA_MOCK=1.
 * It speaks the same OAuth and v3 HTTP surface the app uses, so sign-in, token
 * refresh and sync run unchanged; only the base URL differs.
 */
export const MOCK_STRAVA_PATH = "/api/mock-strava";

const ATHLETE = {
  id: 1,
  username: "mock-athlete",
  firstname: "Mock",
  lastname: "Athlete",
  profile: null,
  profile_medium: null,
};

/** Far below Strava's real limits, so sync never pauses against the mock. */
const RATE_LIMIT_HEADERS = {
  "X-ReadRateLimit-Limit": "100000,1000000",
  "X-ReadRateLimit-Usage": "0,0",
};

/**
 * Strava access tokens last about 6 h; the mock's expire sooner so local syncs go through the
 * refresh path production depends on.
 */
const TOKEN_TTL_SEC = 10 * 60;

/**
 * Deauthorizing revokes every token Strava issued to the app for the athlete, in every deployment
 * sharing that app (issue #59). Tokens carry a strictly increasing issue time, so one timestamp
 * revokes them all.
 */
let lastIssuedAt = 0;
let revokedAt = 0;

export async function handleMockStravaRequest(request: Request): Promise<Response> {
  if (!env.STRAVA_MOCK) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const path = url.pathname.slice(url.pathname.indexOf(MOCK_STRAVA_PATH) + MOCK_STRAVA_PATH.length);
  const query = url.searchParams;

  if (path === "/oauth/authorize") return authorize(query);
  if (path === "/oauth/token" && request.method === "POST") return token(await request.formData());
  if (path === "/oauth/deauthorize" && request.method === "POST") return deauthorize(request);
  if (!isLive(bearerToken(request), "access")) return unauthorized("access_token");
  if (path === "/api/v3/athlete") return json(ATHLETE);
  if (path === "/api/v3/athlete/activities") {
    return json(
      listActivities({
        page: numberParam(query, "page") ?? 1,
        perPage: numberParam(query, "per_page") ?? 30,
        after: numberParam(query, "after"),
        before: numberParam(query, "before"),
      }),
    );
  }
  const streams = /^\/api\/v3\/activities\/(\d+)\/streams$/.exec(path);
  if (streams) {
    const spec = buildCatalog(new Date()).find((item) => item.id === Number(streams[1]));
    return spec ? json(streamsFor(spec)) : json({ message: "Record Not Found" }, 404);
  }
  return json({ message: "Record Not Found" }, 404);
}

function authorize(query: URLSearchParams) {
  const redirectUri = query.get("redirect_uri");
  if (!redirectUri) return json({ message: "Bad Request", field: "redirect_uri" }, 400);
  const callback = new URL(redirectUri);
  callback.searchParams.set("code", "mock-code");
  callback.searchParams.set("scope", query.get("scope") ?? "read,activity:read_all");
  const state = query.get("state");
  if (state) callback.searchParams.set("state", state);
  return new Response(null, { status: 302, headers: { location: callback.toString() } });
}

function token(form: FormData) {
  if (form.get("grant_type") === "refresh_token" && !isLive(form.get("refresh_token"), "refresh")) {
    return json(
      {
        message: "Bad Request",
        errors: [{ resource: "RefreshToken", field: "refresh_token", code: "invalid" }],
      },
      400,
    );
  }
  const issuedAt = Math.max(Date.now(), lastIssuedAt + 1);
  lastIssuedAt = issuedAt;
  return json({
    token_type: "Bearer",
    access_token: `mock-access-${issuedAt}`,
    refresh_token: `mock-refresh-${issuedAt}`,
    expires_in: TOKEN_TTL_SEC,
    expires_at: Math.floor(issuedAt / 1000) + TOKEN_TTL_SEC,
    athlete: ATHLETE,
  });
}

function deauthorize(request: Request) {
  const token = bearerToken(request);
  if (!isLive(token, "access")) return unauthorized("access_token");
  revokedAt = lastIssuedAt;
  return json({ access_token: token });
}

function bearerToken(request: Request) {
  return request.headers.get("authorization")?.replace(/^Bearer /, "") ?? null;
}

/** Refresh tokens never expire on their own; access tokens last TOKEN_TTL_SEC. Both die on deauthorize. */
function isLive(token: FormDataEntryValue | null, kind: "access" | "refresh") {
  const match = typeof token === "string" ? new RegExp(`^mock-${kind}-(\\d+)$`).exec(token) : null;
  if (!match) return false;
  const issuedAt = Number(match[1]);
  if (issuedAt <= revokedAt) return false;
  return kind === "refresh" || Date.now() < issuedAt + TOKEN_TTL_SEC * 1000;
}

function unauthorized(field: string) {
  return json(
    { message: "Authorization Error", errors: [{ resource: "Athlete", field, code: "invalid" }] },
    401,
  );
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: RATE_LIMIT_HEADERS });
}

function numberParam(query: URLSearchParams, key: string) {
  const value = query.get(key);
  return value == null || value === "" ? undefined : Number(value);
}

const HOME_LAT = 48.8584;
const HOME_LNG = 2.2945;
const STREAM_STEP_SEC = 10;
const TIMEZONE = "(GMT+01:00) Europe/Paris";
const ID_BASE = 900_000_000;

type SportType = NonNullable<SummaryActivity["sport_type"]>;
type MockKind = "ride" | "ftpRide" | "virtualRide" | "run" | "trailRun" | "walk" | "swim";
type MockSpec = { id: number; kind: MockKind; name: string; start: Date; minutes: number };

const KIND_SPORT: Record<MockKind, SportType> = {
  ride: "Ride",
  ftpRide: "Ride",
  virtualRide: "VirtualRide",
  run: "Run",
  trailRun: "TrailRun",
  walk: "Walk",
  swim: "Swim",
};

function listActivities(params: {
  page: number;
  perPage: number;
  after?: number;
  before?: number;
}): SummaryActivity[] {
  const items = buildCatalog(new Date())
    .filter((spec) => params.after == null || spec.start.getTime() / 1000 > params.after)
    .filter((spec) => params.before == null || spec.start.getTime() / 1000 < params.before)
    .map(toSummary);
  const start = (params.page - 1) * params.perPage;
  return items.slice(start, start + params.perPage);
}

/** Eight weeks of training relative to now, newest first, so every page has recent data. */
function buildCatalog(now: Date): MockSpec[] {
  const items: MockSpec[] = [];
  const monday = startOfUtcMonday(now);
  let seq = 1;

  const push = (kind: MockKind, name: string, start: Date, minutes: number) => {
    if (start.getTime() > now.getTime()) return;
    items.push({ id: ID_BASE + seq, kind, name, start, minutes });
    seq += 1;
  };

  for (let week = 7; week >= 0; week -= 1) {
    const weekMonday = addUtcDays(monday, -week * 7);
    push("ride", "Morning ride", atUtcHour(addUtcDays(weekMonday, 1), 7), 60);
    if (week === 2) {
      push("trailRun", "Trail run", atUtcHour(addUtcDays(weekMonday, 2), 7), 55);
    } else {
      push("run", "Lunch run", atUtcHour(addUtcDays(weekMonday, 2), 7), 45);
    }
    if (week === 1) {
      push("ftpRide", "Threshold ride", atUtcHour(addUtcDays(weekMonday, 3), 7), 50);
    } else {
      push("ride", "After-work ride", atUtcHour(addUtcDays(weekMonday, 3), 17), 75);
    }
    if (week % 2 === 0) {
      push("ride", "Long ride", atUtcHour(addUtcDays(weekMonday, 5), 8), 150);
    } else {
      push("run", "Long run", atUtcHour(addUtcDays(weekMonday, 5), 8), 80);
    }
    if (week === 3) push("walk", "Park walk", atUtcHour(addUtcDays(weekMonday, 4), 12), 40);
    if (week === 4) {
      push("virtualRide", "Indoor ride", atUtcHour(addUtcDays(weekMonday, 4), 18), 45);
    }
    if (week === 5) push("swim", "Pool swim", atUtcHour(addUtcDays(weekMonday, 4), 12), 30);
  }

  return items.sort((left, right) => right.start.getTime() - left.start.getTime());
}

function hasPower(kind: MockKind) {
  return kind === "ride" || kind === "ftpRide" || kind === "virtualRide";
}

function hasGps(kind: MockKind) {
  return kind !== "virtualRide" && kind !== "swim";
}

/** Long rides and the trail run climb one real hill, so route predictions see climbing speed. */
function climbFor(spec: MockSpec) {
  if (spec.name === "Long ride") return 420;
  if (spec.kind === "trailRun") return 260;
  return 0;
}

/**
 * Altitude, grade, speed and distance per sample. Flat activities keep the old gentle wave;
 * hilly ones climb from 30 % to 55 % of the time, descend until 75 %, and slow on the way up.
 */
function terrainFor(spec: MockSpec, samples: number) {
  const base = speedMps(spec.kind);
  const gpsOn = hasGps(spec.kind);
  const climbM = gpsOn ? climbFor(spec) : 0;
  const onFoot = spec.kind === "run" || spec.kind === "trailRun" || spec.kind === "walk";
  const altitude: number[] = [];
  const grade: number[] = [];
  const speed: number[] = [];
  const distance: number[] = [];
  let travelled = 0;
  let previousAltitude = 40;
  for (let i = 0; i < samples; i += 1) {
    const progress = i / Math.max(1, samples - 1);
    const wave = Math.sin(progress * Math.PI * 4);
    if (!gpsOn) {
      altitude.push(0);
      grade.push(0);
      speed.push(base);
    } else if (climbM === 0) {
      altitude.push(40 + wave * 18);
      grade.push(wave * 3);
      speed.push(base);
    } else {
      const up = Math.min(1, Math.max(0, (progress - 0.3) / 0.25));
      const down = Math.min(1, Math.max(0, (progress - 0.55) / 0.2));
      const height = 40 + climbM * (up - down);
      const slope =
        progress >= 0.3 && progress < 0.55 ? 1 : progress >= 0.55 && progress < 0.75 ? -1 : 0;
      const pace = slope > 0 ? (onFoot ? 0.7 : 0.42) : slope < 0 ? (onFoot ? 1.15 : 1.45) : 1;
      const step = base * pace * STREAM_STEP_SEC;
      altitude.push(height);
      grade.push(i === 0 || step <= 0 ? 0 : ((height - previousAltitude) / step) * 100);
      speed.push(base * pace);
      previousAltitude = height;
    }
    distance.push(Math.round(travelled));
    travelled += (speed[i] ?? base) * STREAM_STEP_SEC;
  }
  return { altitude, grade, speed, distance, climbM };
}

function toSummary(spec: MockSpec): SummaryActivity {
  const movingTime = spec.minutes * 60;
  const sportType = KIND_SPORT[spec.kind];
  const samples = Math.max(2, Math.round(movingTime / STREAM_STEP_SEC) + 1);
  const terrain = terrainFor(spec, samples);
  const distance = terrain.distance.at(-1) ?? 0;
  const speed = movingTime > 0 ? distance / movingTime : 0;
  const points = hasGps(spec.kind) ? loopPoints(24) : [];
  const power = hasPower(spec.kind);
  const avgWatts = power ? (spec.kind === "ftpRide" ? 198 : 190) : undefined;
  const avgHr = spec.kind === "swim" ? 128 : spec.kind === "walk" ? 110 : 148;
  const iso = spec.start.toISOString();
  return {
    id: spec.id,
    athlete: { id: ATHLETE.id },
    name: spec.name,
    distance: spec.kind === "swim" ? spec.minutes * 50 : distance,
    moving_time: movingTime,
    elapsed_time: movingTime + 60,
    total_elevation_gain: hasGps(spec.kind) ? 120 + terrain.climbM : 0,
    type: sportType,
    sport_type: sportType,
    start_date: iso,
    start_date_local: iso.replace("Z", ""),
    timezone: TIMEZONE,
    start_latlng: points[0],
    end_latlng: points.at(-1),
    map: points.length ? { summary_polyline: encodePolyline(points) } : undefined,
    trainer: spec.kind === "virtualRide",
    commute: false,
    manual: false,
    private: false,
    average_speed: speed,
    has_heartrate: true,
    average_heartrate: avgHr,
    max_heartrate: avgHr + 28,
    average_watts: avgWatts,
    device_watts: power,
    weighted_average_watts: avgWatts ? Math.round(avgWatts * 1.05) : undefined,
  } as SummaryActivity;
}

function streamsFor(spec: MockSpec): StreamSet {
  const samples = Math.max(2, Math.round((spec.minutes * 60) / STREAM_STEP_SEC) + 1);
  const gpsOn = hasGps(spec.kind);
  const power = hasPower(spec.kind);
  const terrain = terrainFor(spec, samples);
  const gps = gpsOn ? loopPoints(samples) : [];
  const indexes = Array.from({ length: samples }, (_, i) => i);
  const progress = (i: number) => i / (samples - 1);
  const meta = {
    original_size: samples,
    resolution: "high" as const,
    series_type: "time" as const,
  };
  const stream = <T>(data: T[]) => ({ ...meta, data });

  return {
    time: stream(indexes.map((i) => i * STREAM_STEP_SEC)),
    distance: stream(terrain.distance),
    latlng: gpsOn ? stream(gps) : undefined,
    altitude: stream(terrain.altitude),
    velocity_smooth: stream(terrain.speed),
    heartrate: stream(indexes.map((i) => heartAt(spec.kind, progress(i)))),
    cadence: stream(indexes.map(() => (power ? 88 : spec.kind === "swim" ? 0 : 164))),
    watts: power ? stream(indexes.map((i) => wattsAt(spec.kind, progress(i)))) : undefined,
    temp: stream(indexes.map(() => 16)),
    moving: stream(indexes.map(() => true)),
    grade_smooth: stream(terrain.grade),
  } as StreamSet;
}

function heartAt(kind: MockKind, progress: number) {
  if (kind === "walk") return 108 + Math.round(Math.sin(progress * Math.PI) * 8);
  if (kind === "swim") return 126 + Math.round(Math.sin(progress * Math.PI) * 10);
  if (kind === "ftpRide") return progress < 0.2 ? 132 : progress < 0.6 ? 165 : 128;
  return 142 + Math.round(Math.sin(progress * Math.PI) * 14);
}

function wattsAt(kind: MockKind, progress: number) {
  if (kind === "ftpRide") return progress < 0.2 ? 150 : progress < 0.6 ? 250 : 120;
  return 185 + Math.round(Math.sin(progress * Math.PI * 2) * 20);
}

function speedMps(kind: MockKind) {
  if (kind === "run" || kind === "trailRun") return 3.2;
  if (kind === "walk") return 1.5;
  if (kind === "swim") return 0.85;
  return 8;
}

/** A loop around the Eiffel Tower, so maps and heatmaps have something to draw. */
function loopPoints(count: number): Array<[number, number]> {
  return Array.from({ length: count }, (_, i) => {
    const t = (i / Math.max(count - 1, 1)) * 2 * Math.PI;
    return [HOME_LAT + Math.sin(t) * 0.018, HOME_LNG + Math.cos(t) * 0.028];
  });
}

function encodePolyline(points: Array<[number, number]>) {
  let encoded = "";
  let prevLat = 0;
  let prevLng = 0;
  for (const [lat, lng] of points) {
    const latE5 = Math.round(lat * 1e5);
    const lngE5 = Math.round(lng * 1e5);
    encoded += encodeSigned(latE5 - prevLat) + encodeSigned(lngE5 - prevLng);
    prevLat = latE5;
    prevLng = lngE5;
  }
  return encoded;
}

function encodeSigned(value: number) {
  let n = value < 0 ? ~(value << 1) : value << 1;
  let out = "";
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>= 5;
  }
  return out + String.fromCharCode(n + 63);
}

function startOfUtcMonday(now: Date) {
  return addUtcDays(now, -((now.getUTCDay() + 6) % 7));
}

function addUtcDays(date: Date, days: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function atUtcHour(date: Date, hour: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour));
}
