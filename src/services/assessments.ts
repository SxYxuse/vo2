import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { APP_NAME } from "#/lib/brand.ts";
import type { AssessmentResult } from "./assessments-score.ts";
import { sportGroupFor } from "./sport-groups.ts";
import type { TrainingPlan } from "./training-plan.types.ts";

export type { AssessmentResult } from "./assessments-score.ts";

export const ASSESSMENT_LOOKBACK_DAYS = 56;

export const ASSESSMENT_SESSIONS = [
  {
    id: "ftp-20" as const,
    family: "cycling" as const,
    title: "FTP 20-min",
    minutes: 75,
    gear: "Indoor trainer with a power meter or smart trainer. A flat, traffic-free road works if you can hold even watts.",
    why: "Estimates functional threshold power (about 60-min maximal power) and cycling lactate-threshold heart rate from one field test.",
    source:
      "Allen & Coggan, Training and Racing with a Power Meter. FTP = 95% of 20-min mean power.",
    protocol: [
      "Do this fresh, alone, on a trainer if you can. Do not watch an old FTP target — hold the highest even power you can finish.",
      "Warm up 20 min easy. Then 3 × 1 min fast pedaling (≥100 rpm) with 1 min easy between. 5 min easy.",
      "5 min all-out (open up, not a sprint). 10 min easy. Lap your computer.",
      "20 min maximal time trial: highest mean power you can hold. Start a touch conservative so you do not fade. Lap at the start and end of this block.",
      "10 min easy spin.",
    ],
    scoring: [
      "FTP (watts) = 20-min average power × 0.95.",
      "Cycling LTHR ≈ average heart rate of that same 20-min block.",
      `Open the ride in ${APP_NAME} and flag it as FTP 20-min. Do not rely on the Strava title.`,
    ],
    caveats: [
      "This estimates ~60-min power; some riders’ 20-min × 0.95 runs a little high or low versus a true hour.",
      "The 5-min opener is part of the published warmup. Skipping it changes the 20-min result.",
    ],
  },
  {
    id: "beep-test" as const,
    family: "running" as const,
    title: "Beep test",
    minutes: 20,
    gear: "A measured 20.0 m course on a non-slip surface and a Léger 20 m shuttle audio (1-min stages).",
    why: "Validated field estimate of running VO2max. Peak HR is a usable field max HR if you reach exhaustion.",
    source:
      "Léger, Mercier & Gadoury, J Sports Sci 1988; Léger & Gadoury, Can J Sport Sci 1989 (adults).",
    protocol: [
      "Mark two lines exactly 20 m apart. Jog 5 min easy, then two strides.",
      "Stage 1 starts at 8.5 km/h. Speed rises 0.5 km/h every 1 min. Reach the line on the beep; one foot on or behind the line. Pivot and go. Do not cut the distance.",
      "First missed beep is a warning. Stop after two consecutive misses, or when you cannot hold the pace. Note the last completed stage (for example 11.0) and peak HR.",
      "Walk 3 min.",
    ],
    scoring: [],
    caveats: [
      "Adult prediction error is about ±4.4 ml/kg/min versus treadmill VO2max.",
      "Turns on a 20 m course often yield a slightly lower peak HR than a treadmill or hill max test.",
    ],
  },
  {
    id: "run-lthr" as const,
    family: "running" as const,
    title: "Run LTHR",
    minutes: 45,
    gear: "A flat, quiet loop or treadmill and a heart-rate strap. Solo — not a race or a group run.",
    why: "Field estimate of running lactate-threshold heart rate, the anchor for run zones. The beep test does not measure threshold.",
    source:
      "Friel, The 30-minute test: LTHR ≈ mean HR of the last 20 min of a solo 30-min time trial.",
    protocol: [
      "Warm up 10–15 min as you would before a race, including a few strides.",
      "Run 30 min all-out, alone. Treat it as a time trial the whole way — not 10 min easy then 20 min hard.",
      "Start a little conservative so you do not fade. Do not watch heart rate; watch effort.",
      "At exactly 10:00, press lap. Stop at 30:00. Cool down 5–10 min easy.",
    ],
    scoring: [
      "Running LTHR = average heart rate of minutes 10–30 (the last 20 min).",
      "Ignore the first 10 min average.",
      `Open the run in ${APP_NAME} and flag it as Run LTHR. Do not rely on the Strava title.`,
    ],
    caveats: [
      "Must be solo. A race or training partners push HR above true threshold.",
      "LTHR is sport-specific. Do not copy the bike number onto the run.",
    ],
  },
] as const;

