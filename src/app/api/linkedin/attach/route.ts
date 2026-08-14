import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchLinkedInPosting, canonicalLinkedInUrl, htmlToText } from "@/lib/linkedin";
import { persistJobDescriptionDocument } from "@/lib/job-description";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Attaches a chosen LinkedIn posting to a role that already exists.
 *
 * The role's own title and company are left alone. The pipeline's wording is
 * Dan's, sometimes deliberately different from the posting's, and replacing it
 * with LinkedIn's would quietly rewrite the thing he recognises the role by.
 * Only the description, the posting link and the checked date move.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = typeof body?.applicationId === "string" ? body.applicationId : "";
  const jobId = typeof body?.jobId === "string" ? body.jobId : "";
  if (!applicationId || !jobId) {
    return NextResponse.json({ error: "applicationId and jobId are required." }, { status: 400 });
  }

  const application = await prisma.jobApplication.findUnique({ where: { id: applicationId } });
  if (!application) return NextResponse.json({ error: "Application not found." }, { status: 404 });

  const posting = await fetchLinkedInPosting(jobId);
  if (!posting || !posting.description.trim()) {
    return NextResponse.json({ error: "Could not read that posting from LinkedIn." }, { status: 502 });
  }

  let description = posting.description;
  let source: "linkedin" | "ats" = "linkedin";
  if (posting.applyIsAts && posting.applyUrl) {
    try {
      const res = await fetch(posting.applyUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130.0 Safari/537.36" },
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const full = htmlToText(await res.text());
        if (full.length > description.length * 1.2 && full.length > 800) {
          description = full;
          source = "ats";
        }
      }
    } catch {
      /* LinkedIn's copy is still usable */
    }
  }

  await persistJobDescriptionDocument(applicationId, description);
  await prisma.jobApplication.update({
    where: { id: applicationId },
    data: {
      postingLink: posting.applyUrl ?? canonicalLinkedInUrl(posting.jobId),
      // Deliberately not touching lastCheckedAt. The form calls that date
      // "when you actually applied - it doesn't auto-update", and attaching a
      // description is not applying. Bumping it made a Marriott role applied
      // to weeks ago read as applied today.
    },
  });

  return NextResponse.json({
    ok: true,
    source,
    chars: description.length,
    applyUrl: posting.applyUrl,
    closed: posting.closed,
  });
}
