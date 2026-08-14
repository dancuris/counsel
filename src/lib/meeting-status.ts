import { prisma } from "@/lib/prisma";
import { logActivity } from "@/lib/activity-log";
import { statusFromMeeting } from "@/lib/mail-status";
import { recordFailure } from "@/lib/failures";

/**
 * Booking a meeting moves the role to Interviewing.
 *
 * There are four places an `InterviewNote` gets created - the role page form,
 * linking a matched calendar event, confirming a time proposed in the Inbox,
 * and the assistant - and a meeting means the same thing in all four. Written
 * once here rather than four times, because a rule copied into four callers is
 * a rule that will hold in three of them.
 *
 * The rule itself lives in `statusFromMeeting`, kept pure alongside the mail
 * rules it shares its never-regress shape with. This is only the write.
 *
 * Best-effort, like the activity log and the Drive sync: the note is already
 * committed by the time this runs, and a meeting that saved must never report
 * as failed because a status update did not.
 */
export async function advanceOnMeeting(applicationId: string | null | undefined): Promise<void> {
  if (!applicationId) return;
  try {
    /**
     * Read and write in one transaction.
     *
     * The read decides whether the write is allowed and what the note should
     * say, so between the two there is a window where another path can change
     * the status. Concretely: the mail sync moves a role to Interviewing while
     * this is mid-flight, and the append here writes a note claiming a meeting
     * caused a transition that had already happened, over the top of whatever
     * the sync appended. `notes` is a text column that everything appends to,
     * so a lost update there erases the reason a status changed.
     *
     * Returned rather than logged inside, because the activity log is
     * best-effort and must not hold a transaction open or roll one back.
     */
    const moved = await prisma.$transaction(async (tx) => {
      const app = await tx.jobApplication.findUnique({
        where: { id: applicationId },
        select: { status: true, notes: true, deletedAt: true },
      });
      if (!app || app.deletedAt) return null;

      const move = statusFromMeeting(app.status);
      if (!move) return null;

      const stamp = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      await tx.jobApplication.update({
        where: { id: applicationId },
        data: {
          status: move.next,
          // Same shape the mail sync writes, so the reason a status moved on
          // its own reads identically wherever it came from.
          notes: `${app.notes ? `${app.notes}\n\n` : ""}${stamp}: moved to ${move.next} automatically because ${move.reason}.`,
        },
      });
      return { from: app.status, to: move.next };
    });

    if (!moved) return;
    await logActivity({
      applicationId,
      action: "status_changed",
      summary: "Status changed automatically because a meeting was scheduled",
      from: moved.from,
      to: moved.to,
    });
  } catch (error) {
    // Still non-fatal: the meeting is already saved and must not report as
    // failed because the stage did not move. But it is recorded now.
    await recordFailure("advanceOnMeeting", error, { applicationId });
  }
}
