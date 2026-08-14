import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchLinkedInPosting, linkedInJobId, htmlToText, canonicalLinkedInUrl } from "@/lib/linkedin";
import { persistJobDescriptionDocument } from "@/lib/job-description";
import { cleanInlineText } from "@/lib/text";
import { normalizeName } from "@/lib/drive-match";
import { statusForClosedPosting } from "@/lib/mail-status";
import { NOT_DELETED } from "@/lib/data/applications";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/**
 * Paste a LinkedIn URL, get a tracked opportunity with its description stored.
 *
 * Evaluation is deliberately left to the caller rather than run here. It is the
 * slow half, and doing it inline means one long opaque request; kicking it off
 * separately lets the UI say "reading the posting" and then "evaluating"
 * instead of spinning silently for half a minute.
 *
 * `postingLink` gets the employer's own apply URL when the posting applies
 * offsite, because that is what the Apply button should open - a LinkedIn
 * wrapper is the thing the existing "find the real posting" flow exists to
 * replace. The LinkedIn URL is kept in the notes so the trail is not lost.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const url = typeof body?.url === "string" ? body.url.trim() : "";

  if (!linkedInJobId(url)) {
    return NextResponse.json({ error: "That does not look like a LinkedIn job URL." }, { status: 400 });
  }

  const posting = await fetchLinkedInPosting(url);
  if (!posting) {
    return NextResponse.json(
      { error: "Could not read that posting. It may have expired - paste the description instead." },
      { status: 502 }
    );
  }

  const companyName = cleanInlineText(posting.company ?? "");
  const roleTitle = cleanInlineText(posting.title ?? "");
  if (!companyName || !roleTitle) {
    return NextResponse.json(
      { error: "Read the posting but could not find a company and role in it. Add it by hand." },
      { status: 422 }
    );
  }

  // Don't create a second entry for something already tracked.
  //
  // The candidate set is every live role, not just the ones at an exactly
  // matching company name. Filtering by company first is what let one
  // duplicate through: the title matched perfectly - "VP, Marketing" against
  // "VP-Marketing" - but the employer was stored one way and LinkedIn
  // called it another, so the perfect match was never compared. At
  // this size loading them all costs nothing.
  const canonical = canonicalLinkedInUrl(posting.jobId);
  const normalise = (v: string) =>
    v.toLowerCase().replace(/\bvice president\b/g, "vp").replace(/\bsenior\b/g, "sr").replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
  const tokens = (v: string) =>
    new Set(v.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !["and", "the", "inc", "llc", "group", "corp"].includes(t)));
  const overlap = (a: string, b: string) => {
    const x = tokens(a);
    const y = tokens(b);
    if (!x.size || !y.size) return 0;
    return [...x].filter((t) => y.has(t)).length / Math.max(x.size, y.size);
  };

  const wanted = normalise(roleTitle);
  const wantedCompanyNorm = normalizeName(companyName);

  const candidates = await prisma.jobApplication.findMany({
    where: NOT_DELETED,
    select: { id: true, roleTitle: true, status: true, postingLink: true, notes: true, company: { select: { name: true } } },
  });

  const sameCompany = (c: (typeof candidates)[number]) => normalizeName(c.company.name) === wantedCompanyNorm;
  const titleMatches = (c: (typeof candidates)[number]) =>
    normalise(c.roleTitle) === wanted || overlap(c.roleTitle, roleTitle) >= 0.85;

  // Certain: the same posting id, or the same title at the same employer.
  const definite =
    candidates.find((c) => `${c.postingLink ?? ""} ${c.notes ?? ""}`.includes(posting.jobId)) ??
    candidates.find((c) => sameCompany(c) && titleMatches(c));

  if (definite) {
    return NextResponse.json({
      applicationId: definite.id,
      alreadyTracked: true,
      company: companyName,
      roleTitle: definite.roleTitle,
      status: definite.status,
    });
  }

  // Likely, but not certain enough to act on alone. A matching title at a
  // company whose name merely overlaps is exactly that case - and also
  // exactly how "VP Marketing" at one employer could be merged into "VP
  // Marketing" at another, which is why this asks instead of deciding.
  // "American Express" and "American Airlines" share a word too.
  const possible = body?.force
    ? null
    : candidates.find((c) => titleMatches(c) && overlap(c.company.name, companyName) > 0);

  if (possible) {
    return NextResponse.json({
      possibleDuplicate: {
        applicationId: possible.id,
        company: possible.company.name,
        roleTitle: possible.roleTitle,
        status: possible.status,
      },
      company: companyName,
      roleTitle,
    });
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

  // Match an existing employer on the normalised name before creating one.
  // LinkedIn writes "JPMorganChase" where the pipeline holds "JPMorgan Chase",
  // and an exact-name upsert made that a separate company - a fourth JPMorgan
  // entry, hours after three were merged into one. normalizeName is the same
  // comparison the Drive reconciliation uses, so the two agree on what counts
  // as the same employer.
  const wantedCompany = normalizeName(companyName);
  const known = await prisma.company.findMany({ select: { id: true, name: true } });
  const match = known.find((c) => normalizeName(c.name) === wantedCompany);

  const company = match
    ? await prisma.company.findUniqueOrThrow({ where: { id: match.id } })
    : await prisma.company.create({ data: { name: companyName, driveFolderName: companyName } });

  const trail = [
    posting.closed ? "LinkedIn says this posting is no longer accepting applications." : null,
    posting.location ? `Location: ${posting.location}` : null,
    posting.criteria.length ? posting.criteria.join(" · ") : null,
    `Imported from ${canonical}`,
  ]
    .filter(Boolean)
    .join("\n");

  const application = await prisma.jobApplication.create({
    data: {
      companyId: company.id,
      roleTitle,
      postingLink: posting.applyUrl ?? canonical,
      // A posting that has stopped taking applications is not a live
      // opportunity, and filing it as one puts a role in the queue that cannot
      // be applied to. Tracked either way - still worth knowing it existed and
      // was missed - but honestly labelled.
      //
      // Through statusForClosedPosting rather than inline, so the rule that a
      // closed posting must never touch a role already applied to lives in one
      // place. Trivially true here, since this branch only ever runs for a role
      // being created; the point is that it stays true for the next caller.
      status: posting.closed
        ? (statusForClosedPosting("LIVE_POSTING_FOUND")?.next ?? "LIVE_POSTING_FOUND")
        : "LIVE_POSTING_FOUND",
      lastCheckedAt: new Date(),
      notes: trail,
    },
  });

  if (description.trim()) await persistJobDescriptionDocument(application.id, description);

  return NextResponse.json({
    applicationId: application.id,
    company: companyName,
    roleTitle,
    source,
    applyUrl: posting.applyUrl,
    chars: description.length,
    hasDescription: Boolean(description.trim()),
    closed: posting.closed,
  });
}
