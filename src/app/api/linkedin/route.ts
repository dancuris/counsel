import { NextRequest, NextResponse } from "next/server";
import { fetchLinkedInPosting, linkedInJobId, htmlToText } from "@/lib/linkedin";


export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Turns a pasted LinkedIn job URL into a posting.
 *
 * Where an offsite Apply points at a known ATS, the employer's own copy is
 * fetched too and preferred when it is longer. That copy is the canonical one:
 * LinkedIn truncates, the ATS does not, and job-boards.ts already knows how to
 * read those boards. LinkedIn stays the fallback rather than the source.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url") ?? "";
  if (!linkedInJobId(url)) {
    return NextResponse.json({ error: "That does not look like a LinkedIn job URL." }, { status: 400 });
  }

  const posting = await fetchLinkedInPosting(url);
  if (!posting) {
    return NextResponse.json(
      { error: "Could not read that posting from LinkedIn. Paste the description text instead." },
      { status: 502 }
    );
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
        const body = htmlToText(await res.text());
        // Only prefer it when it is clearly the fuller copy. An ATS page that
        // parses down to a login prompt or a cookie banner is shorter, and
        // taking it would replace a good description with boilerplate.
        if (body.length > description.length * 1.2 && body.length > 800) {
          description = body;
          source = "ats";
        }
      }
    } catch {
      // The LinkedIn copy is still perfectly usable; a failed ATS hop is not a
      // failed lookup.
    }
  }

  return NextResponse.json({
    jobId: posting.jobId,
    title: posting.title,
    company: posting.company,
    location: posting.location,
    criteria: posting.criteria,
    applyUrl: posting.applyUrl,
    applyIsAts: posting.applyIsAts,
    source,
    description,
    chars: description.length,
  });
}
