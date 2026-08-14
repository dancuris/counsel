"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getDriveFile, driveDocxToText } from "@/lib/google-drive";
import type { DocumentType } from "@/lib/constants";

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Attaches a file that already exists in Drive as this role's resume or cover
 * letter.
 *
 * Written as a **pointer**: a Document row with no content, exactly like the
 * 118 adopted during reconciliation. Drive stays the record, the page offers
 * Edit Word doc, and the upload guards refuse to overwrite it. That is the
 * safe default for a file that may well be the one actually sent to a
 * recruiter - importing its text would make Counsel the record and put the
 * original one Save away from being replaced.
 *
 * The pdf id is set only when the picked file is itself a pdf, so a docx
 * attachment does not claim a pdf that was never checked.
 */
export async function attachDriveFile(applicationId: string, formData: FormData) {
  const fileId = String(formData.get("fileId") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim() as DocumentType;
  if (!fileId || !["resume", "cover_letter"].includes(type)) return;

  const isPdf = (await getDriveFile(fileId)).mimeType === "application/pdf";

  await prisma.document.create({
    data: {
      applicationId,
      type,
      content: "",
      isAtsSafe: false,
      driveFileIdDocx: isPdf ? null : fileId,
      driveFileIdPdf: isPdf ? fileId : null,
    },
  });

  // Deliberately no logActivity: this writes a Document row, and the timeline
  // reads those directly. Logging as well would double the entry - the rule in
  // CLAUDE.md about only logging what leaves no other trace.
  revalidatePath(`/applications/${applicationId}`);
}

/**
 * Pulls the text of an attached Drive document into Counsel so it can be
 * edited and refined here.
 *
 * Deliberately a separate, explicit step rather than something attaching does
 * for you, because it inverts which copy is authoritative: once there is
 * stored content, Counsel maintains the Drive file and the next save
 * overwrites it. Appends a new row instead of filling in the pointer, so the
 * pointer survives as history and the import is undoable like any other
 * version.
 */
export async function importDriveDocument(documentId: string, applicationId: string) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, type: true, applicationId: true, content: true, driveFileIdDocx: true, driveFileIdPdf: true },
  });
  if (!doc || doc.applicationId !== applicationId) return;
  if (doc.content.trim()) return; // already imported

  const fileId = doc.driveFileIdDocx;
  if (!fileId) return; // a pdf-only attachment has no text to pull

  const file = await getDriveFile(fileId);
  if (file.mimeType !== DOCX && file.mimeType !== "application/vnd.google-apps.document") return;

  const text = await driveDocxToText(fileId);
  if (!text.trim()) return;

  await prisma.document.create({
    data: {
      applicationId,
      type: doc.type,
      content: text,
      isAtsSafe: false,
      driveFileIdDocx: doc.driveFileIdDocx,
      driveFileIdPdf: doc.driveFileIdPdf,
    },
  });

  revalidatePath(`/applications/${applicationId}`);
}
