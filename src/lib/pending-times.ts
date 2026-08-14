import { prisma } from "@/lib/prisma";
import type { PendingTime } from "@/components/PendingTimes";

/**
 * Proposed interview times that are still worth acting on.
 *
 * A stored proposedStart is not the same thing as a live proposal. Two ways it
 * goes stale, both seen in one AT&T thread:
 *
 * 1. The time passes. A slot from last Thursday is history, not a decision.
 * 2. A later message in the same thread proposes a different time. That is what
 *    a reschedule looks like, and the superseded proposal stays in the database
 *    looking entirely valid. Confirming it would write a meeting that is not
 *    happening onto a real calendar, which is worse than showing nothing.
 *
 * Supersession is scoped to the thread rather than the application because it
 * is the conversation that moved. Two different recruiters at the same employer
 * proposing two different times are two real proposals, not a correction.
 *
 * 3. It is already on the calendar. `scheduledAt` only records a booking made
 *    from this prompt, so a meeting captured any other way - the calendar sync,
 *    an interview note added by hand - left the prompt standing. The AT&T call
 *    at 1:00 PM sat in the Inbox asking to be scheduled while an interview note
 *    for the same role at the same minute already existed, and confirming it
 *    would have written the meeting twice.
 */
export async function pendingTimes(): Promise<PendingTime[]> {
  const rows = await prisma.mailMessage.findMany({
    where: {
      proposedStart: { not: null, gt: new Date() },
      scheduledAt: null,
      dismissedAt: null,
    },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      threadId: true,
      receivedAt: true,
      subject: true,
      fromName: true,
      fromEmail: true,
      proposedStart: true,
      proposedLabel: true,
      summary: true,
      detectedCompany: true,
      detectedRole: true,
      applicationId: true,
      application: { select: { roleTitle: true, company: { select: { name: true } } } },
    },
  });

  // The newest proposal in each thread wins. Scanning every message that
  // carries a time - including ones already scheduled or now in the past -
  // because a thread whose latest word is "actually, let's do Monday" must not
  // resurrect the Thursday that came before it.
  const threads = rows.map((r) => r.threadId).filter((t): t is string => Boolean(t));
  const newestByThread = new Map<string, Date>();
  if (threads.length > 0) {
    const all = await prisma.mailMessage.findMany({
      where: { threadId: { in: threads }, proposedStart: { not: null } },
      select: { threadId: true, receivedAt: true },
    });
    for (const m of all) {
      if (!m.threadId) continue;
      const seen = newestByThread.get(m.threadId);
      if (!seen || m.receivedAt > seen) newestByThread.set(m.threadId, m.receivedAt);
    }
  }

  // Already-scheduled check. Matched on the role plus the time rather than on
  // the message, because the booking usually did not come from the message: it
  // came from the calendar sync or from Dan typing it in. A half-hour window
  // absorbs a proposal recorded as 1:00 and a note saved as 1:05; two genuinely
  // different meetings on one role inside thirty minutes are not a real case.
  const HALF_HOUR = 30 * 60 * 1000;
  const appIds = rows.map((r) => r.applicationId).filter((id): id is string => Boolean(id));
  const booked = appIds.length
    ? await prisma.interviewNote.findMany({
        where: { applicationId: { in: appIds }, date: { not: null } },
        select: { applicationId: true, date: true },
      })
    : [];

  const alreadyOnCalendar = (applicationId: string | null, at: Date) =>
    Boolean(
      applicationId &&
        booked.some(
          (b) => b.applicationId === applicationId && b.date && Math.abs(b.date.getTime() - at.getTime()) <= HALF_HOUR
        )
    );

  return rows
    .filter((r) => {
      if (alreadyOnCalendar(r.applicationId, r.proposedStart as Date)) return false;
      if (!r.threadId) return true;
      const newest = newestByThread.get(r.threadId);
      return !newest || r.receivedAt.getTime() === newest.getTime();
    })
    .map(({ threadId: _threadId, receivedAt: _receivedAt, ...rest }) => ({
      ...rest,
      proposedStart: rest.proposedStart as Date,
    }));
}
