import { prisma } from "@/lib/prisma";
import { renderDocx } from "@/lib/docx-render";
import { renderPdf } from "@/lib/pdf-render";
import { DOCUMENT_FILENAME_LABELS, type DocumentType } from "@/lib/constants";

export type RenderedDocument = { filename: string; mimeType: string; data: Buffer };

const MIME = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pdf: "application/pdf",
} as const;

/**
 * Renders a stored document to a file, using the same naming convention as the
 * download button so a recruiter receives the filename Dan expects.
 *
 * Rendering happens at call time rather than being cached against the draft:
 * documents are append-only, so a draft written on Monday and sent on Friday
 * must carry Friday's resume, not a stale copy.
 */
export async function renderDocumentFile(
  documentId: string,
  format: "docx" | "pdf" = "docx"
): Promise<RenderedDocument | null> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: { application: { include: { company: true } } },
  });
  if (!doc) return null;

  const typeLabel = DOCUMENT_FILENAME_LABELS[doc.type as DocumentType] ?? "Document";
  const companySlug = doc.application.company.name.replace(/[^a-zA-Z0-9]+/g, "");
  const data =
    format === "pdf"
      ? await renderPdf(doc.content, doc.isAtsSafe, doc.type === "cover_letter" ? "letter" : "resume")
      : await renderDocx(doc.content, doc.isAtsSafe, doc.type === "cover_letter" ? "letter" : "resume");

  return {
    filename: `Dan_Curis_${typeLabel}_${companySlug}.${format}`,
    mimeType: MIME[format],
    data: Buffer.from(data),
  };
}

/**
 * Two kinds of attachment, and the difference matters at send time.
 *
 * A document ref points at a generated resume or cover letter and is rendered
 * fresh from `content`, so a draft written on Monday carries Friday's version.
 * A Drive ref points at a file Dan already has - a portfolio, a reference, a
 * deck - which has no representation here and is fetched as bytes instead.
 */
export type AttachmentRef =
  | { kind: "document"; documentId: string; format: "docx" | "pdf" }
  | { kind: "drive"; driveFileId: string; name: string };

export function parseAttachments(raw: string | null | undefined): AttachmentRef[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((x): AttachmentRef[] => {
      // Rows written before Drive attachments existed carry no `kind` and are
      // always document refs.
      if (typeof x?.documentId === "string") {
        return [{ kind: "document", documentId: x.documentId, format: x.format === "pdf" ? "pdf" : "docx" }];
      }
      if (typeof x?.driveFileId === "string") {
        return [{ kind: "drive", driveFileId: x.driveFileId, name: typeof x.name === "string" ? x.name : "Attachment" }];
      }
      return [];
    });
  } catch {
    return [];
  }
}
