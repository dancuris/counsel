import { NextRequest, NextResponse } from "next/server";
import { isDriveConnected, syncDocumentToDrive } from "@/lib/google-drive";

// Manual save, for the two cases automatic saving does not cover: a document
// generated before Drive was connected, and one whose automatic save failed
// quietly. Unlike the automatic path this one reports what went wrong, because
// here the save is the thing that was asked for.
export const maxDuration = 120;

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!(await isDriveConnected())) {
    return NextResponse.json(
      { error: "Google Drive isn't authorised. Reconnect the mailbox from the Profile page to grant it." },
      { status: 400 }
    );
  }

  try {
    const links = await syncDocumentToDrive(id);
    return NextResponse.json({ links });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
