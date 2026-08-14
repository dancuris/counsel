"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";

/**
 * Throwing away a draft that was never sent.
 *
 * Deliberately narrow: it refuses anything carrying a Gmail id or already
 * marked sent, so the one thing it can never do is erase the record of a
 * message that actually left the building.
 */
export async function discardDraft(contactId: string, correspondenceId: string) {
  const row = await prisma.correspondence.findUnique({
    where: { id: correspondenceId },
    select: { gmailMessageId: true, status: true },
  });
  // Refuses anything already gone out, by either route.
  if (!row || row.gmailMessageId || row.status !== "draft") return;

  await prisma.correspondence.delete({ where: { id: correspondenceId } });
  revalidatePath(`/contacts/${contactId}`);
}

/**
 * Recording a message Dan sent himself, from another mail client.
 *
 * Some threads started on his ecuris address, which Workspace hands off to
 * Proton. Sending those from the app would put the copy in a Gmail Sent folder
 * he never opens and leave Proton - where he actually works - with no record of
 * what he wrote. So for those he drafts here and replies there.
 *
 * The status is deliberately `sent_externally` rather than `sent`. Only
 * `POST /api/correspondence/send` may write `sent`, because that word means
 * "Gmail returned an id". This is a different and weaker claim: Dan says he
 * sent it. Keeping them distinct means the record never overstates what the
 * app knows, and `gmailMessageId` staying null is meaningful rather than a gap.
 */
export async function markSentElsewhere(contactId: string, correspondenceId: string) {
  const row = await prisma.correspondence.findUnique({
    where: { id: correspondenceId },
    select: { status: true, gmailMessageId: true },
  });
  if (!row || row.gmailMessageId || row.status !== "draft") return;

  await prisma.correspondence.update({
    where: { id: correspondenceId },
    data: { status: "sent_externally", sentAt: new Date() },
  });

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/");
}
