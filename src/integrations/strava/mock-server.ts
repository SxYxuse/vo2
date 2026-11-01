import { env } from "@/configs/env.ts";
import { stravaWebhookUrl } from "@/services/strava-webhook.ts";

import type { StreamSet, SummaryActivity } from "./client.ts";

/**
 * Local stand-in for www.strava.com, mounted at MOCK_STRAVA_PATH when STRAVA_MOCK=1.
 * It speaks the same OAuth and v3 HTTP surface the app uses, so sign-in, token
 * refresh and sync run unchanged; only the base URL differs.
 *
 * Two mock-only endpoints stand in for what an athlete does on strava.com, and push the event
 * Strava would send: `POST /dev/deauthorize` and `POST /dev/activities/<id>/delete`.
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

/** Strava's shape: five heart-rate ranges, each starting where the last ends, the top one open. */
const ZONES = {
  heart_rate: {
    custom_zones: true,
    zones: [
      { min: 0, max: 123 },
      { min: 123, max: 153 },
      { min: 153, max: 169 },
      { min: 169, max: 184 },
      { min: 184, max: -1 },
    ],
  },
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

/** Activities the athlete deleted "on Strava" since the server started. */
const deletedActivityIds = new Set<number>();
let subscriptionCallback: string | null = null;

export async function handleMockStravaRequest(request: Request): Promise<Response> {
  if (!env.STRAVA_MOCK) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const path = url.pathname.slice(url.pathname.indexOf(MOCK_STRAVA_PATH) + MOCK_STRAVA_PATH.length);
  const query = url.searchParams;

  if (path === "/oauth/authorize") return authorize(query);
  if (path === "/oauth/token" && request.method === "POST") return token(await request.formData());
  if (path === "/oauth/deauthorize" && request.method === "POST") return deauthorize(request);
  if (path === "/api/v3/push_subscriptions" && request.method === "POST") {
    return createSubscription(await request.formData());
  }
  if (path === "/api/v3/push_subscriptions" && request.method === "GET") {
    return json(subscriptionCallback ? [{ id: 1, callback_url: subscriptionCallback }] : []);
  }
  if (/^\/api\/v3\/push_subscriptions\/\d+$/.test(path) && request.method === "DELETE") {
    subscriptionCallback = null;
    return new Response(null, { status: 204 });
  }
  if (path === "/dev/deauthorize" && request.method === "POST") {
    revokedAt = lastIssuedAt;
    return pushEvent({
      object_type: "athlete",
      aspect_type: "update",
      object_id: ATHLETE.id,
      updates: { authorized: "false" },
    });
  }
  const deleted = /^\/dev\/activities\/(\d+)\/delete$/.exec(path);
  if (deleted && request.method === "POST") {
    deletedActivityIds.add(Number(deleted[1]));
    return pushEvent({
      object_type: "activity",
      aspect_type: "delete",
      object_id: Number(deleted[1]),
    });
  }
  if (!isLive(bearerToken(request), "access")) return unauthorized("access_token");
  if (path === "/api/v3/athlete") return json(ATHLETE);
  if (path === "/api/v3/athlete/zones") return json(ZONES);
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
    const spec = buildCatalog(new Date()).find(
      (item) => item.id === Number(streams[1]) && !deletedActivityIds.has(item.id),
    );
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

/** Strava calls the callback with a challenge and only subscribes if it is echoed back. */
async function createSubscription(form: FormData) {
  const callbackUrl = form.get("callback_url");
  const verifyToken = form.get("verify_token");
  if (typeof callbackUrl !== "string" || typeof verifyToken !== "string") {
    return json({ message: "Bad Request", field: "callback_url" }, 400);
  }
  const handshake = new URL(callbackUrl);
  handshake.searchParams.set("hub.mode", "subscribe");
  handshake.searchParams.set("hub.verify_token", verifyToken);
  handshake.searchParams.set("hub.challenge", "mock-challenge");
  const response = await fetch(handshake);
  const body = response.ok ? ((await response.json()) as { "hub.challenge"?: string }) : {};
  if (body["hub.challenge"] !== "mock-challenge") {
    return json(
      { message: "Bad Request", errors: [{ field: "callback url", code: "not verifiable" }] },
      400,
    );
  }
  subscriptionCallback = callbackUrl;
  return json({ id: 1 }, 201);
}

/** Without a subscription, events go to this app's own webhook so the dev loop needs no setup. */
async function pushEvent(event: Record<string, unknown>) {
  const callback =
    subscriptionCallback ?? stravaWebhookUrl(env.BETTER_AUTH_URL, env.STRAVA_WEBHOOK_SECRET ?? "");
  const response = await fetch(callback, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...event,
      owner_id: ATHLETE.id,
      subscription_id: 1,
      event_time: Math.floor(Date.now() / 1000),
    }),
  });
  return json({ delivered: response.ok }, response.ok ? 200 : 502);
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
type MockSpec = {
  id: number;
  kind: MockKind;
  name: string;
  start: Date;
  minutes: number;
  /** No strap or power meter, so training load has to borrow heart rate from similar sessions. */
  noSensors?: boolean;
};

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
    .filter((spec) => !deletedActivityIds.has(spec.id))
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

  const push = (kind: MockKind, name: string, start: Date, minutes: number, noSensors = false) => {
    if (start.getTime() > now.getTime()) return;
    items.push({ id: ID_BASE + seq, kind, name, start, minutes, noSensors });
    seq += 1;
  };

  for (let week = 7; week >= 0; week -= 1) {
    const weekMonday = addUtcDays(monday, -week * 7);
    push("ride", "Morning ride", atUtcHour(addUtcDays(weekMonday, 1), 7), 60, week === 6);
    if (week === 2) {
      push("trailRun", "Trail run", atUtcHour(addUtcDays(weekMonday, 2), 7), 55);
    } else {
      push("run", "Lunch run", atUtcHour(addUtcDays(weekMonday, 2), 7), 45, week === 6);
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
    if (week === 3) push("walk", "Park walk", atUtcHour(addUtcDays(weekMonday, 4), 12), 40, true);
    if (week === 4) {
      push("virtualRide", "Indoor ride", atUtcHour(addUtcDays(weekMonday, 4), 18), 45);
    }
    if (week === 5) push("swim", "Pool swim", atUtcHour(addUtcDays(weekMonday, 4), 12), 30);
    // A weekly swim and two very long rides, so every bests tab has distances to rank.
    push("swim", "Morning swim", atUtcHour(weekMonday, 7), 35 + (week % 3) * 10);
    if (week === 3) push("ride", "Gran fondo", atUtcHour(addUtcDays(weekMonday, 6), 7), 240);
    if (week === 6) push("ride", "Century ride", atUtcHour(addUtcDays(weekMonday, 6), 7), 260);
  }

  return items.sort((left, right) => right.start.getTime() - left.start.getTime());
}

