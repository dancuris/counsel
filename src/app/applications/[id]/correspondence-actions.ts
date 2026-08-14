"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { CORRESPONDENCE_TYPES } from "@/lib/constants";
import { canEditCorrespondence, MARKED_BY_HAND } from "@/lib/correspondence-edit";

function normalizeType(value: FormDataEntryValue | null): string {
  const v = String(value ?? "");
  return CORRESPONDENCE_TYPES.includes(v as (typeof CORRESPONDENCE_TYPES)[number]) ? v : "general";
}

export async function addManualCorrespondence(applicationId: string, formData: FormData) {
  const recipientName = String(formData.get("recipientName") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  if (!recipientName || !content) return;
  // Resolve the recipient to a real contact where one exists.
  //
  // Without this the row is stranded: the contact page opens a draft with
  // `?edit=`, and that query requires a `contactId`, so a note written here
  // could never be reopened in the composer that has the signature and the
  // rich editor. A check-in written here had no way to be signed.
  //
  // Matched on name because that is what the form collects, and only against
  // this role's own contacts, so "Brian" cannot resolve to a different Brian
  // somewhere else in the pipeline.
  let contactId = String(formData.get("contactId") ?? "") || undefined;
  if (!contactId) {
    const match = await prisma.contact.findFirst({
      where: { applicationId, name: { equals: recipientName, mode: "insensitive" } },
      select: { id: true },
    });
    contactId = match?.id;
  }
  await prisma.correspondence.create({
    data: {
      applicationId,
      contactId,
      type: normalizeType(formData.get("type")),
      recipientName,
      recipientRole: String(formData.get("recipientRole") ?? "").trim() || undefined,
      content,
      status: "draft",
    },
  });
  revalidatePath(`/applications/${applicationId}`);
}

export async function updateCorrespondenceContent(id: string, applicationId: string, formData: FormData) {
  const content = String(formData.get("content") ?? "");

  // This had no check at all, so the textarea on a role page could silently
  // rewrite the text of a message already recorded as sent - the one surface
  // in the app where history was editable, while the contact page refused the
  // same edit.
  const existing = await prisma.correspondence.findUnique({
    where: { id },
    select: { status: true, gmailMessageId: true },
  });
  if (!existing || !canEditCorrespondence(existing)) return;

  await prisma.correspondence.update({ where: { id }, data: { content } });
  revalidatePath(`/applications/${applicationId}`);
}

export async function markCorrespondenceSent(id: string, applicationId: string) {
  // `sent` means Gmail returned an id, and only the send route may write it.
  // This button is Dan saying he sent it from somewhere else, which is a
  // weaker claim and has its own status. It used to write `sent` outright, so
  // a note posted from Proton was recorded as though the app had proof.
  await prisma.correspondence.update({
    where: { id },
    data: { status: MARKED_BY_HAND, sentAt: new Date() },
  });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/");
}

export async function deleteCorrespondence(id: string, applicationId: string) {
  await prisma.correspondence.delete({ where: { id } });
  revalidatePath(`/applications/${applicationId}`);
}
