import { prisma } from "@/lib/prisma";

/**
 * Records a failure that was deliberately swallowed.
 *
 * This app has 44 catch blocks that never rethrow, and most of them are right
 * to exist: a Drive upload, an activity-log entry or an automatic status
 * advance must not make a save that already succeeded report as a failure.
 * The pattern is documented and deliberate.
 *
 * What was missing is the other half. There was no logging, no error
 * reporting, and nothing anywhere recorded that a background write had failed,
 * so a capability could stop working entirely and the only way to find out was
 * to notice its absence - which is precisely how the four-hour interview error
 * was found. An app whose stated value is "say what is actually true" cannot
 * have a whole class of events it structurally cannot know about.
 *
 * Two properties this must keep:
 *
 * - **It can never throw.** It runs inside catch blocks. A logger that fails
 *   loudly turns a swallowed failure into a crash, which is worse than the
 *   thing it was added to fix.
 * - **It never blocks.** The caller has already committed; this is bookkeeping.
 */
export async function recordFailure(
  operation: string,
  error: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : JSON.stringify(error);

  // Console first, so the record survives even when the database is the thing
  // that is broken - which is a likely cause of whatever is being logged.
  console.error(`[failure] ${operation}: ${message}`, context ?? "");

  try {
    await prisma.failureLog.create({
      data: {
        operation,
        message: (message ?? "unknown").slice(0, 2000),
        context: context ? JSON.stringify(context).slice(0, 2000) : null,
      },
    });
  } catch {
    // Nothing further to do. Logging the logger's failure would recurse.
  }
}

/** Recent failures, newest first, for the Settings panel. */
export async function recentFailures(limit = 20) {
  return prisma.failureLog.findMany({ orderBy: { at: "desc" }, take: limit });
}

/** How many have not been looked at. Drives the count in Settings. */
export async function unseenFailureCount(): Promise<number> {
  return prisma.failureLog.count({ where: { seenAt: null } });
}
