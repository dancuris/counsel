import { cleanInlineText } from "@/lib/text";

/**
 * Reads a LinkedIn job posting from a pasted URL.
 *
 * The page you paste is not the page we fetch. `/jobs/view/<id>` redirects
 * unauthenticated traffic - an expired posting sent a test straight to a
 * Spanish job-search page - but LinkedIn publishes a guest endpoint for the
 * same posting that needs no login and returns the whole thing: title, company,
 * location, the seniority/employment-type criteria, and the description body.
 *
 * That endpoint is why this does not need to log in as Dan. Automating a
 * LinkedIn login from a server is what gets accounts restricted, and it would
 * buy nothing here: reading a page LinkedIn serves to anonymous visitors is a
 * different act from signing in and harvesting.
 *
 * It is undocumented, so everything here degrades to null rather than throwing.
 * A failed lookup must leave the paste-the-text path working, not break it.
 */

const GUEST = "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting";

// Sending a browser User-Agent is not evasion; without one LinkedIn serves a
// redirect stub rather than the posting.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

const ATS = /(greenhouse\.io|lever\.co|myworkdayjobs\.com|workday|icims\.com|smartrecruiters\.com|ashbyhq\.com|taleo\.net|jobvite\.com|successfactors)/i;

export type LinkedInPosting = {
  jobId: string;
  title: string | null;
  company: string | null;
  location: string | null;
  description: string;
  /** Where the Apply button actually goes, when the posting applies offsite. */
  applyUrl: string | null;
  /** True when applyUrl points at a known applicant tracking system. */
  applyIsAts: boolean;
  criteria: string[];
  /** LinkedIn says the posting has stopped taking applications. */
  closed: boolean;
};

/** The posting URL without LinkedIn's tracking payload. */
export function canonicalLinkedInUrl(jobId: string): string {
  return `https://www.linkedin.com/jobs/view/${jobId}/`;
}