export type AssessmentId = (typeof ASSESSMENT_SESSIONS)[number]["id"];

export type AssessmentStatus = "suggested" | "fatigued" | "recent" | "disabled" | "no-sport";

export type AssessmentHistoryRow = {
  id: string;
  activityId: string | null;
  activityTitle: string | null;
  completedAt: string;
  result: AssessmentResult;
  primary: number | null;
  delta: number | null;
};

export type AssessmentView = {
  id: AssessmentId;
  family: "running" | "cycling";
  title: string;
  minutes: number;
  gear: string;
  why: string;
  source: string;
  protocol: string[];
  scoring: string[];
  caveats: string[];
  enabled: boolean;
  status: AssessmentStatus;
  statusNote: string;
  primaryLabel: string;
  primaryUnit: string;
  history: AssessmentHistoryRow[];
};

export type ActivityFieldTest = {
  assessmentId: AssessmentId;
  title: string;
  result: AssessmentResult;
};

export const ASSESSMENT_IDS = ["ftp-20", "beep-test", "run-lthr"] as const;

export const flagActivityTestSchema = z.object({
  activityId: z.string().min(1),
  assessmentId: z.enum(ASSESSMENT_IDS).nullable(),
  lastStage: z.number().min(1).max(21).nullable().optional(),
});

export const activityTestFlagFormSchema = z
  .object({
    assessmentId: z.enum(["none", ...ASSESSMENT_IDS]),
    lastStage: z.string(),
  })
  .superRefine((data, ctx) => {
    if (data.assessmentId !== "beep-test") return;
    const parsed = Number(data.lastStage);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 21) {
      ctx.addIssue({
        code: "custom",
        path: ["lastStage"],
        message: "Enter a stage between 1 and 21.",
      });
    }
  });

export type ActivityTestFlagFormValues = z.infer<typeof activityTestFlagFormSchema>;

export type AssessmentsData = {
  signedIn: boolean;
  tsb: number;
  tests: AssessmentView[];
};

const STATUS_RANK: Record<AssessmentStatus, number> = {
  suggested: 0,
  fatigued: 1,
  recent: 2,
  "no-sport": 3,
  disabled: 4,
};

function sportEnabled(plan: TrainingPlan | null, family: "running" | "cycling") {
  if (!plan) return true;
  return family === "cycling" ? plan.maxRideSessions > 0 : plan.maxRunSessions > 0;
}

function testEnabled(plan: TrainingPlan | null, id: AssessmentId) {
  if (!plan) return true;
  if (id === "ftp-20") return plan.suggestFtpTest;
  if (id === "beep-test") return plan.suggestBeepTest;
  return plan.suggestRunLthrTest;
}

export function beepStageSpeedKmh(stage: number) {
  return 8 + 0.5 * stage;
}

export function beepVo2maxMlKgMin(speedKmh: number, age: number | null) {
  if (age != null && age < 18) {
    return 31.025 + 3.238 * speedKmh - 3.248 * age + 0.1536 * age * speedKmh;
  }
  return -27.4 + 6.0 * speedKmh;
}

function beepScoring(age: number | null) {
  const exampleSpeed = beepStageSpeedKmh(11);
  const exampleVo2 = Math.round(beepVo2maxMlKgMin(exampleSpeed, age));
  const youth = age != null && age < 18;
  return [
    "Last completed stage sets speed: stage 1 = 8.5 km/h, each full 1-min stage +0.5 km/h. If you stop mid-stage, use the previous completed stage.",
    youth
      ? `VO2max (ml/kg/min) = 31.025 + 3.238×speed − 3.248×age + 0.1536×age×speed (Léger et al., 1988). Use age ${age}.`
      : "VO2max (ml/kg/min) = −27.4 + 6.0 × last-stage speed in km/h (Léger & Gadoury 1989; adult equation holds age at 18).",
    `Example: stage 11.0 → ${exampleSpeed.toFixed(1)} km/h → about ${exampleVo2} ml/kg/min.`,
    "Peak HR is a field estimate of running max HR if you reached exhaustion.",
    `Open the run in ${APP_NAME}, flag it as Beep test, and enter the last completed stage.`,
  ];
}

export function isAssessmentTitle(title: string) {
  const needle = title.trim().toLowerCase();
  return ASSESSMENT_SESSIONS.some((test) => test.title.toLowerCase() === needle);
}

