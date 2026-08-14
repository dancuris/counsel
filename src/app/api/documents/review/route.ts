import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { generateStructured } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { reviewerFor } from "@/lib/reviewer";
import { orderingRule } from "@/lib/career";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * A second model checks the draft.
 *
 * This deliberately is **not** a bake-off. Asking a model which of two resumes
 * is "stronger" is a taste judgement with no ground truth, and the answer is
 * dominated by self-preference: whichever model is asked tends to pick its own
 * draft. It also would not catch anything that has actually gone wrong here.
 *
 * Every real defect these documents have shipped was specific and checkable
 * against something: a metric that is not on the verified list, LEGO missing
 * because the variant did not have it, ten bullets on a single-page resume, an
 * em-dash, an unsigned letter, a cover letter that never names what the
 * employer operates. So the reviewer is handed the job description, the base
 * resume the draft was tailored from, and the house rules, and asked for
 * **findings** rather than a verdict on quality.
 *
 * Findings are worth more than a winner for a second reason: each one carries
 * a fix written as an instruction, so it drops straight into the Refine box
 * that already exists. A review that says "version B is better" leaves Dan
 * with nothing to do; one that says "the posting names CDP ownership three
 * times and the resume never says CDP" is an action.
 */
const REVIEW_TOOL = {
  name: "submit_review",
  description: "Submit the findings from reviewing this document.",
  input_schema: {
    type: "object" as const,
    properties: {
      verdict: {
        type: "string",
        enum: ["send_it", "fix_first"],
        description:
          "send_it when nothing found would cost him the screen. fix_first when at least one blocking finding exists. Be honest: a document with no real problems must come back send_it rather than inventing something to justify the pass.",
      },
      summary: {
        type: "string",
        description:
          "One sentence on the state of the document. Plain, specific, no praise. e.g. 'Strong on the commercial lane, but never mentions the CDP ownership the posting asks for three times.'",
      },
      findings: {
        type: "array",
        description:
          "The problems, most serious first. AT MOST 6, and only things you can point at. An empty array is the correct answer for a clean document - do not pad it.",
        items: {
          type: "object",
          properties: {
            severity: {
              type: "string",
              enum: ["blocking", "worth_fixing", "minor"],
              description:
                "blocking: would plausibly cost him the screen, or states something unverifiable as fact. worth_fixing: a real improvement. minor: polish.",
            },
            kind: {
              type: "string",
              enum: ["omission", "unsupported_claim", "house_style", "length", "weak_writing"],
              description:
                "omission covers both a job description requirement the document never answers and a fact available in the base resume that was dropped.",
            },
            what: {
              type: "string",
              description:
                "The problem, in one or two sentences, QUOTING the document or the posting so it can be found. Never a general observation.",
            },
            fix: {
              type: "string",
              description:
                "A concrete instruction that would fix it, written as an instruction to whoever rewrites the document, e.g. 'Add CDP ownership to the bullets for the most recent employer, using the transaction-volume figure from the verified metrics.' It gets pasted into the refine box verbatim, so write it as a command and never reference this review.",
            },
            needsHim: {
              type: "boolean",
              description:
                "TRUE when the fix cannot be carried out from the material you were given and requires a fact only Dan can supply - almost always a number, a date, a title or an outcome that appears nowhere in the base resume, the posting or his verified metrics. FALSE when everything the fix needs is already present, including when the fix is to DELETE an unsupported claim. Deleting never needs him. Be strict: if carrying out your own instruction would require someone to make a figure up, this is TRUE.",
            },
            question: {
              type: "string",
              description:
                "When needsHim is true, the single specific question to put to Dan, e.g. 'What was the order completion rate before and after the serviceability work?' Ask for one thing, name it exactly, and never ask an open question like 'can you add more detail'. Empty string when needsHim is false.",
            },
          },
          required: ["severity", "kind", "what", "fix", "needsHim", "question"],
        },
      },
    },
    required: ["verdict", "summary", "findings"],
  },
};

type Finding = {
  severity: "blocking" | "worth_fixing" | "minor";
  kind: string;
  what: string;
  fix: string;
  /** The fix needs a fact only Dan has, so it must never be applied for him. */
  needsHim: boolean;
  question: string;
};
type Review = { verdict: string; summary: string; findings: unknown };

const SEVERITY_ORDER: Record<string, number> = { blocking: 0, worth_fixing: 1, minor: 2 };

