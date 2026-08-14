import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { renderDocx } from "@/lib/docx-render";
import { renderPdf } from "@/lib/pdf-render";
import { DOCUMENT_FILENAME_LABELS, type DocumentType } from "@/lib/constants";

export const maxDuration = 60;

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = request.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "docx";
  // Inline serves the same bytes for display in an iframe instead of forcing a
  // download, so the preview panel shows the actual artifact rather than an
  // approximation of it.
  const inline = request.nextUrl.searchParams.get("inline") === "1";

  const doc = await prisma.document.findUnique({
    where: { id },
    include: { application: { include: { company: true } } },
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const typeLabel = DOCUMENT_FILENAME_LABELS[doc.type as DocumentType] ?? "Document";
  const companySlug = doc.application.company.name.replace(/[^a-zA-Z0-9]+/g, "");
  const filename = `Dan_Curis_${typeLabel}_${companySlug}.${format}`;

  // A document with no local content is one that only exists in Drive
  // (imported, never generated here), so the Drive copy is all there is to
  // serve. Anything with content is rendered from that content instead: the
  // stored text is the record, the Drive file is a copy of it, and rendering
  // is what guarantees a download reflects the last save even if the upload
  // that should have followed it failed.
  const driveFileId = format === "pdf" ? doc.driveFileIdPdf : doc.driveFileIdDocx;
  const isPointer = !doc.content.trim();

  if (isPointer) {
    // Adopted files were imported as pointers, and 46 of the 118 have a docx
    // in Drive but no pdf. Falling through would render the empty content into
    // a real, blank, correctly-named PDF - a download that looks like it
    // worked. Serve the other format instead, and say so plainly if neither
    // exists, because a document that silently downloads blank is the failure
    // most likely to reach a recruiter.
    const fallback = driveFileId ?? doc.driveFileIdDocx ?? doc.driveFileIdPdf;
    if (fallback) {
      return NextResponse.redirect(`https://drive.google.com/uc?export=download&id=${fallback}`);
    }
    return NextResponse.json(
      { error: "This document has no stored content and no file in Drive. Nothing to download." },
      { status: 404 }
    );
  }

  if (format === "pdf") {
    const buffer = await renderPdf(doc.content, doc.isAtsSafe, doc.type === "cover_letter" ? "letter" : "resume");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      },
    });
  }

  const buffer = await renderDocx(doc.content, doc.isAtsSafe, doc.type === "cover_letter" ? "letter" : "resume");
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
