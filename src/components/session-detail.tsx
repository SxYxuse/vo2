"use client";

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon, MoonIcon, TriangleAlertIcon } from "lucide-react";
import { cn } from "cn";

import { SPORT_STYLE } from "@/components/sport-style.ts";
import { HR_ZONES } from "@/services/heart-rate.ts";
import {
  formatHours,
  keySessionWorkMinutes,
  zoneLabel,
  type TrainingPlan,
} from "@/services/training-plan.ts";
import {
  KEY_SESSION_DONE_SHARE,
  minutesByZone,
  sessionSteps,
  type Recommendation,
  type SessionStep,
  type StepZone,
  type WeekSummary,
  type WeekTargetData,
} from "@/services/week-target.ts";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ZONE_ORDER: StepZone[] = ["z1", "z2", "z3", "z4", "z5"];

function zoneStyle(zone: StepZone) {
  const index = ZONE_ORDER.indexOf(zone);
  return { index, info: HR_ZONES[index] };
}

function minutesLabel(minutes: number) {
  return formatHours(minutes / 60);
}

function signed(value: number) {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return "0";
}

function tickStep(total: number) {
  if (total <= 60) return 10;
  if (total <= 120) return 15;
  if (total <= 240) return 30;
  return 60;
}

function tickLabel(minutes: number) {
  if (minutes === 0) return "0";
  return minutes < 60 ? `${minutes}′` : formatHours(minutes / 60);
}

function stepSummary(step: SessionStep) {
  return `${step.label} · ${minutesLabel(step.minutes)} · ${zoneLabel(step.zone)} · ${step.cue}`;
}

