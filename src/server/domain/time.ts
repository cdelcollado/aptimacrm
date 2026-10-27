/**
 * Calendar and instant helpers for the org timezone. Instants are stored as timestamptz;
 * local dates (due days, "when did the call happen") are converted once, here.
 */

/** Offset in minutes of `timeZone` at the given instant (positive east of UTC). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const truncated = instant.getTime() - (instant.getTime() % 1000);
  return Math.round((asUtc - truncated) / 60_000);
}

/**
 * Convert a local wall-clock time ("2026-10-25T14:30" or "2026-10-25") in `timeZone` to a UTC
 * instant. Two passes handle DST transitions; ambiguous or skipped local times resolve to the
 * later candidate, which is documented behaviour for the UI ("14:30 means the offset in force
 * when that time occurs").
 */
export function zonedLocalToInstant(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00"] = m;
  const asUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (Number.isNaN(asUtc)) return null;
  const firstGuess = new Date(asUtc - zoneOffsetMinutes(new Date(asUtc), timeZone) * 60_000);
  const secondGuess = new Date(asUtc - zoneOffsetMinutes(firstGuess, timeZone) * 60_000);
  return secondGuess;
}

/** Calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
export function localDateOf(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Add days to a YYYY-MM-DD calendar date without touching timezones. */
export function addCalendarDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * A task due on `dueOn` (calendar date in the org zone) becomes overdue when the local day
 * ends, i.e. at local midnight at the start of the following day.
 */
export function taskDueInstant(dueOn: string, timeZone: string): Date | null {
  return zonedLocalToInstant(`${addCalendarDays(dueOn, 1)}T00:00`, timeZone);
}