function hasPower(spec: MockSpec) {
  return (
    !spec.noSensors &&
    (spec.kind === "ride" || spec.kind === "ftpRide" || spec.kind === "virtualRide")
  );
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
  const base = speedMps(spec.kind) * formFactor(spec) * (isEasyRun(spec) ? EASY_RUN_SPEED : 1);
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
      // A faster stretch mid-session, so short bests beat long ones.
      speed.push(base * (progress > 0.4 && progress < 0.5 ? 1.08 : 1));
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
  const power = hasPower(spec);
  const heart = !spec.noSensors;
  const avgWatts = power ? (spec.kind === "ftpRide" ? 198 : 190) : undefined;
  const avgHr = isEasyRun(spec)
    ? 126
    : spec.kind === "swim"
      ? 128
      : spec.kind === "walk"
        ? 110
        : 148;
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
    has_heartrate: heart,
    average_heartrate: heart ? avgHr : undefined,
    max_heartrate: heart ? (isEasyRun(spec) ? 131 : avgHr + 28) : undefined,
    average_watts: avgWatts,
    device_watts: power,
    weighted_average_watts: avgWatts ? Math.round(avgWatts * 1.05) : undefined,
  } as SummaryActivity;
}

function streamsFor(spec: MockSpec): StreamSet {
  const samples = Math.max(2, Math.round((spec.minutes * 60) / STREAM_STEP_SEC) + 1);
  const gpsOn = hasGps(spec.kind);
  const power = hasPower(spec);
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
    heartrate: spec.noSensors ? undefined : stream(indexes.map((i) => heartAt(spec, progress(i)))),
    cadence: stream(indexes.map(() => (power ? 88 : spec.kind === "swim" ? 0 : 164))),
    watts: power
      ? stream(indexes.map((i) => Math.round(wattsAt(spec.kind, progress(i)) * formFactor(spec))))
      : undefined,
    temp: stream(indexes.map(() => 16)),
    moving: stream(indexes.map(() => true)),
    grade_smooth: stream(terrain.grade),
  } as StreamSet;
}

/**
 * Long runs are easy: slower, and held in running zone 2 after a short warm-up (about 124–131 bpm
 * for the LTHR the lunch runs give), so the easy pace from heart rate has flat zone 2 to read.
 */
const EASY_RUN_SPEED = 0.88;

function isEasyRun(spec: MockSpec) {
  return spec.kind === "run" && spec.name === "Long run";
}

function heartAt(spec: MockSpec, progress: number) {
  const { kind } = spec;
  if (isEasyRun(spec)) {
    if (progress < 0.08) return 112 + Math.round((progress / 0.08) * 14);
    return 127 + Math.round(Math.sin(progress * Math.PI * 6) * 3);
  }
  if (kind === "walk") return 108 + Math.round(Math.sin(progress * Math.PI) * 8);
  if (kind === "swim") return 126 + Math.round(Math.sin(progress * Math.PI) * 10);
  if (kind === "ftpRide") return progress < 0.2 ? 132 : progress < 0.6 ? 165 : 128;
  return 142 + Math.round(Math.sin(progress * Math.PI) * 14);
}

/**
 * Each session a little faster or slower than the last, and the athlete fitter week by week,
 * so best efforts differ between activities and progress over the eight weeks.
 */
function formFactor(spec: MockSpec) {
  const ageDays = (Date.now() - spec.start.getTime()) / 86_400_000;
  const jitter = ((spec.id * 7919) % 13) - 6;
  return (1 + jitter / 100) * (1 - ageDays * 0.0008);
}

function wattsAt(kind: MockKind, progress: number) {
  // A short sprint in every ride, so the power curve has a real peak.
  if (progress > 0.5 && progress < 0.505) return 620;
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