/** Time across, zone up: each step is a block as wide as its duration and as tall as its zone. */
export function SessionProfile({ steps }: { steps: SessionStep[] }) {
  const [active, setActive] = useState<number | null>(null);
  const total = steps.reduce((sum, step) => sum + step.minutes, 0);
  if (!total) return null;
  const every = tickStep(total);
  const ticks: number[] = [];
  for (let minute = 0; minute <= total; minute += every) ticks.push(minute);
  const shown = active == null ? null : steps[active];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground min-h-5 text-sm" aria-live="polite">
        {shown ? stepSummary(shown) : "Hover or focus a block for its target."}
      </p>
      <div className="flex gap-2">
        <div
          aria-hidden
          className="text-muted-foreground flex h-44 w-6 shrink-0 flex-col-reverse justify-between text-[10px] tabular-nums"
        >
          {ZONE_ORDER.map((zone) => (
            <span key={zone} className="leading-none">
              {zoneLabel(zone)}
            </span>
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="relative h-44">
            {ZONE_ORDER.map((zone, index) => (
              <div
                key={zone}
                aria-hidden
                className="border-border absolute inset-x-0 border-t border-dashed"
                style={{ bottom: `${((index + 1) / ZONE_ORDER.length) * 100}%` }}
              />
            ))}
            <div
              role="list"
              aria-label="Session profile"
              className="absolute inset-0 flex items-end gap-0.5"
              onMouseLeave={() => setActive(null)}
            >
              {steps.map((step, index) => {
                const { index: zoneIndex, info } = zoneStyle(step.zone);
                return (
                  <div
                    // Steps repeat (Easy, Rep n) so the position is the identity.
                    // oxlint-disable-next-line react/no-array-index-key
                    key={index}
                    role="listitem"
                    tabIndex={0}
                    aria-label={stepSummary(step)}
                    className={cn(
                      "min-w-0.5 rounded-t-[4px] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ring",
                      active != null && active !== index && "opacity-50",
                    )}
                    style={{
                      flexGrow: step.minutes,
                      flexBasis: 0,
                      height: `${((zoneIndex + 1) / ZONE_ORDER.length) * 100}%`,
                      backgroundColor: info.color,
                    }}
                    onMouseEnter={() => setActive(index)}
                    onFocus={() => setActive(index)}
                    onBlur={() => setActive(null)}
                  />
                );
              })}
            </div>
          </div>
          <div aria-hidden className="text-muted-foreground relative h-4 text-[10px] tabular-nums">
            {ticks.map((minute) => (
              <span
                key={minute}
                className={cn(
                  "absolute whitespace-nowrap",
                  minute === 0
                    ? "translate-x-0"
                    : minute === total
                      ? "-translate-x-full"
                      : "-translate-x-1/2",
                )}
                style={{ left: `${(minute / total) * 100}%` }}
              >
                {tickLabel(minute)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <ZoneLegend steps={steps} />
    </div>
  );
}

/** Compact, decorative profile for cards; the session page has the readable chart. */
export function SessionStrip({ steps }: { steps: SessionStep[] }) {
  if (!steps.length) return null;
  return (
    <div aria-hidden className="flex h-10 items-end gap-0.5">
      {steps.map((step, index) => {
        const { index: zoneIndex, info } = zoneStyle(step.zone);
        return (
          <div
            // oxlint-disable-next-line react/no-array-index-key
            key={index}
            className="min-w-0.5 rounded-t-[3px]"
            style={{
              flexGrow: step.minutes,
              flexBasis: 0,
              height: `${((zoneIndex + 1) / ZONE_ORDER.length) * 100}%`,
              backgroundColor: info.color,
            }}
          />
        );
      })}
    </div>
  );
}

function ZoneLegend({ steps }: { steps: SessionStep[] }) {
  const totals = minutesByZone(steps);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {ZONE_ORDER.filter((zone) => totals[zone] > 0).map((zone) => {
        const { info } = zoneStyle(zone);
        return (
          <li key={zone} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-[2px]"
              style={{ backgroundColor: info.color }}
            />
            <span>
              {info.label} · {info.name}
            </span>
            <span className="text-muted-foreground font-mono tabular-nums">
              {minutesLabel(totals[zone])}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function StepsTable({ steps }: { steps: SessionStep[] }) {
  let elapsed = 0;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Start</TableHead>
          <TableHead>Step</TableHead>
          <TableHead>Duration</TableHead>
          <TableHead>Zone</TableHead>
          <TableHead>Target</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {steps.map((step, index) => {
          const start = elapsed;
          elapsed += step.minutes;
          const { info } = zoneStyle(step.zone);
          return (
            // oxlint-disable-next-line react/no-array-index-key
            <TableRow key={index} className={cn(step.work && "font-medium")}>
              <TableCell className="text-muted-foreground font-mono tabular-nums">
                {tickLabel(start)}
              </TableCell>
              <TableCell>{step.label}</TableCell>
              <TableCell className="font-mono tabular-nums">{minutesLabel(step.minutes)}</TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="size-2.5 rounded-[2px]"
                    style={{ backgroundColor: info.color }}
                  />
                  {zoneLabel(step.zone)}
                </span>
              </TableCell>
              <TableCell className="whitespace-normal">{step.cue}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="font-mono text-lg font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-muted-foreground text-xs">{hint}</span> : null}
    </div>
  );
}

export function SessionDetail({
  pick,
  data,
  summary,
  source,
}: {
  pick: Recommendation;
  data: WeekTargetData & { plan: TrainingPlan };
  summary: WeekSummary;
  source: "today" | "week-mix";
}) {
  const steps = useMemo(() => sessionSteps(pick, data), [pick, data]);
  const SportIcon = pick.kind === "rest" ? MoonIcon : SPORT_STYLE[pick.family].icon;
  const status = pick.keySession
    ? summary.keySessions.find((item) => item.session.id === pick.keySession?.id)
    : null;
  const needed = pick.keySession
    ? Math.round(keySessionWorkMinutes(pick.keySession) * KEY_SESSION_DONE_SHARE)
    : 0;

  return (
    <div className="flex flex-col gap-3 sm:gap-6">
      <div className="flex flex-col gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          render={<Link to="/week" />}
          nativeButton={false}
        >
          <ArrowLeftIcon data-icon="inline-start" />
          Week target
        </Button>
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-semibold tracking-tight sm:text-2xl">
          <SportIcon aria-hidden className={cn("size-5", SPORT_STYLE[pick.family].text)} />
          {pick.title}
          {pick.minutes > 0 ? (
            <Badge variant="outline">
              {minutesLabel(pick.parts.reduce((sum, part) => sum + part.minutes, 0))}
            </Badge>
          ) : null}
          {pick.keySession ? <Badge variant="info">Key session</Badge> : null}
          {status?.done ? <Badge variant="success">Done</Badge> : null}
          {source === "today" ? <Badge variant="secondary">Today’s pick</Badge> : null}
        </h1>
        <p className="text-muted-foreground text-sm">{pick.description}</p>
      </div>

      {steps.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>
              Time across, heart-rate zone up. Targets use watts on bikes with a power meter, heart
              rate otherwise.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SessionProfile steps={steps} />
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-3 sm:gap-6 lg:grid-cols-3">
        {steps.length ? (
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Steps</CardTitle>
            </CardHeader>
            <CardContent>
              <StepsTable steps={steps} />
            </CardContent>
          </Card>
        ) : null}
        <Card>
          <CardHeader>
            <CardTitle>Effect on the week</CardTitle>
            <CardDescription>If you do it today.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Left after" value={minutesLabel(pick.after.remainingMinutes)} />
              <Stat label="Load" value={`~${pick.load}`} />
              <Stat
                label="Form tomorrow"
                value={signed(pick.after.formTomorrow)}
                hint={pick.after.formTomorrowLabel}
              />
              <Stat label="Fitness" value={`+${pick.after.fitnessChange.toFixed(1)}`} />
            </div>
            {pick.warnings.length ? (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>Your call</AlertTitle>
                <AlertDescription>
                  <ul className="flex list-disc flex-col gap-0.5 ps-4">
                    {pick.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            ) : null}
            {pick.reasons.length ? (
              <ul className="text-muted-foreground flex list-disc flex-col gap-0.5 ps-4 text-xs">
                {pick.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
            {pick.keySession ? (
              <p className="text-muted-foreground border-t pt-3 text-xs">
                Ticked off when one ride or run{" "}
                {pick.keySession.kind === "long"
                  ? `lasts at least ${minutesLabel(needed)}.`
                  : `spends at least ${minutesLabel(needed)} at ${zoneLabel(pick.keySession.zone)} or above.`}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
