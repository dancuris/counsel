import { cache } from "react";
import { prisma } from "@/lib/prisma";
import ical from "node-ical";
import { APP_TIMEZONE } from "@/lib/format";

const DEFAULT_INTERVIEW_DURATION_MINUTES = 60;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Far enough back to cover interviews not yet logged, far enough forward for anything booked. */
const WINDOW_DAYS = 90;

export type CalendarEvent = { uid: string; summary: string; start: Date; end: Date; isFullDay: boolean };

// SUMMARY sometimes arrives as { val, params } rather than a plain string
// (e.g. when the property carries a LANGUAGE/charset param) - pull the text
// out rather than falling through to a generic String() coercion, which
// would stringify the object itself ("[object Object]").
function extractSummaryText(summary: unknown): string {
  if (typeof summary === "string") return summary;
  if (summary && typeof summary === "object" && "val" in summary && typeof (summary as { val: unknown }).val === "string") {
    return (summary as { val: string }).val;
  }
  return "Untitled event";
}

// Uses node-ical's built-in expandRecurringEvent for every VEVENT (not just
// ones with an RRULE) so a plain one-off event and a recurring one go
// through the same range-filtering logic instead of two code paths.
async function fetchEventsInRange(icsUrl: string, from: Date, to: Date): Promise<CalendarEvent[]> {
  /**
   * Bounded, because this blocks a page render.
   *
   * `ical.async.fromURL` has no timeout of its own, so a slow or hanging Proton
   * response held Today open for as long as it took. The calendar is a
   * best-effort enhancement everywhere it is used - a missing event means one
   * fewer row, not a broken page - so waiting indefinitely for it is never the
   * right behaviour.
   */
  const parsed = await Promise.race([
    ical.async.fromURL(icsUrl),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Calendar feed did not respond in time.")), 6000)
    ),
  ]);
  const events: CalendarEvent[] = [];
  for (const item of Object.values(parsed)) {
    if (!item || item.type !== "VEVENT") continue;
    const instances = ical.expandRecurringEvent(item, { from, to });
    for (const inst of instances) {
      const summary = extractSummaryText(inst.summary) || "Untitled event";
      events.push({ uid: inst.event.uid, summary, start: inst.start, end: inst.end, isFullDay: inst.isFullDay });
    }
  }
  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return events;
}

/**
 * The stored feed, and the job that refreshes it.
 *
 * A subscription URL cannot be asked for a date range, so every read means
 * downloading and parsing the whole ICS: about 1.75 seconds, measured. Today
 * and Pipeline both did that on every render, against 77-224ms for every other
 * page in the app. With 99 applications the database was never the bottleneck.
 *
 * An in-memory cache was the first fix and it was half a fix: it works on a
 * warm instance and does nothing on a cold one, which on serverless is most
 * page loads. So the events live in the database now and the network call
 * happens in the background sync that already runs when a page opens.
 *
 * The staleness that buys is real but harmless. A meeting booked inside the
 * app writes an `InterviewNote` and is read from the database, not from here;
 * this feed only supplies events created somewhere else, which is not something
 * that needs to appear within seconds.
 */
export async function refreshCalendarCache(icsUrl: string | null | undefined): Promise<number> {
  if (!icsUrl) return 0;
  const now = Date.now();
  const events = await fetchEventsInRange(
    icsUrl,
    new Date(now - WINDOW_DAYS * DAY_MS),
    new Date(now + WINDOW_DAYS * DAY_MS)
  );

  const syncedAt = new Date();
  for (const e of events) {
    await prisma.calendarEventCache.upsert({
      where: { uid_start: { uid: e.uid, start: e.start } },
      create: { uid: e.uid, summary: e.summary, start: e.start, end: e.end, isFullDay: e.isFullDay, syncedAt },
      update: { summary: e.summary, start: e.start, end: e.end, isFullDay: e.isFullDay, syncedAt },
    });
  }

  // Anything not seen in this pass is gone from the calendar upstream. Scoped
  // to the window we actually fetched, so events outside it are not deleted
  // merely for being out of range.
  await prisma.calendarEventCache.deleteMany({
    where: {
      syncedAt: { lt: syncedAt },
      start: { gte: new Date(now - WINDOW_DAYS * DAY_MS), lte: new Date(now + WINDOW_DAYS * DAY_MS) },
    },
  });

  return events.length;
}

