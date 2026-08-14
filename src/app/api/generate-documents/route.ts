import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { generateStructured } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { syncDocumentToDriveQuietly } from "@/lib/google-drive";
import { cleanInlineText } from "@/lib/text";
import { employersFrom, finishedEmployers, orderingRule } from "@/lib/career";
import { coverLetterVoice, VOICE_INSTRUCTION, voiceSection } from "@/lib/cover-letter-sample";

export const maxDuration = 300;
import {
  buildContactBlock,
  buildLetterHead,
  buildLetterSignOff,
  pastTenseFinishedRoles,
  stripSelfDeprecatingOpeners,
  stripRelevanceClaims,
  stripUnevidencedOutcomes,
  enforceHouseLanguage,
} from "@/lib/contact-block";
import { protectedNames } from "@/lib/proper-nouns";
import { TENANT_ID } from "@/lib/tenant";

const DRAFT_TOOL = {
  name: "submit_documents",
  description: "Submit the drafted resume and cover letter content.",
  input_schema: {
    type: "object" as const,
    properties: {
      resumeTagline: {
        type: "string",
        description: "Positioning line under the name: three short phrases separated by ' · ', tuned to this role.",
      },
      executiveProfile: {
        type: "string",
        description: "The EXECUTIVE PROFILE paragraph, rewritten for this role. One paragraph, no heading, no bullets.",
      },
      coreExpertise: {
        type: "string",
        description:
          "The CORE EXPERTISE line: capabilities separated by ' · ', reordered so what this posting asks for comes first, and items it does not care about dropped. One line, no heading.",
      },
      roles: {
        type: "array",
        description:
          "The roles under PROFESSIONAL EXPERIENCE, in the base resume's order. Reproduce heading and dateLine EXACTLY as the base has them. Select and rephrase bullets for this role; you may drop weak ones.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            heading: {
              type: "string",
              description:
                "Employer first, e.g. 'Northwind Health | Regional insurer, Boston, MA'. When only ONE title was held at this employer, so `subroles` is empty, the TITLE MUST GO HERE between the employer and the descriptor: 'Contoso Logistics | VP, Digital Commerce | Freight operator, Chicago, IL'. Otherwise the title appears nowhere on the resume - nine years as a VP rendered as a company name and a list of bullets. These are FORMAT examples: use the employers from the base resume, never these.",
            },
            dateLine: { type: "string", description: "Full tenure at that employer, copied verbatim from the base, e.g. 'Aug 2019 to Jun 2024'." },
            subroles: {
              type: "array",
              description:
                "Titles held at this employer, most recent first, copied verbatim from the base. Empty array when the base shows a single title. NEVER split one employer into two entries in `roles` - nesting the titles here is what shows a promotion and a multi-year runway.",
              items: {
                type: "object",
                properties: {
                  title: { type: "string", description: "Copied verbatim from the base, e.g. 'Managing Director, Commercial Platforms'." },
                  dateLine: { type: "string", description: "Dates for this title, e.g. 'Jan 2023 to Jun 2024'." },
                  scope: {
                    type: "string",
                    description:
                      "The remit held under this title, as domains separated by ' · ', copied from the base resume's scope line for that title. Empty string when the base has none. This is what makes a promotion readable: the reader compares the line above with the line below and sees what was gained and what was let go, so NEVER harmonise the two into the same list and never drop a domain that is on one and not the other. Domains only - no achievements, no figures, no verbs.",
                  },
                  bullets: {
                    type: "array",
                    items: { type: "string" },
                    description:
                      "AT MOST 5 bullets, and 16 across the entire resume - it runs to two pages. Around 35 words each. Bullet text only, no leading dash. EVERY bullet opens with a lead phrase wrapped in **double asterisks**, then the measure and the method. Every bullet must carry a verified figure or a named system, platform, scope or organisation; drop one that carries neither rather than padding to the limit.",
                  },
                },
                required: ["title", "dateLine", "scope", "bullets"],
              },
            },
            scope: {
              type: "string",
              description:
                "The remit for an employer with no nested titles, as domains separated by ' · ', copied from the base resume's scope line. Empty string when the base has none or when subroles carry their own.",
            },
            bullets: {
              type: "array",
              items: { type: "string" },
              description:
                "Bullets for an employer with no nested titles. Empty when subroles are used. AT MOST 7, around 35 words each. EVERY bullet opens with a lead phrase wrapped in **double asterisks**.",
            },
          },
          required: ["heading", "dateLine", "subroles", "scope", "bullets"],
        },
      },
      letterRecipientDivision: {
        type: "string",
        description:
          "The division, business unit or team named in the posting, for the letter's address block, e.g. 'Global Marketing Services, North America'. Empty if the posting names none.",
      },
      letterRecipientLocation: {
        type: "string",
        description: "City and state of the role for the letter's address block, e.g. 'Atlanta, Georgia'. Spell the state out. Empty if unclear.",
      },
      coverLetterParagraphs: {
        type: "array",
        description:
          "The body of the cover letter, one string per paragraph, exactly four of them. No name, address, date or greeting - the app adds those. Plain prose, no headings or bullets. Roughly 250-320 words across all four.",
        // No minItems/maxItems: strict mode rejects them and both providers
        // strip them, so the count lives in the description above.
        items: { type: "string" },
      },
    },
    required: ["resumeTagline", "executiveProfile", "coreExpertise", "roles", "letterRecipientDivision", "letterRecipientLocation", "coverLetterParagraphs"],
  },
};

