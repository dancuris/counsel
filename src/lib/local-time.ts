/**
 * `datetime-local` has no timezone in it, and the server is not in Dan's.
 *
 * This cost a real interview time. A recruiter wrote "tomorrow at
 * 1:30pm EST", the parser read it correctly as `17:30Z`, the confirmation field
 * rendered it correctly as `13:30` Eastern - and then the action did
 * `new Date("2026-08-13T13:30")`. A `datetime-local` string carries no offset,
 * so JavaScript reads it as **the runtime's** local time, and on Vercel that is
 * UTC. The meeting saved as `13:30Z`, which is 9:30 in the morning: four hours
 * early, on the dashboard, and pushed to Google Calendar at the wrong hour.
 *
 * There were two `toLocalInput` helpers and they were wrong in opposite
 * directions. One formatted Eastern and round-tripped through a UTC parse, so
 * it displayed the right time and stored the wrong one. The other formatted in
 * the server's zone, so it displayed the wrong time and stored the right one.
 * Either alone looks defensible; together they guarantee that whichever page
 * you check, the other one disagrees.
 *
 * So both directions live here, as one pair that cannot drift apart. Format
 * with `toEasternInput`, parse with `fromEasternInput`, and never call
 * `new Date()` on the value of a `datetime-local` field.
 *
 * **That last rule is enforced by the type system, not by remembering it.**
 * `readDateField` returns a `FormDateValue`, which is an object rather than a
 * string, so `new Date(value)` does not compile. The only ways out are the
 * three named readers below, each of which states which kind of value it is
 * reading. An earlier attempt to catch this with a regex in `scripts/audit.ts`
 * produced three findings on its first run and all three were correct code;
 * making the mistake unrepresentable is strictly better than detecting it.
 */
// The app has one timezone constant. This file briefly declared a second,
// which is the same fault it exists to fix.
import { APP_TIMEZONE as ZONE } from "@/lib/format";

/**
 * A raw value out of a form, not yet interpreted.
 *
 * Deliberately an object. A branded string would still satisfy the `Date`
 * constructor, which accepts `string | number | Date`, so the bug would stay
 * expressible. This shape cannot be passed to `new Date()` at all.
 */
export type FormDateValue = { readonly kind: "form-date"; readonly raw: string };

/** Reads a field, returning null when it is absent or blank. */
export function readDateField(formData: FormData, name: string): FormDateValue | null {
  const raw = String(formData.get(name) ?? "").trim();
  return raw ? { kind: "form-date", raw } : null;
}

/** For tests and for values that did not come from a `FormData`. */
export function formDateValue(raw: string): FormDateValue | null {
  const t = raw.trim();
  return t ? { kind: "form-date", raw: t } : null;
}

/** A `datetime-local` field: wall-clock time in Dan's zone. */
export function asEastern(v: FormDateValue | null): Date | null {
  return v ? fromEasternInput(v.raw) : null;
}

/** A `type="date"` field: a calendar day, stored as UTC midnight. */
export function asDateOnly(v: FormDateValue | null): Date | null {
  return v ? fromDateOnlyInput(v.raw) : null;
}

/** A hidden field already carrying a full ISO instant. */
export function asInstant(v: FormDateValue | null): Date | null {
  return v ? fromIsoInstant(v.raw) : null;
}

/** Minutes to add to an instant to get the Eastern wall clock. -240 in summer. */
function easternOffsetMinutes(utcMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  // `hour12: false` renders midnight as 24 in some engines.
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return (asIfUtc - utcMs) / 60_000;
}

/** An instant, as the `YYYY-MM-DDTHH:mm` a `datetime-local` field wants. */
export function toEasternInput(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${String(Number(get("hour")) % 24).padStart(2, "0")}:${get("minute")}`;
}

/**
 * A `type="date"` field, which is a calendar day and not an instant.
 *
 * Stored as UTC midnight on purpose, because `formatDate` renders with
 * `timeZone: "UTC"`: the two halves of the convention agree, so a day entered
 * as the 13th reads back as the 13th everywhere. Parsing it as Eastern instead
 * would be the bug - it would store 04:00Z and start drifting the moment
 * anything formatted it in UTC.
 *
 * It exists as a named function rather than a bare `new Date()` so that the
 * rule can be absolute: **no form value is ever passed to the Date
 * constructor.** A heuristic audit for this had three hits and all three were
 * correct code, and a check that cries wolf gets ignored. Naming the two
 * legitimate cases turns a judgement call into something checkable.
 */
export function fromDateOnlyInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const d = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A hidden field already carrying a full ISO instant, offset included. */
export function fromIsoInstant(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The value of a `datetime-local` field, read as Eastern wall-clock time.
 *
 * Two passes so the hour before and after a daylight-saving change resolves to
 * the offset in force at the instant itself rather than the one that happened
 * to be in force at the first guess.
 */
export function fromEasternInput(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const [year, month, day, hour, minute] = [+m[1], +m[2], +m[3], +m[4], +m[5]];
  const wall = Date.UTC(year, month - 1, day, hour, minute);

  let instant = wall;
  for (let i = 0; i < 2; i++) {
    instant = wall - easternOffsetMinutes(instant) * 60_000;
  }
  const d = new Date(instant);
  return Number.isNaN(d.getTime()) ? null : d;
}
