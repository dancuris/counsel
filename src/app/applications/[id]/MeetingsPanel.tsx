import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { findMatchingEvents, type CalendarEvent } from "@/lib/calendar";
import { APP_TIMEZONE } from "@/lib/format";
import { linkCalendarEvent, dismissCalendarMatch } from "./actions";

/**
 * The Meetings panel, split out so it can stream.
 *
 * Matching a role to the calendar means downloading and parsing the whole ICS
 * feed over the network. Awaited inline it was the slowest thing on the page
 * and it held back every other panel, including the ones that were already
 * read from the database - the page sat on a calendar fetch to show a status
 * badge. Behind a Suspense boundary the rest of the page renders immediately
 * and this fills in when the feed answers.
 */
export async function MeetingsPanel({
  applicationId,
  companyId,
  companyName,
  icsCalendarUrl,
  dismissedUidsJson,
  notes,
}: {
  applicationId: string;
  companyId: string;
  companyName: string;
  icsCalendarUrl: string | null | undefined;
  dismissedUidsJson: string | null;
  notes: { id: string; calendarEventUid: string | null }[];
}) {
  const allMatches = await findMatchingEvents(icsCalendarUrl, companyId, companyName);

  let dismissedEventUids: string[] = [];
  if (dismissedUidsJson) {
    try {
      const parsed = JSON.parse(dismissedUidsJson);
      if (Array.isArray(parsed)) dismissedEventUids = parsed;
    } catch {
      dismissedEventUids = [];
    }
  }

  // Meetings shows every calendar match that hasn't been explicitly
  // dismissed - linked ones included, just with "notes added" state instead
  // of an "add notes" prompt - so it stays a persistent record of what's on
  // the calendar for this application, not a suggestion queue that empties
  // out once acted on.
  const meetings = allMatches.filter((e) => !dismissedEventUids.includes(e.uid));

  if (meetings.length === 0) {
    // The panel is always rendered now, so it has to say why it is empty. "No
    // matches" and "no calendar connected" are different problems and only one
    // of them is fixable from here.
    return icsCalendarUrl ? (
      <p className="text-sm text-[var(--tx-3)]">Nothing on your calendar matched this role.</p>
    ) : (
      <p className="text-sm text-[var(--tx-3)]">
        Add a calendar URL in{" "}
        <Link href="/profile" className="underline">
          Profile
        </Link>{" "}
        to match meetings to this role.
      </p>
    );
  }

  const noteByEventUid = new Map(
    notes.filter((n) => n.calendarEventUid).map((n) => [n.calendarEventUid as string, n])
  );
  const boundLinkCalendarEvent = linkCalendarEvent.bind(null, applicationId);
  const boundDismissCalendarMatch = dismissCalendarMatch.bind(null, applicationId);

  // Request-time "now" to split into upcoming/past - this page is
  // force-dynamic (never statically cached), so a per-request value is safe
  // despite the rule's general no-impure-calls-during-render guidance.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const upcoming = meetings.filter((e) => e.start.getTime() >= nowMs).sort((a, b) => a.start.getTime() - b.start.getTime());
  const past = meetings.filter((e) => e.start.getTime() < nowMs).sort((a, b) => b.start.getTime() - a.start.getTime());

  function renderMeeting(e: CalendarEvent) {
    const linkedNote = noteByEventUid.get(e.uid);
    return (
      <div key={e.uid} className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <span className="font-medium text-[var(--tx)]">{e.summary}</span>{" "}
          <span className="text-[var(--tx-3)]">
            - {e.start.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: APP_TIMEZONE })}
            {e.isFullDay ? "" : `, ${e.start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: APP_TIMEZONE })}`}
          </span>
        </span>
        {linkedNote ? (
          <a href={`#note-${linkedNote.id}`} className="text-xs text-accent hover:underline">
            Notes added ↓
          </a>
        ) : (
          <span className="flex items-center gap-2">
            <form action={boundLinkCalendarEvent}>
              <input type="hidden" name="uid" value={e.uid} />
              <input type="hidden" name="summary" value={e.summary} />
              <input type="hidden" name="start" value={e.start.toISOString()} />
              <SubmitButton className="rounded border border-accent px-2 py-1 text-xs text-accent hover:bg-accent-light">Add notes</SubmitButton>
            </form>
            <form action={boundDismissCalendarMatch}>
              <input type="hidden" name="uid" value={e.uid} />
              <SubmitButton className="text-xs text-[var(--tx-3)] hover:text-[var(--tx-2)] hover:underline">Not this</SubmitButton>
            </form>
          </span>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="mt-0.5 text-xs text-[var(--tx-3)]">
        Matched from your calendar. Add notes to attach them below, or dismiss ones that aren&apos;t this role.
      </p>
      <div className="mt-2 space-y-4">
        {upcoming.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--tx-3)]">Upcoming</p>
            <div className="space-y-2">{upcoming.map((e) => renderMeeting(e))}</div>
          </div>
        )}
        {past.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--tx-3)]">Past</p>
            <div className="space-y-2">{past.map((e) => renderMeeting(e))}</div>
          </div>
        )}
      </div>
    </>
  );
}

export function MeetingsPanelFallback() {
  return (
    <div className="space-y-2.5" role="status" aria-busy="true" aria-label="Checking your calendar">
      <div aria-hidden className="skeleton h-2.5 w-[70%]" />
      <div aria-hidden className="skeleton h-2.5 w-[45%]" />
    </div>
  );
}