/** The stored events, deduped per request. No network. */
const loadCalendarWindow = cache(async (_icsUrl: string): Promise<CalendarEvent[]> => {
  const rows = await prisma.calendarEventCache.findMany({ orderBy: { start: "asc" } });
  return rows.map((r) => ({
    uid: r.uid,
    summary: r.summary,
    start: r.start,
    end: r.end,
    isFullDay: r.isFullDay,
  }));
});

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Checks a candidate interview time against the profile's subscribed calendar.
 * Interviews have no stored end time, so a default duration is assumed for the
 * overlap check. Returns a human-readable warning, or null if there's no
 * conflict (including when the calendar isn't configured or fails to load -
 * this is a best-effort heads-up, not a hard gate on saving the note).
 */
export async function checkCalendarConflict(icsUrl: string | null | undefined, candidateStart: Date): Promise<string | null> {
  if (!icsUrl) return null;
  const candidateEnd = new Date(candidateStart.getTime() + DEFAULT_INTERVIEW_DURATION_MINUTES * 60_000);

  let events: CalendarEvent[];
  try {
    // Its own fetch rather than the shared window: a candidate interview can be
    // booked further out than the window reaches.
    events = await fetchEventsInRange(icsUrl, new Date(candidateStart.getTime() - DAY_MS), new Date(candidateEnd.getTime() + DAY_MS));
  } catch {
    return null;
  }

  const conflict = events.find((e) => overlaps(candidateStart, candidateEnd, e.start, e.end));
  if (!conflict) return null;

  const time = conflict.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_TIMEZONE });
  return `Overlaps "${conflict.summary}" on your calendar at ${time}`;
}

function getThisWeekRange(): { start: Date; end: Date } {
  const now = new Date();
  const day = now.getDay(); // 0 = Sun ... 6 = Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + diffToMonday);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return { start, end };
}

export type WeekEventsResult =
  | { status: "not_configured" }
  | { status: "error" }
  | { status: "ok"; events: CalendarEvent[] };

// Powers the dashboard "This week" card: everything on the calendar for the
// Monday-Sunday week containing today, past and upcoming.
export async function getThisWeekEvents(icsUrl: string | null | undefined): Promise<WeekEventsResult> {
  if (!icsUrl) return { status: "not_configured" };
  const { start, end } = getThisWeekRange();
  try {
    const events = await loadCalendarWindow(icsUrl);
    // `end` is next Monday at midnight, so the week is half-open: an event at
    // 09:00 next Monday belongs to next week, not under this card's "Mon".
    return { status: "ok", events: events.filter((e) => e.start >= start && e.start < end) };
  } catch {
    return { status: "error" };
  }
}

const STOP_WORDS = new Set(["the", "and", "of", "for", "to", "a", "an", "in", "on", "at", "with"]);

function significantWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Plain .includes() would let a short company name match *inside* an
// unrelated word (e.g. "Hines" inside "Machines"); require a word boundary
// on both sides instead.
function containsWholeWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return new RegExp(`\\b${escapeRegex(needle)}\\b`, "i").test(haystack);
}

