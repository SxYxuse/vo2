import { format, parseISO } from "date-fns";

import { KEY_SESSION_PRESETS, addDayKey, formatHours } from "@/services/training-plan.types.ts";
import { partNoun } from "@/services/week-target.ts";
import type { PlannedDay, PlannedSession } from "@/services/week-plan.ts";

/** A planned session's name: the key session's own name when known, else its type. */
export function sessionTitle(
  session: PlannedSession,
  day: PlannedDay,
  keyNames?: Map<string, string>,
) {
  if (session.kind === "race") return day.note ?? "Race";
  if (session.kind === "opener") return "Opener";
  if (session.sport === "other") return "Session";
  if (session.kind === "key" && session.keySessionId) {
    const known = keyNames?.get(session.keySessionId);
    if (known)
      return session.keySessionId.endsWith("-long") ? `Long ${partNoun(session.sport)}` : known;
    const preset = KEY_SESSION_PRESETS.find((item) =>
      session.keySessionId!.endsWith(`-${item.id}`),
    );
    if (preset?.id === "long") return `Long ${partNoun(session.sport)}`;
    return preset?.label ?? "Key session";
  }
  const noun = partNoun(session.sport);
  return session.kind === "recovery" ? `Recovery ${noun}` : `Easy ${noun}`;
}

export function minutesLabel(minutes: number) {
  return formatHours(minutes / 60);
}

/** "Today", "Tomorrow", or "Wed 21". */
export function dayLabel(date: string, today: string) {
  if (date === today) return "Today";
  if (date === addDayKey(today, 1)) return "Tomorrow";
  return format(parseISO(`${date}T12:00:00`), "EEE d");
}

export function weekdayShort(date: string) {
  return format(parseISO(`${date}T12:00:00`), "EEE");
}

export function dayOfMonth(date: string) {
  return format(parseISO(`${date}T12:00:00`), "d");
}

export function weekRangeLabel(weekStart: string) {
  const start = parseISO(`${weekStart}T12:00:00`);
  const end = parseISO(`${addDayKey(weekStart, 6)}T12:00:00`);
  return `${format(start, "d MMM")} – ${format(end, "d MMM")}`;
}

export function signed(value: number) {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${rounded}`;
  if (rounded < 0) return `−${Math.abs(rounded)}`;
  return "0";
}
