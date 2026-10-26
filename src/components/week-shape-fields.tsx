"use client";

import { MinusIcon, PlusIcon } from "lucide-react";

import { SPORT_STYLE } from "@/components/sport-style.ts";
import {
  KEY_SPORTS,
  MAX_DOUBLE_DAYS,
  MAX_REST_DAYS,
  MIN_REST_DAYS,
  WEEKDAYS,
  normalizeShape,
  trainingDayCount,
  type KeySport,
  type WeekShape,
} from "@/services/training-plan.types.ts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** What the builder read from the athlete's history, shown next to each choice. */
export type ShapeHints = {
  /** Share of weeks with a session on each weekday, Sunday first. */
  weekdayShare?: number[];
  usualLongWeekday?: number | null;
  doubleDaysPerWeek?: number;
};

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function FromHistory({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="secondary" className="font-normal">
      {children}
    </Badge>
  );
}

/**
 * The week's shape (ADR 0026): training and rest days, the long session day, double-session
 * days, and the sports to plan. Shared by the plan builder and Settings → Training.
 */
export function WeekShapeFields({
  value,
  onChange,
  hints = {},
}: {
  value: WeekShape;
  onChange: (next: WeekShape) => void;
  hints?: ShapeHints;
}) {
  const training = WEEKDAYS.filter((day) => !value.restWeekdays.includes(day.id));
  const trainingDays = trainingDayCount(value);
  const update = (patch: Partial<WeekShape>) => onChange(normalizeShape({ ...value, ...patch }));

  return (
    <div className="flex flex-col gap-6">
      <FieldSet>
        <FieldLegend className="flex items-center gap-2">Training days</FieldLegend>
        <FieldDescription>
          Tap a day to make it a rest day. VO2 never plans a session on a rest day.
        </FieldDescription>
        <ToggleGroup
          multiple
          variant="outline"
          spacing={1}
          className="grid w-full grid-cols-7"
          value={training.map((day) => String(day.id))}
          onValueChange={(next) => {
            const trainingIds = (next as string[]).map(Number);
            const rest = WEEKDAYS.map((day) => day.id).filter((id) => !trainingIds.includes(id));
            if (rest.length < MIN_REST_DAYS || rest.length > MAX_REST_DAYS) return;
            update({ restWeekdays: rest });
          }}
        >
          {WEEKDAYS.map((day) => {
            const share = hints.weekdayShare?.[day.id];
            return (
              <ToggleGroupItem
                key={day.id}
                value={String(day.id)}
                aria-label={day.label}
                className="text-muted-foreground aria-pressed:text-foreground h-auto min-h-12 w-full flex-col gap-0.5 px-0 py-1.5"
              >
                <span className="text-sm font-semibold">{day.label.slice(0, 1)}</span>
                <span className="text-[10px] font-normal opacity-70">
                  {value.restWeekdays.includes(day.id)
                    ? "rest"
                    : share != null
                      ? `${Math.round(share * 100)}%`
                      : ""}
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        <FieldDescription>
          {plural(trainingDays, "training day")}, {plural(7 - trainingDays, "rest day")}.
          {hints.weekdayShare ? " % is how often you trained that day in the last 12 weeks." : ""}
        </FieldDescription>
      </FieldSet>

      <FieldSet>
        <FieldLegend className="flex flex-wrap items-center gap-2">
          Long session day
          {hints.usualLongWeekday != null ? (
            <FromHistory>
              Usually {WEEKDAYS.find((day) => day.id === hints.usualLongWeekday)?.label}
            </FromHistory>
          ) : null}
        </FieldLegend>
        <FieldDescription>Where the week's long session goes, when it has one.</FieldDescription>
        <ToggleGroup
          size="sm"
          variant="outline"
          spacing={0}
          className="flex-wrap"
          value={[String(value.longWeekday)]}
          onValueChange={(next) => {
            const picked = (next as string[])[0];
            if (picked == null) return;
            update({ longWeekday: Number(picked) });
          }}
        >
          {training.map((day) => (
            <ToggleGroupItem key={day.id} value={String(day.id)}>
              {day.label.slice(0, 3)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FieldSet>

      <FieldSet>
        <FieldLegend className="flex flex-wrap items-center gap-2">
          Double-session days
          {hints.doubleDaysPerWeek != null ? (
            <FromHistory>{Math.round(hints.doubleDaysPerWeek * 10) / 10} a week now</FromHistory>
          ) : null}
        </FieldLegend>
        <FieldDescription>
          Days a week you can fit two sessions, such as a run before work and a ride after. The
          second one is always easy.
        </FieldDescription>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="One fewer double-session day"
            disabled={value.doubleDays <= 0}
            onClick={() => update({ doubleDays: value.doubleDays - 1 })}
          >
            <MinusIcon />
          </Button>
          <span className="w-6 text-center font-mono text-lg font-semibold tabular-nums">
            {value.doubleDays}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="One more double-session day"
            disabled={value.doubleDays >= Math.min(MAX_DOUBLE_DAYS, trainingDays)}
            onClick={() => update({ doubleDays: value.doubleDays + 1 })}
          >
            <PlusIcon />
          </Button>
        </div>
      </FieldSet>

      <FieldSet>
        <FieldLegend>Sports to plan</FieldLegend>
        <FieldDescription>
          Your goal's sport always gets the key sessions. Other sports get easy time.
        </FieldDescription>
        <ToggleGroup
          multiple
          size="sm"
          variant="outline"
          className="flex-wrap"
          value={value.sports}
          onValueChange={(next) => {
            const sports = KEY_SPORTS.filter((sport) => (next as string[]).includes(sport));
            if (!sports.length) return;
            update({ sports: sports as KeySport[] });
          }}
        >
          {KEY_SPORTS.map((sport) => {
            const style = SPORT_STYLE[sport];
            const Icon = style.icon;
            return (
              <ToggleGroupItem key={sport} value={sport}>
                <Icon data-icon="inline-start" />
                {style.label}
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
      </FieldSet>
    </div>
  );
}
