import { prisma } from "@/lib/prisma";
import type { ActivityAction } from "@/lib/constants";
import { recordFailure } from "@/lib/failures";

/**
 * Records a change that leaves no dated row of its own.
 *
 * Best-effort by design: a status change that succeeded must not be reported as
 * a failure because the log write failed, and the caller has already committed
 * by the time this runs. Same reasoning as the Drive sync.
 *
 * Only reach for this when nothing else captures the event. A generated
 * document, an evaluation, a correspondence draft and a piece of mail all write
 * their own dated rows, and the timeline reads those directly; logging them
 * here as well would double every entry.
 */
export async function logActivity(opts: {
  applicationId: string | null;
  action: ActivityAction;
  summary: string;
  from?: string | null;
  to?: string | null;
}): Promise<void> {
  try {
    const hasTransition = opts.from !== undefined || opts.to !== undefined;
    await prisma.activityLog.create({
      data: {
        applicationId: opts.applicationId,
        action: opts.action,
        summary: opts.summary,
        detail: hasTransition ? JSON.stringify({ from: opts.from ?? null, to: opts.to ?? null }) : null,
      },
    });
  } catch (error) {
    // Console alone was not knowable: nobody reads a Vercel function log, so a
    // timeline that silently stopped recording would look like a quiet week.
    await recordFailure("logActivity", error, { applicationId: opts.applicationId, action: opts.action });
  }
}

/**
 * The changed fields between two versions of the editable details, as a
 * sentence. Returns null when nothing actually changed, so a form submitted
 * untouched does not manufacture a log entry.
 */
export function describeChanges(
  before: Record<string, string | null>,
  after: Record<string, string | null>
): string | null {
  const changed = Object.keys(after).filter((key) => (before[key] ?? "") !== (after[key] ?? ""));
  if (changed.length === 0) return null;
  return changed
    .map((key) => key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim())
    .join(", ");
}