// A candidate interview event: an event summary contains the company name
// outright, or mentions the company's most distinctive word (its first
// significant word, e.g. "United" from "United Airlines" - trailing generic
// descriptors like "Airlines"/"Inc"/"Group" are common across many
// companies and would cause false positives, e.g. matching "Southwest
// Airlines" as a "United Airlines" interview).
//
// Deliberately company-name-only, no role-title fallback: most of this
// candidate's applications share near-identical generic titles ("VP
// Marketing/MarTech"), so a title-word-overlap match can't reliably tell
// one application's interview from another's - it just floods every similar
// application with the same false suggestion instead.
function isLikelyMatch(eventSummary: string, companyName: string): boolean {
  if (companyName.length > 2 && containsWholeWord(eventSummary, companyName)) return true;

  // Punctuation in a company name almost never survives into a calendar
  // invite. A real interview sat on the calendar with the employer's
  // punctuation stripped out of its title and matched nothing, because the
  // stored name was compared literally. Compare the letters and digits only.
  const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const squashedCompany = squash(companyName);
  if (squashedCompany.length > 2) {
    const squashedSummary = squash(eventSummary);
    // Word-ish boundary is lost by squashing, so require a distinctive length
    // before allowing a bare substring hit.
    if (squashedCompany.length >= 3 && squashedSummary.includes(squashedCompany)) return true;
    for (const word of eventSummary.split(/[^A-Za-z0-9&]+/)) {
      if (word.length >= 3 && squash(word) === squashedCompany) return true;
    }
  }

  const companyFirstWord = [...significantWords(companyName)][0];
  if (!companyFirstWord) return false;
  return significantWords(eventSummary).has(companyFirstWord);
}

// Suggests calendar events that might be interviews for a set of companies,
// so they can be offered as one-click "add notes" candidates instead of
// requiring manual entry. Looks 90 days back and forward to cover both a
// full job-search timeline of past interviews not yet logged and scheduled
// upcoming ones. Matches every company against one read of the shared window,
// so callers that need this for many applications at once (e.g. the dashboard)
// should call this rather than looping their own per-company call.
export async function findMatchesForCompanies(
  icsUrl: string | null | undefined,
  companies: { id: string; name: string }[]
): Promise<Map<string, CalendarEvent[]>> {
  const result = new Map<string, CalendarEvent[]>();
  if (!icsUrl || companies.length === 0) return result;
  let events: CalendarEvent[];
  try {
    events = await loadCalendarWindow(icsUrl);
  } catch {
    return result;
  }
  for (const c of companies) {
    const matches = events.filter((e) => isLikelyMatch(e.summary, c.name));
    if (matches.length > 0) result.set(c.id, matches);
  }
  return result;
}

// Single-company convenience wrapper around findMatchesForCompanies.
export async function findMatchingEvents(icsUrl: string | null | undefined, companyId: string, companyName: string): Promise<CalendarEvent[]> {
  const map = await findMatchesForCompanies(icsUrl, [{ id: companyId, name: companyName }]);
  return map.get(companyId) ?? [];
}

/**
 * A calendar invite is usually titled after the person, not the employer.
 *
 * Everything above matches an event to a *company*, which is the right rule for
 * an interview - "Onsite - <Employer>" - and finds nothing at all for the half
 * of this search that is networking. A virtual coffee with a VP sat on the
 * calendar under **two people's names**: no employer anywhere in the title, and
 * no tracked role to hang it on either, since there is no posting behind it. It was 4:30 the same afternoon and Today did not know it existed.
 *
 * Same shape of fault as filing mail to a company but never to a person. The
 * app knows who these people are; it was only ever asking "which employer is
 * this?", so a meeting named after a human matched nothing.
 */
function isLikelyPersonMatch(eventSummary: string, personName: string): boolean {
  const parts = personName
    .replace(/[^A-Za-z\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length < 2) return false;

  // Both ends of the name, or nothing. A forename alone would match half the
  // calendar - every event here has "Dan" in it - and a surname alone collides
  // with ordinary words. Requiring the pair is what makes this safe enough to
  // put on Today without a confirmation step.
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (first.length < 2 || last.length < 3) return false;
  return containsWholeWord(eventSummary, first) && containsWholeWord(eventSummary, last);
}

/** Upcoming and recent events that name one of these people. */
export async function findMatchesForContacts(
  icsUrl: string | null | undefined,
  contacts: { id: string; name: string }[]
): Promise<Map<string, CalendarEvent[]>> {
  const result = new Map<string, CalendarEvent[]>();
  if (!icsUrl || contacts.length === 0) return result;
  let events: CalendarEvent[];
  try {
    events = await loadCalendarWindow(icsUrl);
  } catch {
    return result;
  }
  for (const c of contacts) {
    const matches = events.filter((e) => isLikelyPersonMatch(e.summary, c.name));
    if (matches.length > 0) result.set(c.id, matches);
  }
  return result;
}
