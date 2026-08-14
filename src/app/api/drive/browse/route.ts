import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDriveConnected, listFolder, searchDrive, ensureApplicationFolder } from "@/lib/google-drive";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Lists what is in Drive so an existing file can be attached to a role.
 *
 * Opens in the application's own company folder, because that is where the
 * file almost always is: 85 files came out of the reconciliation unattributed,
 * nearly all of them sitting loose in a folder shared by two roles. Search is
 * the escape hatch for the rest.
 */
export async function GET(request: NextRequest) {
  if (!(await isDriveConnected())) {
    return NextResponse.json({ error: "No Drive account connected. Connect one from the Profile page." }, { status: 400 });
  }

  const params = request.nextUrl.searchParams;
  const applicationId = params.get("applicationId");
  const folderId = params.get("folderId");
  const q = params.get("q");

  try {
    if (q?.trim()) {
      return NextResponse.json({ mode: "search", entries: await searchDrive(q) });
    }

    let target = folderId;
    if (!target && !applicationId) {
      // Attaching to a contact rather than a role: there is no company folder
      // to open in, so start at the search root and let the tree be walked.
      const profile = await prisma.profile.findFirst({ select: { driveRootFolderId: true } });
      target = profile?.driveRootFolderId ?? null;
      if (!target) return NextResponse.json({ error: "No Drive root folder set. Set one from the Profile page." }, { status: 400 });
    }
    if (!target && applicationId) {
      const app = await prisma.jobApplication.findUnique({
        where: { id: applicationId },
        select: { driveFolderId: true, company: { select: { driveFolderId: true } } },
      });
      // Prefer the company folder over the role folder: the loose files that
      // need attributing sit one level up from the role, so opening inside the
      // role folder would show an empty list in exactly the case this exists for.
      target = app?.company.driveFolderId ?? app?.driveFolderId ?? null;
      // Nothing cached yet - create the folder rather than failing, so a
      // company with no folder still opens somewhere sensible.
      if (!target && applicationId) target = await ensureApplicationFolder(applicationId);
    }

    if (!target) return NextResponse.json({ error: "No Drive folder for this application." }, { status: 404 });
    return NextResponse.json({ mode: "browse", folderId: target, entries: await listFolder(target) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
