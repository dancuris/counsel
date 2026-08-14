"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { syncDocumentToDriveQuietly } from "@/lib/google-drive";
import { logActivity } from "@/lib/activity-log";

// Saving writes a NEW row rather than overwriting, so the previous text stays
// recoverable. This is the same shape generation already had (each generate
// creates a row), which means edits and generations now produce one uniform
// version history instead of one accumulating and the other destroying.
export async function updateDocumentContent(id: string, applicationId: string, formData: FormData) {
  const content = String(formData.get("content") ?? "");
  if (!content.trim()) return;

  const existing = await prisma.document.findUnique({ where: { id } });
  if (!existing) return;
  // Nothing changed, so don't manufacture a version for it.
  if (existing.content === content) return;

  // Who wrote this version, which decides who reviews it. A refine hands back
  // the model that did the rewriting; a plain hand-edit carries the previous
  // writer forward, because the text is still substantially theirs and an
  // unknown writer would send the review to the wrong provider.
  const refinedBy = String(formData.get("model") ?? "").trim();

  const created = await prisma.document.create({
    data: {
      applicationId: existing.applicationId,
      type: existing.type,
      content,
      isAtsSafe: existing.isAtsSafe,
      model: refinedBy || existing.model,
    },
  });
  // Pushes the edit up to the same Drive file the earlier version used, so the
  // link stays current instead of pointing at what was superseded.
  await syncDocumentToDriveQuietly(created.id);
  revalidatePath(`/applications/${applicationId}`);
}

export async function deleteDocument(id: string, applicationId: string) {
  // The only document action that destroys its own evidence: the new versions
  // written by saving and restoring are themselves the timeline entry, but a
  // delete removes the row the timeline would have read.
  const doc = await prisma.document.findUnique({ where: { id }, select: { type: true } });
  await prisma.document.delete({ where: { id } });
  if (doc) {
    await logActivity({
      applicationId,
      action: "document_deleted",
      summary: `Deleted a ${doc.type.replace(/_/g, " ")} version`,
    });
  }
  revalidatePath(`/applications/${applicationId}`);
}

// Brings an older version back to the front by re-appending its content as a
// new row. The version being restored is left in place, so restoring is itself
// undoable rather than a different flavour of overwrite.
export async function restoreDocumentVersion(id: string, applicationId: string) {
  const version = await prisma.document.findUnique({ where: { id } });
  if (!version) return;

  const created = await prisma.document.create({
    data: {
      applicationId: version.applicationId,
      type: version.type,
      content: version.content,
      isAtsSafe: version.isAtsSafe,
    },
  });
  await syncDocumentToDriveQuietly(created.id);
  // The new row already reads as a version on the timeline; this records that
  // it arrived by restoring rather than by editing.
  await logActivity({
    applicationId,
    action: "document_restored",
    summary: `Restored an earlier ${version.type.replace(/_/g, " ")}`,
  });
  revalidatePath(`/applications/${applicationId}`);
}
