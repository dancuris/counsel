import { NextRequest, NextResponse } from "next/server";
import { getAiErrorMessage } from "@/lib/ai";
import { buildMasterResume, buildIntroLetter, fileGeneralDocument, GENERAL_KINDS, type GeneralKind } from "@/lib/general-documents";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Rebuilds a general document and files it. One kind per call. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const kind = typeof body?.kind === "string" ? body.kind : "";
  if (!(kind in GENERAL_KINDS)) {
    return NextResponse.json({ error: "Unknown document." }, { status: 400 });
  }

  try {
    const content = kind === "master_resume" ? await buildMasterResume() : await buildIntroLetter();
    // A rebuild that came back short is a failed generation, not a new
    // document, and overwriting the Drive file with it would repeat the
    // cover-letter loss on the one resume Dan hands out by hand.
    if (content.trim().length < 600) {
      return NextResponse.json({ error: "The rebuild came back too short to be real. Nothing was changed." }, { status: 502 });
    }
    const saved = await fileGeneralDocument(kind as GeneralKind, content);
    return NextResponse.json({
      id: saved.id,
      words: content.trim().split(/\s+/).length,
      docx: saved.driveFileIdDocx,
      pdf: saved.driveFileIdPdf,
    });
  } catch (e) {
    return NextResponse.json({ error: getAiErrorMessage(e) }, { status: 502 });
  }
}
