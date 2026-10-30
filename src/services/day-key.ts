/*
 * Calendar day keys ("2026-10-30") in the athlete's time zone. Apart from the services that use
 * them so the calendar's URL parsing, which ships with the app's entry, loads nothing else.
 */

import { TZDate } from "@date-fns/tz";
import { addDays, startOfDay } from "date-fns";

// Building an Intl.DateTimeFormat costs far more than formatting with one, and day keys run
// once per activity and per day of history, so keep one formatter per time zone.
const dayKeyFormats = new Map<string, Intl.DateTimeFormat>();

export function dayKey(date: Date, timeZone: string) {
  let format = dayKeyFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayKeyFormats.set(timeZone, format);
  }
  return format.format(date);
}

export function weekStartKey(date: Date, timeZone: string) {
  const zoned = startOfDay(new TZDate(date.getTime(), timeZone));
  const weekday = zoned.getDay();
  const offset = weekday === 0 ? 6 : weekday - 1;
  return dayKey(addDays(zoned, -offset), timeZone);
}

export function addDayKey(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}
