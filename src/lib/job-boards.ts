/**
 * Finds the canonical posting for a role on the employer's own applicant
 * tracking system.
 *
 * This exists because the aggregators are closed. LinkedIn returns 404 to an
 * unauthenticated request and forbids scraping; Indeed returns 403; ZipRecruiter
 * is approval-gated. Every ATS below, by contrast, serves its job board as
 * unauthenticated JSON, because that is how the employer's own careers page
 * renders it.
 *
 * Going to the source is also just better data than an aggregator would give:
 * the untruncated description, whether the req is still open, and the direct
 * apply link rather than a LinkedIn Easy Apply wrapper. It caught a real
 * discrepancy on the first try - bp's posting showed as "Chicago" on LinkedIn
 * while the requisition was actually against Louisville.
 */

import { cleanInlineText } from "@/lib/text";

export type Provider = "greenhouse" | "lever" | "ashby" | "smartrecruiters" | "workday";

export type Posting = {
  title: string;
  location: string;
  url: string;
  reqId?: string;
  postedOn?: string;
  /** Provider-specific handle used to fetch the full description. */
  detailPath?: string;
};

export type BoardRef = { provider: Provider; boardUrl: string };

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function get(url: string, init?: RequestInit, ms = 12_000): Promise<Response | null> {
  try {
    return await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(ms),
    });
  } catch {
    return null;
  }
}