/** Pulls the numeric job id out of any of the URL shapes LinkedIn hands out. */
export function linkedInJobId(input: string): string | null {
  const url = input.trim();
  if (!url) return null;
  const patterns = [
    /linkedin\.com\/jobs\/view\/(?:[^/?#]*-)?(\d{6,})/i,
    /linkedin\.com\/jobs-guest\/jobs\/api\/jobPosting\/(\d{6,})/i,
    /[?&]currentJobId=(\d{6,})/i,
    /^(\d{6,})$/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|li|div|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstMatch(html: string, patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const m = html.match(p);
    if (m?.[1]) {
      const v = cleanInlineText(htmlToText(m[1]));
      if (v) return v;
    }
  }
  return null;
}

export async function fetchLinkedInPosting(input: string): Promise<LinkedInPosting | null> {
  const jobId = linkedInJobId(input);
  if (!jobId) return null;

  let html: string;
  try {
    const res = await fetch(`${GUEST}/${jobId}`, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      // A posting that takes this long is not going to be worth waiting for
      // when pasting the text by hand is right there.
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }
  if (html.length < 500) return null;

  const title = firstMatch(html, [
    /<h2[^>]*top-card-layout__title[^>]*>([\s\S]*?)<\/h2>/i,
    /<h1[^>]*>([\s\S]*?)<\/h1>/i,
  ]);
  const company = firstMatch(html, [
    /topcard__org-name-link[^>]*>([\s\S]*?)<\/a>/i,
    /<a[^>]*topcard__flavor[^>]*>([\s\S]*?)<\/a>/i,
  ]);
  const location = firstMatch(html, [/topcard__flavor--bullet[^>]*>([\s\S]*?)<\/span>/i]);

  const criteria = [...html.matchAll(/description__job-criteria-text[^>]*>([\s\S]*?)<\/span>/gi)]
    .map((m) => cleanInlineText(htmlToText(m[1])))
    .filter(Boolean)
    .slice(0, 6);

  const bodyMatch = html.match(/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/i);
  const description = bodyMatch ? htmlToText(bodyMatch[1]) : "";

  // The Apply button. Offsite applies point at the employer's own ATS, which is
  // public, stable and already parseable by job-boards.ts - a better source
  // than LinkedIn's copy of the posting, and it carries the board we can
  // re-check later for whether the role is still open.
  const applyUrl =
    [...html.matchAll(/href="(https:\/\/[^"]+)"/gi)]
      .map((m) => m[1].replace(/&amp;/g, "&"))
      .find((u) => ATS.test(u)) ??
    html.match(/"applyUrl"\s*:\s*"([^"]+)"/i)?.[1]?.replace(/\\u002F/g, "/").replace(/&amp;/g, "&") ??
    null;

  // A closed posting is worth knowing before it is filed as a live opportunity.
  // LinkedIn marks it two ways and both are reliable: a `closed-job` class on
  // the topcard, and the words in the flavour row. An open posting carries
  // neither - checked against one of each.
  const closed = /class="[^"]*closed-job/i.test(html) || /no longer accepting applications/i.test(html);

  return {
    jobId,
    title,
    company,
    location,
    description,
    applyUrl,
    applyIsAts: Boolean(applyUrl && ATS.test(applyUrl)),
    criteria,
    closed,
  };
}

/* ------------------------------------------------------------------ *
 * Searching for the posting behind a role already in the pipeline.
 * ------------------------------------------------------------------ */

const SEARCH = "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search";

export type JobCandidate = {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  /** 0 to 1. 1 means the normalised title and employer both match exactly. */
  score: number;
  exact: boolean;
  closed: boolean;
};

/** Case, punctuation and the VP/Vice President split all collapse away. */
export function normaliseTitle(v: string): string {
  return v
    .toLowerCase()
    .replace(/&amp;/g, "&")
    // "&" and "and" have to collapse to the same thing before punctuation is
    // stripped, or "Data & Measurement" and "Data and Measurement" - the same
    // title, written two ways - compare as different and a certain match gets
    // sent for review.
    .replace(/&/g, " and ")
    .replace(/\bvice president\b/g, "vp")
    .replace(/\bsenior\b/g, "sr")
    .replace(/\bdirector\b/g, "dir")
    .replace(/[^a-z0-9]/g, "");
}

function tokens(v: string): Set<string> {
  return new Set(
    v
      .toLowerCase()
      .replace(/&amp;/g, "&")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !["the", "and", "for", "with", "our"].includes(t))
  );
}

/**
 * Searches LinkedIn's public job search for a role.
 *
 * Deliberately returns candidates rather than an answer. A search for one
 * JPMorgan role came back with four plausible near-misses at the same employer
 * ahead of the right posting, and a wrong job description does not look wrong -
 * it produces a confident, well-formatted resume for a job that was never read.
 * So the caller either confirms, or takes only an exact match.
 */
export async function searchLinkedInJobs(roleTitle: string, company: string): Promise<JobCandidate[]> {
  const params = new URLSearchParams({
    keywords: `${roleTitle} ${company}`.trim(),
    location: "United States",
    start: "0",
  });

  let html: string;
  try {
    const res = await fetch(`${SEARCH}?${params}`, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }

  const cards = html.split("<li>").slice(1);
  const wantedTitle = normaliseTitle(roleTitle);
  const wantedCompany = normaliseTitle(company);
  const titleTokens = tokens(roleTitle);

  const out: JobCandidate[] = [];
  for (const card of cards) {
    const jobId =
      card.match(/data-entity-urn="urn:li:jobPosting:(\d+)"/)?.[1] ??
      card.match(/\/jobs\/view\/[^"?]*?-(\d{8,})/)?.[1];
    if (!jobId || out.some((c) => c.jobId === jobId)) continue;

    const title = cleanInlineText(htmlToText(card.match(/base-search-card__title[^>]*>([\s\S]*?)<\//)?.[1] ?? ""));
    const cardCompany = cleanInlineText(htmlToText(card.match(/base-search-card__subtitle[^>]*>([\s\S]*?)<\//)?.[1] ?? ""));
    const location = cleanInlineText(htmlToText(card.match(/job-search-card__location[^>]*>([\s\S]*?)<\//)?.[1] ?? "")) || null;
    if (!title) continue;

    const sameCompany = normaliseTitle(cardCompany) === wantedCompany;
    const sameTitle = normaliseTitle(title) === wantedTitle;

    // Token overlap against the role title, then a bonus for the right
    // employer. Company agreement alone must never carry a candidate: that is
    // exactly the near-miss case.
    const found = tokens(title);
    const shared = [...titleTokens].filter((t) => found.has(t)).length;
    const overlap = titleTokens.size ? shared / titleTokens.size : 0;
    const score = Math.min(1, overlap * 0.75 + (sameCompany ? 0.25 : 0));

    out.push({
      jobId,
      title,
      company: cardCompany,
      location,
      url: canonicalLinkedInUrl(jobId),
      score: sameTitle && sameCompany ? 1 : score,
      exact: sameTitle && sameCompany,
      closed: /closed-job|no longer accepting/i.test(card),
    });
  }

  return out.sort((a, b) => b.score - a.score);
}