export function testsForSportType(sportType: string) {
  const group = sportGroupFor(sportType)?.id;
  if (group !== "cycling" && group !== "running") return [];
  return ASSESSMENT_SESSIONS.filter((test) => test.family === group).map((test) => ({
    id: test.id,
    title: test.title,
  }));
}

export function formatAssessmentResult(id: AssessmentId, result: AssessmentResult) {
  const parts: string[] = [];
  if (id === "ftp-20") {
    if (result.ftpWatts != null) parts.push(`${result.ftpWatts} W FTP`);
    if (result.cyclingLthr != null) parts.push(`${result.cyclingLthr} bpm LTHR`);
  } else if (id === "beep-test") {
    if (result.vo2max != null) parts.push(`${result.vo2max} ml/kg/min`);
    if (result.lastStage != null) parts.push(`stage ${result.lastStage}`);
    if (result.peakHr != null) parts.push(`${result.peakHr} bpm peak`);
  } else if (result.runLthr != null) {
    parts.push(`${result.runLthr} bpm LTHR`);
    if (result.peakHr != null) parts.push(`${result.peakHr} bpm peak`);
  }
  return parts.length ? parts.join(" · ") : "Flagged. Score this from streams or enter the stage.";
}

export function primaryMetric(id: AssessmentId): {
  label: string;
  unit: string;
  key: keyof AssessmentResult;
} {
  if (id === "ftp-20") return { label: "FTP", unit: "W", key: "ftpWatts" };
  if (id === "beep-test") return { label: "VO2max", unit: "ml/kg/min", key: "vo2max" };
  return { label: "LTHR", unit: "bpm", key: "runLthr" };
}

export function withHistoryDeltas(
  rows: Omit<AssessmentHistoryRow, "delta">[],
): AssessmentHistoryRow[] {
  return rows.map((row, index) => {
    const older = rows[index + 1];
    const delta =
      row.primary != null && older?.primary != null
        ? Math.round((row.primary - older.primary) * 10) / 10
        : null;
    return { ...row, delta };
  });
}

export function assessmentStatuses(input: {
  plan: TrainingPlan | null;
  tsb: number;
  recentIds: AssessmentId[];
  age?: number | null;
  history?: Record<AssessmentId, AssessmentHistoryRow[]>;
}): AssessmentView[] {
  const tests = ASSESSMENT_SESSIONS.map((test) => {
    const enabled = testEnabled(input.plan, test.id);
    const hasSport = sportEnabled(input.plan, test.family);
    const recent = input.recentIds.includes(test.id);
    const metric = primaryMetric(test.id);
    let status: AssessmentStatus = "suggested";
    let statusNote =
      "Form looks good. Do this on a fresh day, not stacked on a hard bucket session.";
    if (!enabled) {
      status = "disabled";
      statusNote = "Turned off in Settings. Protocol stays here if you still want to run it.";
    } else if (!hasSport) {
      status = "no-sport";
      statusNote =
        test.family === "cycling"
          ? "Add at least one ride slot in Settings to make FTP useful."
          : "Add at least one run slot in Settings to make this useful.";
    } else if (recent) {
      status = "recent";
      statusNote =
        "A flagged result is on file from the last 8 weeks. Repeat when that window lapses.";
    } else if (input.tsb < 0) {
      status = "fatigued";
      statusNote =
        "Wait until form (TSB) is at or above 0. All-out tests while fatigued under-read.";
    }
    return {
      id: test.id,
      family: test.family,
      title: test.title,
      minutes: test.minutes,
      gear: test.gear,
      why: test.why,
      source: test.source,
      protocol: [...test.protocol],
      scoring: test.id === "beep-test" ? beepScoring(input.age ?? null) : [...test.scoring],
      caveats: [...test.caveats],
      enabled,
      status,
      statusNote,
      primaryLabel: metric.label,
      primaryUnit: metric.unit,
      history: input.history?.[test.id] ?? [],
    };
  });
  return tests.sort((left, right) => STATUS_RANK[left.status] - STATUS_RANK[right.status]);
}

export const loadAssessments = createServerFn({ method: "GET" }).handler(
  async (): Promise<AssessmentsData> => {
    const { loadAssessmentsImpl } = await import("./assessments.server.ts");
    return loadAssessmentsImpl();
  },
);

export const flagActivityTest = createServerFn({ method: "POST" })
  .validator(flagActivityTestSchema)
  .handler(async ({ data }): Promise<ActivityFieldTest | null> => {
    const { flagActivityTestImpl } = await import("./assessments.server.ts");
    return flagActivityTestImpl(data);
  });