/** "Sam's Club" -> ["samsclub", "sams-club"]. Boards use one or the other. */
function slugCandidates(company: string): string[] {
  const base = company.toLowerCase().replace(/[.,']/g, "").trim();
  const compact = base.replace(/[^a-z0-9]/g, "");
  const dashed = base.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const firstWord = base.split(/\s+/)[0].replace(/[^a-z0-9]/g, "");
  return [...new Set([compact, dashed, firstWord])].filter((s) => s.length > 1);
}

// ---------------------------------------------------------------- discovery

/**
 * A company's own careers page almost always leaks which ATS it uses, which is
 * the only reliable way to find a Workday tenant: those are arbitrary strings
 * (bp's is "bpinternational" on the wd3 host) and cannot be guessed.
 */
function sniffAts(html: string): BoardRef | null {
  const wd = html.match(/https?:\/\/([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)/i);
  if (wd) {
    const [, tenant, host, site] = wd;
    return { provider: "workday", boardUrl: `https://${tenant}.${host}.myworkdayjobs.com/wday/cxs/${tenant}/${site}` };
  }
  const gh = html.match(/boards\.greenhouse\.io\/(?:embed\/job_board\?for=)?([a-z0-9_-]+)/i);
  if (gh) return { provider: "greenhouse", boardUrl: `https://boards-api.greenhouse.io/v1/boards/${gh[1]}` };
  const lv = html.match(/jobs\.lever\.co\/([a-z0-9_-]+)/i);
  if (lv) return { provider: "lever", boardUrl: `https://api.lever.co/v0/postings/${lv[1]}` };
  const ab = html.match(/jobs\.ashbyhq\.com\/([a-z0-9._-]+)/i);
  if (ab) return { provider: "ashby", boardUrl: `https://api.ashbyhq.com/posting-api/job-board/${ab[1]}` };
  const sr = html.match(/careers\.smartrecruiters\.com\/([A-Za-z0-9_-]+)/i);
  if (sr) return { provider: "smartrecruiters", boardUrl: `https://api.smartrecruiters.com/v1/companies/${sr[1]}/postings` };
  return null;
}

/**
 * Platforms with no public JSON board. Naming them is the difference between
 * "nothing found" and "they post through ADP, here is the link" - and the
 * second is actionable.
 *
 * Matched against hrefs rather than bare hostnames so the real job-search URL
 * can be handed back. GoTo Foods' careers page, for instance, is a landing
 * page whose only useful element is an outbound link to ADP.
 */
const CLOSED_PLATFORMS: [RegExp, string][] = [
  [/https?:\/\/recruiting\.adp\.com\/[^"'\s]+/i, "ADP Recruiting"],
  [/https?:\/\/[a-z0-9.-]*oraclecloud\.com\/[^"'\s]+/i, "Oracle Recruiting Cloud"],
  [/https?:\/\/[a-z0-9.-]*eightfold\.ai\/[^"'\s]+/i, "Eightfold"],
  [/https?:\/\/[a-z0-9.-]*icims\.com\/[^"'\s]+/i, "iCIMS"],
  [/https?:\/\/[a-z0-9.-]*successfactors\.com\/[^"'\s]+/i, "SuccessFactors"],
  [/https?:\/\/[a-z0-9.-]*taleo\.net\/[^"'\s]+/i, "Taleo"],
  [/https?:\/\/[a-z0-9.-]*avature\.net\/[^"'\s]+/i, "Avature"],
  [/https?:\/\/[a-z0-9.-]*phenompeople\.com\/[^"'\s]+/i, "Phenom"],
];

function sniffClosed(html: string): { platform: string; url: string } | null {
  for (const [re, platform] of CLOSED_PLATFORMS) {
    const m = html.match(re);
    if (m) return { platform, url: m[0].replace(/&amp;/g, "&") };
  }
  return null;
}

export type Discovery = { board: BoardRef | null; careersUrl?: string; platform?: string };

/**
 * A company's own careers page almost always leaks which ATS it uses, which is
 * the only reliable way to find a Workday tenant: those are arbitrary strings
 * (bp's is "bpinternational" on the wd3 host) and cannot be guessed.
 *
 * Large enterprises increasingly run their own client-rendered careers portal,
 * so the platform never appears in the served HTML. When that happens the live
 * careers URL is still worth returning - a verified link to the right place
 * beats reporting nothing.
 */
async function discoverFromCareersPage(company: string): Promise<Discovery> {
  const domain = company.toLowerCase().replace(/[^a-z0-9]/g, "");
  const pages = [
    `https://careers.${domain}.com/`,
    `https://jobs.${domain}.com/`,
    `https://www.${domain}.com/careers`,
    `https://${domain}.com/careers`,
  ];

  let careersUrl: string | undefined;
  let platform: string | undefined;

  for (const page of pages) {
    const res = await get(page, { headers: { Accept: "text/html" }, redirect: "follow" }, 15_000);
    if (!res?.ok) continue;
    const html = await res.text();
    careersUrl ??= res.url || page;

    const hit = sniffAts(html);
    if (hit) return { board: hit, careersUrl: res.url || page };

    const closed = sniffClosed(html);
    if (closed) {
      platform ??= closed.platform;
      // Prefer the platform's own job-search URL over the marketing page.
      careersUrl = closed.url;
    }

    // One level deeper: portal home pages often only link to the listing page,
    // and the ATS is embedded there rather than on the landing page.
    const deeper = html.match(/href="((?:https?:\/\/[^"]+)?\/[^"]*(?:search-jobs|job-search|listing|jobs)[^"]*)"/i);
    if (deeper) {
      const next = deeper[1].startsWith("http") ? deeper[1] : new URL(deeper[1], res.url || page).toString();
      const res2 = await get(next, { headers: { Accept: "text/html" }, redirect: "follow" }, 15_000);
      if (res2?.ok) {
        const html2 = await res2.text();
        const hit2 = sniffAts(html2);
        if (hit2) return { board: hit2, careersUrl: res.url || page };
        const closed2 = sniffClosed(html2);
        if (closed2) {
          platform ??= closed2.platform;
          careersUrl = closed2.url;
        }
      }
    }
  }
  return { board: null, careersUrl, platform };
}

/** Probes the boards that can be addressed by a guessable slug. */
export async function discoverBoard(company: string): Promise<Discovery> {
  for (const slug of slugCandidates(company)) {
    const probes: { provider: Provider; probe: string; boardUrl: string }[] = [
      {
        provider: "greenhouse",
        probe: `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`,
        boardUrl: `https://boards-api.greenhouse.io/v1/boards/${slug}`,
      },
      {
        provider: "lever",
        probe: `https://api.lever.co/v0/postings/${slug}?mode=json&limit=1`,
        boardUrl: `https://api.lever.co/v0/postings/${slug}`,
      },
      {
        provider: "ashby",
        probe: `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
        boardUrl: `https://api.ashbyhq.com/posting-api/job-board/${slug}`,
      },
      {
        provider: "smartrecruiters",
        probe: `https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=1`,
        boardUrl: `https://api.smartrecruiters.com/v1/companies/${slug}/postings`,
      },
    ];

    for (const { provider, probe, boardUrl } of probes) {
      const res = await get(probe);
      if (!res?.ok) continue;
      // A 200 is not enough. SmartRecruiters answers 200 for "bp" with an empty
      // decoy tenant, which would otherwise be cached as the real board and
      // permanently mask the correct one.
      const body = await res.json().catch(() => null);
      if (countPostings(provider, body) > 0) return { board: { provider, boardUrl } };
    }
  }
  return discoverFromCareersPage(company);
}

function countPostings(provider: Provider, body: unknown): number {
  if (!body || typeof body !== "object") return 0;
  const b = body as Record<string, unknown>;
  if (provider === "greenhouse") return Array.isArray(b.jobs) ? b.jobs.length : 0;
  if (provider === "ashby") return Array.isArray(b.jobs) ? b.jobs.length : 0;
  if (provider === "smartrecruiters") return typeof b.totalFound === "number" ? b.totalFound : 0;
  if (provider === "lever") return Array.isArray(body) ? (body as unknown[]).length : 0;
  return 0;
}

// ------------------------------------------------------------------ search

const asStr = (v: unknown) => (typeof v === "string" ? v : "");

export async function searchBoard(board: BoardRef, query: string): Promise<Posting[]> {
  const { provider, boardUrl } = board;

  if (provider === "workday") {
    const res = await get(boardUrl + "/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: query }),
    }, 25_000);
    if (!res?.ok) return [];
    const d = (await res.json().catch(() => null)) as { jobPostings?: Record<string, unknown>[] } | null;
    const site = boardUrl.replace("/wday/cxs/", "/").replace(/\/[^/]+\/([^/]+)$/, "/$1");
    return (d?.jobPostings ?? []).map((p) => ({
      title: cleanInlineText(asStr(p.title)),
      location: cleanInlineText(asStr(p.locationsText)),
      url: site + asStr(p.externalPath),
      reqId: asStr(p.bulletFields ? (p.bulletFields as string[])[0] : ""),
      postedOn: asStr(p.postedOn),
      detailPath: asStr(p.externalPath),
    }));
  }

  if (provider === "greenhouse") {
    const res = await get(`${boardUrl}/jobs`, undefined, 25_000);
    if (!res?.ok) return [];
    const d = (await res.json().catch(() => null)) as { jobs?: Record<string, unknown>[] } | null;
    return (d?.jobs ?? []).map((j) => ({
      title: cleanInlineText(asStr(j.title)),
      location: cleanInlineText(asStr((j.location as Record<string, unknown>)?.name)),
      url: asStr(j.absolute_url),
      reqId: String(j.id ?? ""),
      postedOn: asStr(j.updated_at),
      detailPath: String(j.id ?? ""),
    }));
  }

  if (provider === "lever") {
    const res = await get(`${boardUrl}?mode=json`, undefined, 25_000);
    if (!res?.ok) return [];
    const d = (await res.json().catch(() => null)) as Record<string, unknown>[] | null;
    return (d ?? []).map((j) => ({
      title: cleanInlineText(asStr(j.text)),
      location: cleanInlineText(asStr((j.categories as Record<string, unknown>)?.location)),
      url: asStr(j.hostedUrl),
      reqId: asStr(j.id),
      detailPath: asStr(j.id),
    }));
  }

  if (provider === "ashby") {
    const res = await get(boardUrl, undefined, 25_000);
    if (!res?.ok) return [];
    const d = (await res.json().catch(() => null)) as { jobs?: Record<string, unknown>[] } | null;
    return (d?.jobs ?? []).map((j) => ({
      title: cleanInlineText(asStr(j.title)),
      location: cleanInlineText(asStr(j.location)),
      url: asStr(j.jobUrl),
      reqId: asStr(j.id),
      detailPath: asStr(j.descriptionHtml || j.descriptionPlain || ""),
    }));
  }

  // smartrecruiters
  const res = await get(`${boardUrl}?limit=100&q=${encodeURIComponent(query)}`, undefined, 25_000);
  if (!res?.ok) return [];
  const d = (await res.json().catch(() => null)) as { content?: Record<string, unknown>[] } | null;
  return (d?.content ?? []).map((j) => {
    const loc = (j.location ?? {}) as Record<string, unknown>;
    return {
      title: cleanInlineText(asStr(j.name)),
      location: [asStr(loc.city), asStr(loc.region)].filter(Boolean).join(", "),
      url: `https://jobs.smartrecruiters.com/${asStr(j.id)}`,
      reqId: asStr(j.refNumber) || asStr(j.id),
      postedOn: asStr(j.releasedDate),
      detailPath: asStr(j.id),
    };
  });
}

/**
 * Ranks by word overlap against the role title. Boards differ wildly in whether
 * their search parameter does anything useful - Workday's does, Greenhouse has
 * none at all and returns the entire board - so the ranking happens here rather
 * than being trusted to the provider.
 */
const STOP = new Set(["the", "of", "and", "a", "for", "to", "in", "at", "senior", "head", "vice", "president", "vp", "director"]);

// Seniority is a hard gate, not a tie-break. Token overlap alone matched
// "VP, Marketing Technology" to "Growth Marketing Manager" and "VP Marketing"
// to "3D Marketing Artist", both of which scored well because "marketing" is
// the only distinctive word in the tracked title. Those were written to real
// applications and evaluated. A wrong description is worse than none: it makes
// the verdict, the resume and the cover letter all confidently about the wrong
// job.
const SENIOR = /\b(vp|svp|evp|avp|vice[- ]president|head|chief|c[te]o|cmo|cio|director|md|managing[- ]director|president|partner)\b/i;
const INDIVIDUAL = /\b(manager|analyst|associate|coordinator|specialist|artist|engineer|developer|designer|architect|consultant|assistant|representative|intern|supervisor|lead|advisor|planner|writer|producer|strategist|technician|administrator)\b/i;

/** True when the tracked role is a leadership seat and the candidate posting is not. */
function seniorityMismatch(roleTitle: string, candidate: string): boolean {
  const wantSenior = SENIOR.test(roleTitle);
  if (!wantSenior) return false;
  return !SENIOR.test(candidate) && INDIVIDUAL.test(candidate);
}

export function rankPostings(postings: Posting[], roleTitle: string): Posting[] {
  const want = new Set(
    roleTitle
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );
  if (want.size === 0) return postings.slice(0, 8);

  // A title like "Vice President, Marketing" reduces to the single token
  // {marketing}, which then scores 1.0 against "ABM & Field Marketing Manager"
  // on a 3,500-posting board. When the distinctive vocabulary is thin the bar
  // has to rise, or the top result is confidently wrong.
  const floor = want.size <= 1 ? 1 : want.size === 2 ? 0.5 : 0.34;

  return postings
    .filter((p) => !seniorityMismatch(roleTitle, p.title))
    .map((p) => {
      const have = new Set(p.title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
      let hits = 0;
      for (const w of want) if (have.has(w)) hits += 1;
      const score = hits / want.size;
      // Tie-break on seniority words that the stop list drops but that matter a
      // great deal here: a VP role and a Manager role are not near-matches.
      const senior = /\b(head|vice president|vp|svp|director|chief)\b/i;
      const bonus = senior.test(roleTitle) && senior.test(p.title) ? 0.15 : 0;
      return { p, score: score + bonus };
    })
    .filter((x) => x.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((x) => x.p);
}


// ------------------------------------------------------------ full posting

/** HTML to readable text, preserving list and paragraph breaks. */
function toText(html: string): string {
  let t = html.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n");
  t = t.replace(/<li[^>]*>/gi, "- ").replace(/<[^>]+>/g, "");
  t = t
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&mdash;/g, "-");
  return t.replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Pulls the full description for one posting. This is the point of the whole
 * module: the untruncated text an employer actually published, rather than the
 * summary an aggregator chose to show.
 */
export async function fetchPostingDetail(board: BoardRef, posting: Posting): Promise<string | null> {
  const { provider, boardUrl } = board;
  const handle = posting.detailPath ?? "";

  if (provider === "workday") {
    if (!handle) return null;
    const res = await get(boardUrl + handle, undefined, 25_000);
    if (!res?.ok) return null;
    const d = (await res.json().catch(() => null)) as { jobPostingInfo?: Record<string, unknown> } | null;
    const i = d?.jobPostingInfo;
    if (!i) return null;
    const header = [
      `Requisition: ${asStr(i.jobReqId)}`,
      `Posted: ${asStr(i.startDate)}`,
      `Location: ${asStr(i.location)}`,
      Array.isArray(i.additionalLocations) && i.additionalLocations.length
        ? `Additional locations: ${(i.additionalLocations as string[]).join("; ")}`
        : "",
      `${asStr(i.timeType)} | ${asStr(i.remoteType)}`,
    ]
      .filter(Boolean)
      .join("\n");
    return `${header}\n\n${toText(asStr(i.jobDescription))}`;
  }

  if (provider === "greenhouse") {
    const res = await get(`${boardUrl}/jobs/${handle}?content=true`, undefined, 20_000);
    if (!res?.ok) return null;
    const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return d ? toText(asStr(d.content)) : null;
  }

  if (provider === "lever") {
    const res = await get(`${boardUrl}/${handle}`, undefined, 20_000);
    if (!res?.ok) return null;
    const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!d) return null;
    const lists = Array.isArray(d.lists)
      ? (d.lists as Record<string, unknown>[])
          .map((l) => `\n${asStr(l.text)}\n${toText(asStr(l.content))}`)
          .join("\n")
      : "";
    return `${toText(asStr(d.description))}${lists}\n${toText(asStr(d.additional))}`.trim();
  }

  if (provider === "ashby") {
    // Ashby returns the description inline on the board response, so the
    // handle already holds it rather than pointing at another request.
    return handle ? toText(handle) : null;
  }

  const res = await get(`${boardUrl}/${handle}`, undefined, 20_000);
  if (!res?.ok) return null;
  const d = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const ad = (d?.jobAd ?? {}) as Record<string, unknown>;
  const sections = (ad.sections ?? {}) as Record<string, Record<string, unknown>>;
  const parts = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
    .map((k) => toText(asStr(sections[k]?.text)))
    .filter(Boolean);
  return parts.length ? parts.join("\n\n") : null;
}