/** What DRAFT_TOOL returns. Shape is checked before use, never trusted. */
type DraftedDocuments = {
  resumeTagline: string;
  executiveProfile: string;
  coreExpertise: string;
  roles: unknown;
  letterRecipientDivision: string;
  letterRecipientLocation: string;
  coverLetterParagraphs: string[];
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = body?.applicationId;
  const atsSafe = Boolean(body?.atsSafe);
  if (typeof applicationId !== "string") {
    return NextResponse.json({ error: "applicationId is required." }, { status: 400 });
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: {
      company: true,
      jobDescriptions: { orderBy: { pastedAt: "desc" }, take: 1 },
      evaluations: { orderBy: { generatedAt: "desc" }, take: 1 },
    },
  });
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  const jd = application.jobDescriptions[0];
  if (!jd) {
    return NextResponse.json({ error: "Save a job description first." }, { status: 400 });
  }

  // The provider is decided by generateStructured, which is the only thing that
  // knows a "gemini-*" id has to go to Google. This route used to resolve the
  // id itself and hand it to the Anthropic client regardless, so choosing
  // Gemini for a resume sent Anthropic a model it has never heard of and the
  // request failed before a word was written.
  const requestedModel = typeof body?.model === "string" ? body.model : null;

  const profileContext = await buildProfileContext();
  // The letter's voice comes from a letter, when there is one. Before this
  // there was no base for a cover letter at all.
  const voice = await coverLetterVoice();

  const protect = await protectedNames();
  const evaluation = application.evaluations[0];

  // Without a master resume the model has no contact details or dated history
  // to work from, and previously invented "[email/phone placeholders]".
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: { masterResume: true },
  });

  // Tailoring from the wrong base produces a weak resume however good the
  // tailoring is, so the closest lane is chosen before any rewriting happens.
  const variants = await prisma.resumeVariant.findMany({ orderBy: { name: "asc" } });
  const requested = typeof body?.variantId === "string" ? variants.find((v) => v.id === body.variantId) : null;
  const chosenVariant = requested ?? variants.find((v) => v.isDefault) ?? variants[0] ?? null;
  const masterResume = (chosenVariant?.content ?? profile?.masterResume ?? "").trim();
  if (!masterResume) {
    return NextResponse.json(
      {
        error:
          "No resume to tailor. Add one under Profile so the draft has real experience and contact details to work from.",
      },
      { status: 400 }
    );
  }

  /**
   * Every employer the base lists, so the output can be checked against it.
   *
   * A whole employer block goes missing intermittently. Two identical requests
   * for the Capital One role: one returned Delta and Charter, the next
   * returned Charter alone - nine years at Delta, every hero story, simply
   * absent, and the document saved and rendered without complaint. Nothing in
   * the pipeline noticed, because a resume with one employer is structurally
   * valid.
   */
  const baseEmployers = [
    ...new Set(
      masterResume
        .split("\n")
        .filter((l) => /^###\s/.test(l))
        .map((l) => l.replace(/^###\s+/, "").replace(/\s*::.*$/, "").split("|").pop()?.trim() ?? "")
        .filter((e) => e.length > 3)
    ),
  ];

  /** Employers the base has that came back with no bullets, or not at all. */
  const missingEmployers = (roles: DraftedDocuments["roles"]): string[] => {
    const list = Array.isArray(roles) ? (roles as { heading?: string; bullets?: unknown; subroles?: { bullets?: unknown }[] }[]) : [];
    return baseEmployers.filter((employer) => {
      const block = list.find((r) => typeof r?.heading === "string" && r.heading.toLowerCase().includes(employer.toLowerCase()));
      if (!block) return true;
      const own = Array.isArray(block.bullets) ? block.bullets.length : 0;
      const subs = Array.isArray(block.subroles)
        ? block.subroles.reduce((n, x) => n + (Array.isArray(x?.bullets) ? x.bullets.length : 0), 0)
        : 0;
      return own + subs === 0;
    });
  };

  /**
   * Material that must survive selection, checked rather than requested.
   *
   * The never-drop list in standingPreferences took two roles from missing
   * several items to 14 of 16 - and then stalled. Change and transformation
   * management and the PCI and privacy proof were dropped on three roles out
   * of three, even though both are in every variant AND named in the list.
   * The model simply keeps deciding they lose. A prompt is a request; this is
   * the check.
   *
   * Unlike a missing employer this does not block - a resume light one proof
   * is still a resume, and the review catches the remainder. It just refuses
   * to accept the first answer.
   */
  const MUST_INCLUDE: [string, RegExp][] = [
    ["the email and SMS portfolio", /email and SMS|email & SMS|email\/SMS/i],
    ["change and transformation management", /change and transformation|change management/i],
    ["the PCI descoping and privacy work", /\bPCI\b|privacy/i],
    ["the serviceability work and order completion", /serviceab|order completion/i],
    ["running the platform 24x7", /24x7/i],
    ["the Bangalore globally extended team", /Bangalore/i],
    ["the Salesforce centre of excellence", /Salesforce/i],
    ["vendor ownership", /vendor/i],
  ];
  const missingMust = (data: unknown): string[] => {
    const text = JSON.stringify((data as { roles?: unknown })?.roles ?? "");
    return MUST_INCLUDE.filter(([, re]) => !re.test(text)).map(([label]) => label);
  };

  let structured;
  let retryNote = "";
  try {
    // Three, not two. The drop is frequent enough that it happened twice in a
    // row on one role, and a blocked generation still costs Dan the click.
    for (let attempt = 0; attempt < 3; attempt++) {
    structured = await generateStructured<DraftedDocuments>({
      model: requestedModel,
      // Two pages of bullets plus a cover letter. The old 8,000 was set when
      // the resume was one page.
      maxTokens: 12000,
      toolName: "submit_documents",
      schema: DRAFT_TOOL.input_schema as unknown as Record<string, unknown>,
      system: cachedSystem(profileContext, `You are drafting a tailored resume and cover letter for the candidate described below, for the specific role given. Follow the standing document preferences exactly, especially: ${orderingRule(masterResume)} No em-dashes or en-dashes anywhere, plain human voice (avoid AI-sounding or over-eager phrasing), no preachy closing lines.

TENSE. Read the career narrative for employment dates and honour them. Any role that has ended is past tense. Writing a finished role in the present tense reads as careless or misleading to a recruiter, and is the single worst error you can make here.

THE COVER LETTER. Write the body only. The app adds his name, contact details, the date and the greeting, so do not write any of those. Four paragraphs:

1. Open on the substance of the role and why it connects to what he has actually done. State it plainly in the first sentence. Do not open with meta-commentary about being direct, about how he sees the role, or about what he is going to explain. Get straight to it.
2. The strongest concrete evidence, with the verified numbers. One employer, specifics, no list of everything he has ever done.
3. The differentiator: what he brings that most candidates for this role will not. Lead with the strength. If the role has a genuine gap, it goes in ONE clause in the middle or at the end of this paragraph, stated as a fact and immediately followed by what he does bring. Never open a paragraph with the limitation, and never announce that you are about to be candid. "Where I would tell you plainly to weigh this", "Where I want to be honest is", "I should be upfront that" - all forbidden. Flagging your own weakness first is self-deprecating and it reads as a man talking himself out of the job.
4. Anything genuinely particular to this employer (location, a shared context, why this company), then a one-line close.

Voice: first person, declarative, unhurried. He is a senior executive writing to a peer, not a candidate pleading a case, and he is choosing them as much as they are choosing him. Cut every sentence that only announces what the next sentence will do. Banned openers and phrases: "I want to be direct", "I think I can add real value", "Where I want to be honest", "Where I would tell you plainly", "I should be upfront", "I'd welcome the chance to discuss the role in more detail". If you close, close on something specific.${voice ? `\n\n${VOICE_INSTRUCTION}` : ""}${
        atsSafe
          ? "\n\nUse the ATS-safe formatting note: keep the resume as plain paragraphs and simple bullet lines only, nothing fancy."
          : ""
      }`),
      user: `Company: ${application.company.name}\nRole: ${application.roleTitle}\n\nMASTER RESUME (tailor this, do not replace it):\n${masterResume}${voiceSection(voice)}\n\nJob description:\n${jd.rawText}${
            evaluation ? `\n\nPrior fit evaluation (for context, don't repeat verbatim):\n${evaluation.fitSummary}` : ""
          }${retryNote}`,
    });

      const gone = missingEmployers(structured.data?.roles as DraftedDocuments["roles"]);
      const dropped = missingMust(structured.data);
      if (gone.length === 0 && dropped.length === 0) break;

      // Everything is there except some of the required proof: ask once more,
      // naming it, then take what comes back rather than failing the whole
      // generation over a bullet.
      if (gone.length === 0) {
        if (attempt >= 1) break;
        retryNote = `\n\nYOUR LAST ATTEMPT DROPPED ${dropped.join(", ").toUpperCase()}. Every one of those is in the master resume above and on his never-drop list. Put them back. If the bullet budget is tight, MERGE two related facts into one bullet rather than cutting either - do not drop something else to make room.`;
        continue;
      }
      if (attempt === 2) {
        return NextResponse.json(
          {
            error: `The draft came back missing ${gone.join(" and ")} three times running. Nothing was saved - a resume that silently drops an employer is worse than no resume. Try again.`,
          },
          { status: 502 }
        );
      }
      retryNote = `\n\nYOUR LAST ATTEMPT LEFT OUT ${gone.join(" and ").toUpperCase()} ENTIRELY. Every employer in the master resume must appear in \`roles\` with its bullets, in the same order. Omitting one deletes years of his career from the page.`;
    }
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }
  if (!structured) {
    return NextResponse.json({ error: "No draft came back. Try again." }, { status: 502 });
  }

  const model = structured.model;
  const input = structured.data as {
    resumeTagline: string;
    executiveProfile: string;
    coreExpertise: string;
    roles: {
      heading: string;
      dateLine: string;
      subroles?: { title: string; dateLine: string; scope?: string; bullets: string[] }[];
      scope?: string;
      bullets: string[];
    }[];
    letterRecipientDivision: string;
    letterRecipientLocation: string;
    coverLetterParagraphs: string[];
  };

  const contactBlock = await buildContactBlock(
    {
      addressLabel: typeof body?.addressLabel === "string" ? body.addressLabel : null,
      emailLabel: typeof body?.emailLabel === "string" ? body.emailLabel : null,
    },
    input.resumeTagline
  );

  // The document is assembled here rather than returned whole. Letting the
  // model emit the entire resume meant it kept corrupting structure - adding
  // the agency years as a fourth role while also keeping EARLIER EXPERIENCE,
  // inventing contact blocks, dropping headings. It now supplies only the
  // parts that should change; everything else is copied from the base.
  const tailText = (() => {
    const idx = masterResume.search(/^##\s+EARLIER EXPERIENCE/im);
    if (idx === -1) {
      const edu = masterResume.search(/^##\s+EDUCATION/im);
      return edu === -1 ? "" : masterResume.slice(edu).trimEnd();
    }
    return masterResume.slice(idx).trimEnd();
  })();

  const platformsLine = masterResume.split("\n").find((l) => /^Platforms & Tools/i.test(l.trim()));

  const sections: string[] = [];
  if (contactBlock) sections.push(contactBlock);
    // The profile was exempt from both passes, which is how "improved service
  // recovery" and a cross-functional-model flourish reached the final file.
  const profileText = input.executiveProfile
    .split(/(?<=\.)\s+/)
    .map((sentence) => stripUnevidencedOutcomes(stripRelevanceClaims(sentence)))
    .join(" ")
    .trim();
  sections.push(`## EXECUTIVE PROFILE\n${profileText}`);
  sections.push(
    `## CORE EXPERTISE\n${input.coreExpertise.trim()}${platformsLine ? `\n\n${platformsLine.trim()}` : ""}`
  );

  // Employers already covered under EARLIER EXPERIENCE must not reappear as a
  // role: the model keeps offering the agency years in both places.
  const tailLower = tailText.toLowerCase();
  const coveredInTail = (heading: string) => {
    // Compare employers only. Matching on any heading token dropped a real
    // Delta role because "Director" also appears in the Earlier Experience
    // entries. Headings are "Title | Employer"; an entry with no pipe is
    // already just employers.
    const employerPart = heading.includes("|") ? heading.slice(heading.lastIndexOf("|") + 1) : heading;
    const employers = employerPart
      .split("·")
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length > 3);
    return employers.length > 0 && employers.some((n) => tailLower.includes(n));
  };

  /**
   * Every bullet carries a bolded lead phrase. The model usually does it and
   * occasionally forgets, and one unbolded bullet in a column of bolded ones
   * reads as a mistake rather than a choice. The clause boundary is the same
   * one the X-Y-Z formula uses, so the fallback lands where the model would
   * have put it. A bullet with no boundary at all is left alone rather than
   * guessed at.
   */
  const ensureBoldLead = (text: string): string => {
    if (text.includes("**")) return text;
    const m = text.match(/^(.{15,95}?)(,\s| by | and | measured by | through )/);
    if (!m) return text;
    return `**${m[1]}**${text.slice(m[1].length)}`;
  };

  const clean = (b: unknown) =>
    `- ${ensureBoldLead(stripUnevidencedOutcomes(stripRelevanceClaims(String(b))))}`;

  // The model does not know how much room is left, so the budget is enforced
  // here rather than asked for. It is two pages now: the one-page rule was
  // deleting verified hero material - the Adobe replatform, the serviceability
  // work, the email and SMS portfolio - to fit a limit the resume was
  // overrunning anyway. Capped per title first, so trimming takes from
  // whichever role is greediest rather than truncating the last one.
  // Seven, not five, because tenure is not equal. Charter is nine years and
  // carries the platform build, the replatform, the serviceability work, the
  // org build and the SAFe transformation; the Managing Director title is six
  // months. A flat per-title cap trims the deepest role hardest, which is
  // exactly backwards. TOTAL is what actually holds the length.
  const PER_ROLE = 7;
  const TOTAL = 16;
  const budget = (all: string[][]): string[][] => {
    const kept = all.map((b) => b.slice(0, PER_ROLE));
    const total = () => kept.reduce((n, b) => n + b.length, 0);
    while (total() > TOTAL) {
      const biggest = kept.reduce((best, b, i) => (b.length > kept[best].length ? i : best), 0);
      if (kept[biggest].length <= 1) break;
      kept[biggest].pop();
    }
    return kept;
  };

  const usableRoles = (Array.isArray(input.roles) ? input.roles : [])
    .filter((r) => {
      const subs = Array.isArray(r?.subroles) ? r.subroles : [];
      const own = Array.isArray(r?.bullets) ? r.bullets : [];
      return r?.heading?.trim() && (own.length > 0 || subs.some((x) => Array.isArray(x?.bullets) && x.bullets.length > 0));
    })
    .filter((r) => !coveredInTail(r.heading))
    .map((r) => ({
      role: r,
      subs: (Array.isArray(r.subroles) ? r.subroles : []).filter(
        (sub) => sub?.title?.trim() && Array.isArray(sub.bullets) && sub.bullets.length > 0
      ),
    }));

  // One budget across the whole resume, not one per employer. Budgeting inside
  // the per-role loop gave every company its own allowance of nine, so two
  // employers could spend eighteen between them - which is how a capped resume
  // still came out at eleven bullets and over a page.
  const allGroups = usableRoles.flatMap(({ role, subs }) => [
    ...subs.map((sub) => sub.bullets.map(String)),
    (role.bullets ?? []).map(String),
  ]);
  const budgeted = budget(allGroups);

  /**
   * Every employer the base lists, mapped to the titles held there.
   *
   * The base names every role it lists, so the titles are knowable without
   * asking the model for them - which matters, because the model is what
   * dropped one.
   *
   * Parsing moved to `career.ts` because the regex here only understood the
   * hand-written "### Title | Employer" shape. That is right for a variant and
   * wrong for `profile.masterResume`, which is generated and writes the
   * employer first, so the fallback path built a map keyed on descriptors
   * ("Regional insurer, Boston, MA") and repaired nothing.
   */
  const titlesByEmployer = new Map(
    employersFrom(masterResume).map((employer) => [employer.name.toLowerCase(), employer.titles])
  );

  /**
   * Puts the job title back when the model left it out.
   *
   * A role returned with no subroles renders its bullets straight under the
   * employer line, so if the title is not in that heading it appears NOWHERE:
   * nine years as VP, Digital Marketing & eCommerce came out as "Charter
   * Communications" and a list of bullets. The schema now asks for the title
   * in the heading, but asking is not a guarantee, and a resume that omits a
   * job title is not a defect worth shipping on the model's good behaviour.
   */
  /** Folds the abbreviations that make two spellings of one title differ. */
  function normaliseTitle(text: string): string {
    return text
      .toLowerCase()
      .replace(/\bvice president\b/g, "vp")
      .replace(/\bsenior\b/g, "sr")
      .replace(/\bmanaging director\b/g, "md")
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function withTitle(heading: string, hasSubs: boolean): string {
    if (hasSubs) return heading;
    const parts = heading.split("|").map((x) => x.trim());
    const employer = parts[0] ?? "";
    const known = titlesByEmployer.get(employer.toLowerCase()) ?? [];
    if (known.length === 0) return heading;
    // Compared loosely, because the model abbreviates. The base says "Vice
    // President, Digital Marketing & eCommerce" and the model wrote "VP,
    // Digital Marketing & eCommerce"; an exact substring test missed it and
    // the guard helpfully added the title a second time.
    const already = known.some((t) => normaliseTitle(heading).includes(normaliseTitle(t)));
    if (already) return heading;
    // Only one title is safe to assume; more than one and the bullets could
    // belong to either, so it is left alone rather than guessed at.
    if (known.length !== 1) return heading;
    return [employer, known[0], ...parts.slice(1)].filter(Boolean).join(" | ");
  }

  let cursor = 0;
  const roleBlocks = usableRoles.map(({ role, subs }) => {
    // The tenure rides on the employer line via " :: " so it renders
    // right-aligned rather than stranded on its own line underneath.
    const tenure = role.dateLine?.trim();
    const lines: string[] = [`### ${withTitle(role.heading.trim(), subs.length > 0)}${tenure ? ` :: ${tenure}` : ""}`];

    for (const sub of subs) {
      const bullets = budgeted[cursor++] ?? [];
      if (bullets.length === 0) continue;
      lines.push(`#### ${sub.title.trim()}${sub.dateLine?.trim() ? ` :: ${sub.dateLine.trim()}` : ""}`);
      // The remit, directly above the bullets it covers. Two titles at one
      // employer make the promotion a diff the reader performs for himself:
      // at Delta, Strategy, Budget and Capability Delivery arrive while Email
      // Deployment and Project Management go, which is the whole story of that
      // move without a sentence spent on it.
      const scope = typeof sub.scope === "string" ? cleanInlineText(sub.scope).trim() : "";
      if (scope) lines.push(`> ${scope}`);
      lines.push(...bullets.map(clean));
    }
    const own = budgeted[cursor++] ?? [];
    if (own.length) {
      // Single-title employer: the remit goes straight under the company line.
      const roleScope = typeof role.scope === "string" ? cleanInlineText(role.scope).trim() : "";
      if (roleScope) lines.push(`> ${roleScope}`);
      lines.push(...own.map(clean));
    }
    return lines.join("\n");
  });

  if (roleBlocks.length) sections.push(`## PROFESSIONAL EXPERIENCE\n${roleBlocks.join("\n\n")}`);
  if (tailText) sections.push(tailText);

  // Read off the base rather than hardcoded. The list here used to name Dan's
  // employers directly, which was stale (it carried "Deutsch", in none of the
  // variants), incomplete (it missed LEGO Systems) and wrong for anybody else.
  const FINISHED_EMPLOYERS = finishedEmployers(masterResume);
  const resumeContent = pastTenseFinishedRoles(enforceHouseLanguage(sections.join("\n\n"), protect), FINISHED_EMPLOYERS);

  // The letterhead is assembled here for the same reason the resume contact
  // block is: the model has no way to know these details and previously left
  // the letter with no header at all - it opened cold on the first paragraph.
  const letterHead = await buildLetterHead(
    {
      addressLabel: typeof body?.addressLabel === "string" ? body.addressLabel : null,
      emailLabel: typeof body?.emailLabel === "string" ? body.emailLabel : null,
    },
    {
      company: application.company.name,
      division: input.letterRecipientDivision,
      location: input.letterRecipientLocation,
      role: application.roleTitle,
    },
    typeof body?.salutation === "string" && body.salutation.trim() ? body.salutation.trim() : undefined
  );

  // Strip any greeting the model opened with, so the one in the letterhead is
  // not immediately followed by a second.
  const returned = Array.isArray(input.coverLetterParagraphs)
    ? input.coverLetterParagraphs.map((t) => (typeof t === "string" ? t.trim() : "")).filter(Boolean)
    : [];
  // Asking for four paragraphs, even as an array with minItems, still came back
  // as one 322-word block. Splitting is done here instead: a wall of text is a
  // formatting failure the reader sees immediately, and sentence boundaries are
  // something code can find perfectly well.
  const paragraphs = returned.length >= 3 ? returned : splitIntoParagraphs(returned.join(" "), 4);
  const letterBody = stripSelfDeprecatingOpeners(
    pastTenseFinishedRoles(
      enforceHouseLanguage(paragraphs.join("\n\n"), protect).replace(/^\s*(dear|to whom)[^\n]*\n+/i, ""),
      FINISHED_EMPLOYERS
    )
  );
  // The body is stripped of any sign-off the model wrote anyway, then given
  // the real one. Belt and braces: the prompt forbids it, but a letter with
  // two closes is as wrong as a letter with none.
  const bodyWithoutClose = letterBody
    .replace(/\n+\s*(sincerely|best regards|kind regards|regards|warmly|yours (?:sincerely|truly))\s*,?[\s\S]{0,60}$/i, "")
    .trimEnd();
  const signOff = await buildLetterSignOff();
  const coverLetterContent = [letterHead, bodyWithoutClose, signOff].filter(Boolean).join("\n\n");

  // A draft to look at, not a version to live with.
  //
  // The comparison flow needs a second opinion on the same role without it
  // becoming the current document: a new row is immediately the newest, which
  // would push the alternative into the Drive file Dan applies from and bury
  // the version he has been working on behind a Restore. Preview returns the
  // text and writes nothing. Keeping one saves it through the ordinary edit
  // path, so the chosen draft joins the same append-only history as everything
  // else rather than arriving by a private route.
  if (body?.preview === true) {
    return NextResponse.json({ preview: true, model, resume: resumeContent, coverLetter: coverLetterContent });
  }

  const [resumeDoc, coverLetterDoc] = await Promise.all([
    prisma.document.create({
      data: { applicationId: application.id, type: "resume", content: resumeContent, isAtsSafe: atsSafe, model },
    }),
    prisma.document.create({
      data: { applicationId: application.id, type: "cover_letter", content: coverLetterContent, isAtsSafe: atsSafe, model },
    }),
  ]);

  // Filed in Drive as soon as they exist, so applying from a phone does not
  // depend on getting back to this machine. Quiet by design: the documents are
  // already saved, and a Drive outage must not read as a failed generation.
  const [resumeLinks, coverLetterLinks] = await Promise.all([
    syncDocumentToDriveQuietly(resumeDoc.id),
    syncDocumentToDriveQuietly(coverLetterDoc.id),
  ]);

  return NextResponse.json({ resumeDoc, coverLetterDoc, drive: { resume: resumeLinks, coverLetter: coverLetterLinks } });
}


/** Splits prose into roughly even paragraphs on sentence boundaries. */
function splitIntoParagraphs(text: string, count: number): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim());
  if (sentences.length <= count) return sentences;

  const perPara = Math.ceil(sentences.length / count);
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += perPara) {
    out.push(sentences.slice(i, i + perPara).join(" "));
  }
  return out;
}
