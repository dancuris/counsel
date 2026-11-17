import { getFastmailConnection } from "@/lib/fastmail";
import { prisma } from "@/lib/prisma";
import { parseLabelled } from "@/lib/contact-block";
import { deriveFollowUpInput, followUpState, type FollowUpState } from "@/lib/follow-up-state";
import { TENANT_ID } from "@/lib/tenant";

/**
 * The database side of the cadence: which rows to load, and whose addresses
 * count as Dan's own.
 *
 * The rule itself is pure and lives in `follow-up-state.ts`. This is the thin
 * layer that feeds it, kept in one place so the role page, Today and anything
 * added later select the same columns. A page that forgot to include
 * `mailMessages` would not error - it would quietly report every role as
 * having no contact, which is the failure mode this app keeps producing.
 */

/** Exactly what `deriveFollowUpInput` reads. Spread into an `include`. */
export const FOLLOW_UP_INCLUDE = {
  correspondence: { select: { status: true, sentAt: true, createdAt: true } },
  mailMessages: {
    select: { fromEmail: true, forwardedFromEmail: true, direction: true, category: true, receivedAt: true },
  },
  interviewNotes: { select: { date: true } },
  followUps: { select: { dueDate: true, completed: true } },
} as const;

/**
 * Dan's own addresses, so a forward of his own note is not read as somebody
 * writing to him. Both connections are included because mail arrives on the
 * job-search account and he forwards from the Workspace one.
 */
export async function ownAddresses(): Promise<Set<string>> {
  const [profile, connections, fastmail] = await Promise.all([
    prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { contactEmails: true } }),
    prisma.googleConnection.findMany({ select: { email: true } }),
    getFastmailConnection(),
  ]);
  return new Set(
    [...parseLabelled(profile?.contactEmails ?? null).map((e) => e.value), ...connections.map((c) => c.email ?? ""), fastmail?.email ?? ""]
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

type RoleRows = Parameters<typeof deriveFollowUpInput>[0];

export function followUpFor(role: RoleRows, own: Set<string>, now: Date): FollowUpState {
  return followUpState(deriveFollowUpInput(role, own, now));
}