/** Shape check before anything is rendered, per the rule in CLAUDE.md. */
function asFindings(value: unknown): Finding[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f): f is Finding => {
      if (!f || typeof f !== "object") return false;
      const r = f as Record<string, unknown>;
      return typeof r.what === "string" && typeof r.fix === "string" && Boolean(r.what.trim());
    })
    .map((f) => {
      // A finding that says it needs him but names nothing to answer cannot be
      // acted on either way, so it falls back to fixable rather than becoming
      // a dead entry in a list of questions.
      const question = typeof f.question === "string" ? f.question.trim() : "";
      return {
        severity: ["blocking", "worth_fixing", "minor"].includes(f.severity) ? f.severity : "worth_fixing",
        kind: typeof f.kind === "string" ? f.kind : "weak_writing",
        what: f.what.trim(),
        fix: f.fix.trim(),
        needsHim: f.needsHim === true && question.length > 0,
        question,
      };
    })
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 1) - (SEVERITY_ORDER[b.severity] ?? 1))
    .slice(0, 6);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const documentId = typeof body?.documentId === "string" ? body.documentId : null;
  if (!documentId) return NextResponse.json({ error: "documentId is required." }, { status: 400 });

  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      application: {
        include: {
          company: true,
          jobDescriptions: { orderBy: { pastedAt: "desc" }, take: 1 },
          evaluations: { orderBy: { generatedAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!doc) return NextResponse.json({ error: "Document not found." }, { status: 404 });

  // Review what is on screen when it differs from what is stored: Dan edits in
  // the box before saving, and reviewing the saved copy would report problems
  // he has already fixed.
  const content = typeof body?.content === "string" && body.content.trim() ? body.content : doc.content;
  if (!content.trim()) {
    return NextResponse.json({ error: "This document has no stored text to review." }, { status: 400 });
  }

  const app = doc.application;
  const jd = app.jobDescriptions[0];
  if (!jd) {
    return NextResponse.json(
      { error: "No job description on this role, so there is nothing to check the document against." },
      { status: 400 }
    );
  }

  // The base the draft was tailored from. Without it the reviewer can say a
  // requirement is unanswered but not that a fact was available and dropped,
  // which is the half Dan actually asked for.
  const [profileContext, profile, variants] = await Promise.all([
    buildProfileContext(),
    prisma.profile.findFirst({ select: { masterResume: true, contactName: true } }),
    prisma.resumeVariant.findMany({ orderBy: { name: "asc" } }),
  ]);
  const base = (variants.find((v) => v.isDefault)?.content ?? variants[0]?.content ?? profile?.masterResume ?? "").trim();

  // Read from the data rather than written into the prompt. This reviewer used
  // to be told the document was "for Dan Curis" and that "Delta Air Lines" must
  // come first, so on anybody else's instance it would report a correct resume
  // as breaking a house rule about a company they have never worked for.
  const who = profile?.contactName?.trim() || "the candidate";
  const ordering = orderingRule(base);

  const isResume = doc.type === "resume";
  const reviewer = reviewerFor(body?.model ?? doc.model);

  const system = cachedSystem(
    profileContext,
    `You are reviewing a ${isResume ? "resume" : "cover letter"} that another model drafted for ${who}, for a specific role. You did not write it. Your job is to find what is wrong with it, not to grade it.

WHAT YOU ARE LOOKING AT, and it is not the finished file. The text below is stored in a plain markup the app renders into Word and PDF, and **every presentation rule in his preferences is applied at render time, not written into this text**:

    ## SECTION                          a section heading. Rendered uppercase, navy, ruled beneath.
    ### Company | descriptor :: dates    a company block. " :: " right-aligns the tenure on the same line.
    #### Title :: dates                  a title held inside that company block.
    - **Lead phrase**, rest of bullet    a bullet. ** ** renders as bold, not as asterisks.
    anything else                        a paragraph.

So the "## " name line IS the correctly formatted centred navy name, " :: " IS a right-aligned date, and "**" IS bold. Do not report casing, centring, colour, fonts, alignment or the markup characters themselves as problems. They are not in this text because they are not supposed to be. Report only what the words say.

WHAT TO CHECK, in this order:

1. **Omissions against the posting.** Read the job description for what it actually asks for, especially anything it repeats or leads with. Every one of those that the document does not answer is a finding. Quote the posting.

2. **Omissions against his own material.** The base resume below is everything true about him that was available to the writer. If it holds a role, a system, a scale figure or an achievement that is clearly relevant to this posting and the draft dropped it, that is a finding. This is the most valuable thing you can find.

3. **Unsupported claims.** Every number and named achievement must trace to the base resume or the verified metrics in his positioning. A figure that appears nowhere in either is a blocking finding even if it sounds plausible, and especially if it sounds plausible. A company's public statistics are not his results.

4. **House style.** No em-dashes or en-dashes anywhere. Plain first person. Nothing over-eager or AI-sounding. No preachy closing line. ${ordering}

${
  isResume
    ? `5. **Length.** Two pages, which is deliberate: the earlier one-page rule was cutting verified hero material to fit. At most 16 bullets across the whole resume, around 35 words each. Per title, at most 5 - except a tenure of five years or more, which may carry up to 7, because a nine-year role and a six-month one do not deserve the same allowance. Do not report a long tenure at 6 or 7 bullets as a fault. Count them and say the number if it is over. Do NOT report a two-page resume as a fault; that is the standing preference now. What you should report instead is a bullet that earns no place: one carrying neither a verified figure nor a named system, platform, scope or organisation, and any bare fragment sitting where a bullet belongs.

6. **Earlier Experience is a compressed list** of title, employer and dates. Every line must be the same shape. One entry carrying a trailing description when the others do not is a finding.`
    : `5. **Length and shape.** Four paragraphs, roughly 250 to 320 words in total, signed off. More or fewer paragraphs is a finding.

6. **It must name what this employer actually operates**, in the posting's own words. A letter that would fit any employer fails the only test being applied to it. Generic phrases like "complex portfolio" where the posting says parks, hotels and rail are a finding.`
}

HOW TO REPORT:

- **Point at things.** Every finding quotes the document, the posting, or the base resume. "The writing could be tighter" is not a finding. "The third bullet under the most recent employer opens with 'Responsible for', which is the only passive opener in the document" is.
- **The fix is an instruction**, written to whoever rewrites the document. It gets pasted verbatim into a refine box, so never mention this review, never say "the reviewer noticed", and never address Dan.
- **Split what you can fix from what only he can answer.** This is the most important field you set, because a finding marked fixable is applied automatically by a rewriter with no further input. If your instruction could only be carried out by producing a number, a date or an outcome that is not in the material above, set needsHim and ask for it. Removing an unsupported claim never needs him; adding a measure that does not exist always does. He has said plainly that he does not have figures beyond his verified list, so asking is the honest move and inventing one is the worst possible outcome.
- **Do not invent problems.** A clean document comes back with an empty findings array and verdict send_it. Padding the list to look useful is the single worst thing you can do here, because it costs him a rewrite that makes the document worse.
- **Do not restructure.** You are not proposing a different resume. You are naming what this one is missing or getting wrong.
- No em-dashes in your own output either.`
  );

  const user = [
    `Company: ${app.company.name}`,
    `Role: ${app.roleTitle}`,
    app.evaluations[0] ? `\nHow this role was assessed:\n${app.evaluations[0].fitSummary}` : null,
    `\nJOB DESCRIPTION:\n${jd.rawText.slice(0, 12000)}`,
    base ? `\nHIS BASE RESUME, the full set of material the writer could draw on:\n${base}` : null,
    `\nTHE ${isResume ? "RESUME" : "COVER LETTER"} TO REVIEW:\n${content}`,
  ]
    .filter(Boolean)
    .join("\n");

  const ask = () =>
    generateStructured<Review>({
      model: reviewer,
      maxTokens: 4000,
      toolName: "submit_review",
      schema: REVIEW_TOOL.input_schema as unknown as Record<string, unknown>,
      system,
      user,
    });

  let structured;
  let findings: Finding[];
  try {
    structured = await ask();
    findings = asFindings(structured.data?.findings);

    // An empty result gets one second opinion before it is believed.
    //
    // "Nothing found" renders as a confident Send it, and it is the one answer
    // that stops Dan looking. It came back empty once on a cover letter that
    // three consecutive later runs each found six problems in, including a
    // sentence claiming Atlanta is home which is no longer true. A false clean
    // bill is worse here than noise, and this only costs a second call on the
    // documents that claim to be perfect.
    if (findings.length === 0) {
      const second = await ask();
      const retryFindings = asFindings(second.data?.findings);
      if (retryFindings.length > 0) {
        structured = second;
        findings = retryFindings;
      }
    }
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }

  const summary = typeof structured.data?.summary === "string" ? structured.data.summary.trim() : "";

  return NextResponse.json({
    // A verdict of send_it with blocking findings is incoherent, so the
    // findings win: they are the checkable half.
    verdict: findings.some((f) => f.severity === "blocking") ? "fix_first" : structured.data?.verdict ?? "send_it",
    summary,
    findings,
    reviewedBy: structured.model,
    writtenBy: doc.model,
  });
}
