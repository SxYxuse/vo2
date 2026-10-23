import { format, parseISO } from "date-fns";
import { cn } from "cn";

import { PHASES, type PhaseKind } from "@/services/season-phase.ts";
import {
  daysBetween,
  eventPriority,
  eventTitle,
  type GoalPriority,
  type SeasonEvent,
  type SeasonWeek,
} from "@/services/season.types.ts";
import { LEGEND_PHASES, PHASE_FILL, PRIORITY_FILL } from "@/components/season-style.ts";
import { Badge } from "@/components/ui/badge";

function Dot({ fill }: { fill: string }) {
  return <span aria-hidden className="size-1.5 rounded-full" style={{ background: fill }} />;
}

/** The phase as an outline badge with its map colour. */
export function PhaseBadge({ kind, lighter = false }: { kind: PhaseKind; lighter?: boolean }) {
  return (
    <Badge variant="outline">
      <Dot fill={PHASE_FILL[kind]} />
      {PHASES[kind].label}
      {lighter ? " · lighter week" : ""}
    </Badge>
  );
}

/** A goal's priority as an outline badge: "A", "B", or "C" with its colour. */
export function PriorityBadge({ priority }: { priority: GoalPriority }) {
  return (
    <Badge variant="outline" aria-label={`${priority} race`}>
      <Dot fill={PRIORITY_FILL[priority]} />
      {priority}
    </Badge>
  );
}

/** "Base for 22 more weeks, then Build from 12 Apr", from the map's first week on. */
export function phaseOutlook(weeks: SeasonWeek[]) {
  const [current] = weeks;
  if (!current) return null;
  const run = weeks.findIndex((week) => week.kind !== current.kind);
  const next = run > 0 ? weeks[run] : null;
  const label = PHASES[current.kind].label;
  if (!next) return `${label} through the season`;
  const left = run - 1;
  const head = left > 0 ? `${label} for ${left} more ${left === 1 ? "week" : "weeks"}` : label;
  return `${head}, then ${PHASES[next.kind].label} from ${format(parseISO(next.weekStart), "d MMM")}`;
}

/**
 * The season week by week: bar colour is the phase, height the hours the plan expects, flags the
 * goals by priority. Lighter weeks are paler.
 */
export function SeasonMap({
  weeks,
  events,
  compact = false,
}: {
  weeks: SeasonWeek[];
  events: SeasonEvent[];
  compact?: boolean;
}) {
  if (!weeks.length) return null;
  const maxHours = Math.max(1, ...weeks.map((week) => week.hours));
  const first = weeks[0]!.weekStart;
  const indexOf = (date: string) => Math.floor(daysBetween(first, date) / 7);
  // A month label per month, skipped when the first one would crowd the next.
  const months = weeks
    .map((week, index) => ({ week, index }))
    .filter(
      ({ week, index }) =>
        index === 0 || week.weekStart.slice(0, 7) !== weeks[index - 1]!.weekStart.slice(0, 7),
    )
    .filter(({ index }, at, all) => at > 0 || (all[1]?.index ?? Infinity) - index >= 3);
  const kinds = LEGEND_PHASES.filter((kind) => weeks.some((week) => week.kind === kind));

  return (
    <div className="flex flex-col gap-1.5">
      <div className="relative h-3" aria-hidden>
        {events.map((event) => {
          const index = indexOf(event.date);
          if (index < 0 || index >= weeks.length) return null;
          return (
            <span
              key={event.date}
              title={eventTitle(event)}
              className="absolute top-0.5 size-2 -translate-x-1/2 rounded-full"
              style={{
                left: `${((index + 0.5) / weeks.length) * 100}%`,
                background: PRIORITY_FILL[eventPriority(event)],
              }}
            />
          );
        })}
      </div>
      <div
        role="img"
        aria-label={phaseOutlook(weeks) ?? "Season map"}
        className={cn("flex items-end gap-px", compact ? "h-10" : "h-24")}
      >
        {weeks.map((week, index) => (
          <div
            key={week.weekStart}
            title={`${format(parseISO(week.weekStart), "d MMM")} · ${PHASES[week.kind].label}${week.lighter ? " (lighter)" : ""} · ${week.hours} h`}
            className={cn(
              "min-w-0 flex-1 rounded-t-[2px]",
              week.lighter && "opacity-50",
              index === 0 && "ring-foreground ring-1 ring-inset",
            )}
            style={{
              height: `${Math.max(8, (week.hours / maxHours) * 100)}%`,
              background: PHASE_FILL[week.kind],
            }}
          />
        ))}
      </div>
      {!compact ? (
        <div className="text-muted-foreground relative h-4 text-[10px]" aria-hidden>
          {months.map(({ week, index }) => (
            <span
              key={week.weekStart}
              className="absolute top-0"
              style={{ left: `${(index / weeks.length) * 100}%` }}
            >
              {format(parseISO(week.weekStart), "MMM")}
            </span>
          ))}
        </div>
      ) : null}
      {!compact ? (
        <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {kinds.map((kind) => (
            <span key={kind} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: PHASE_FILL[kind] }} />
              {PHASES[kind].label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full opacity-50"
              style={{ background: PHASE_FILL.build }}
            />
            Lighter week
          </span>
        </div>
      ) : null}
    </div>
  );
}
