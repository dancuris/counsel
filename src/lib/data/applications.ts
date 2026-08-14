import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

/**
 * The soft-delete invariant, defined once.
 *
 * Applications are soft-deleted: `deleteApplication` sets `deletedAt` and never
 * removes the row, so every list read has to filter it. That filter was written
 * by hand in sixteen places across eight files, which is why `scripts/audit.ts`
 * carries a check for a `findMany` without it - the rule could not be
 * centralized because there was nowhere to put it.
 *
 * A predicate rather than a wrapper function, and the choice matters. Wrapping
 * `findMany` was the first attempt and it broke Prisma's type inference: the
 * generic could not carry `include` through, so every caller's rows came back
 * without their relations and the compiler stopped knowing that
 * `application.company` exists. Losing type safety to centralize a filter is a
 * bad trade.
 *
 * This is the shape `mail-filing.ts` already uses for exactly the same problem,
 * and it composes with anything: `where: { ...NOT_DELETED, status: "APPLIED" }`.
 */
export const NOT_DELETED: Prisma.JobApplicationWhereInput = { deletedAt: null };

/**
 * Counting live roles, where the count must agree with a list.
 *
 * A number and its destination have to be computed from one definition. This
 * exists so a count cannot quietly use a different filter from the page it
 * links to, which has happened here before.
 */
export function countLive(where?: Prisma.JobApplicationWhereInput) {
  return prisma.jobApplication.count({ where: { ...NOT_DELETED, ...where } });
}

/**
 * One application by id, deleted or not.
 *
 * Deliberately unfiltered, and the asymmetry is the design: a deleted role has
 * to remain viewable so it can be restored. That is also why a blanket filter
 * in a Prisma client extension would be wrong here - it would make restoring
 * impossible and the reason would be invisible.
 */
export function applicationById(id: string) {
  return prisma.jobApplication.findUnique({ where: { id } });
}
