import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { generateText } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { stripToolCallLeak } from "@/lib/text";
import { enforceHouseLanguage } from "@/lib/contact-block";
import { protectedNames } from "@/lib/proper-nouns";
import { candidateName } from "@/lib/candidate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Answering a supplemental question on an employer's application form.
 *
 * These are the boxes a portal adds beyond the resume - "in a brief statement,
 * explain why you are an ideal fit for our company" - and the output is text
 * Dan pastes into their form, so it is written as his answer rather than as
 * advice about what to write.
 *
 * Grounded in the same three things the cover letter uses: the profile, this
 * role's job description, and the evaluation. Without the job description it
 * would produce a generic paragraph, which is exactly what these forms are
 * screening out.
 */
/** Stored as a JSON string; never trusted to be an array, per the shape rule. */
function asList(raw: unknown): string[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const protect = await protectedNames();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  // These boxes are short and the model runs long. 150 asked for produced 174.
  const limit = Number.isFinite(body?.words) ? Math.min(400, Math.max(40, Number(body.words))) : 150;
  if (!question) return NextResponse.json({ error: "What did they ask?" }, { status: 400 });

  const application = await prisma.jobApplication.findFirst({
    where: { id, deletedAt: null },
    include: {
      company: true,
      jobDescriptions: { orderBy: { pastedAt: "desc" }, take: 1 },
      evaluations: { orderBy: { generatedAt: "desc" }, take: 1 },
      // What he has already said to this employer, so two answers on one form
      // do not repeat each other.
      applicationAnswers: { orderBy: { createdAt: "desc" }, take: 5 },
    },
  });
  if (!application) return NextResponse.json({ error: "Role not found." }, { status: 404 });

  const jd = application.jobDescriptions[0]?.rawText ?? "";
  const evaluation = application.evaluations[0];

  const context = [
    `Employer: ${application.company.name}`,
    `Role: ${application.roleTitle}`,
    evaluation ? `Fit verdict: ${evaluation.recommendation}. ${evaluation.fitSummary ?? ""}` : "",
    // strengths and gaps are stored as JSON strings, not arrays.
    asList(evaluation?.strengths).length ? `Strengths against this role: ${asList(evaluation?.strengths).join("; ")}` : "",
    asList(evaluation?.gaps).length ? `Known gaps: ${asList(evaluation?.gaps).join("; ")}` : "",
    jd ? `THE JOB DESCRIPTION:\n${jd.slice(0, 6000)}` : "No job description on file.",
    application.applicationAnswers.length
      ? `ALREADY ANSWERED ON THIS FORM, do not repeat these:\n${application.applicationAnswers
          .map((a) => `Q: ${a.question}\nA: ${a.answer}`)
          .join("\n\n")}`
      : "",
    `THE QUESTION THEY ASKED:\n${question}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const who = await candidateName();
  const system = cachedSystem(
    await buildProfileContext(),
    `You are writing ${who}'s answer to a question on a job application form. They will paste what you produce straight into the employer's box, so write it as him, in first person, finished. Do not describe what he should say, say it.

Rules:
- ${limit} words is the ceiling, not the target. Come in under it. A short, dense answer beats a complete one, and these boxes are often read in seconds.
- Concrete and specific to THIS employer and THIS role. Name the thing about them that matters. A paragraph that would fit any company is what the question exists to filter out.
- Use only the verified metrics from the profile. Never invent a number, a client, or a result.
- No em-dashes or en-dashes. Plain first-person voice, nothing over-eager, no preachy closing line.
- Do not open with "I am writing to" or "As a seasoned". Start with the substance.
- **Do not volunteer a gap.** The cover letter names one deliberately, because a
  letter is a considered document and candour reads as confidence there. A
  screening box is not that: they asked why he fits, and answering with what he
  lacks hands them a reason to filter him. Only address a weakness if the
  question actually asks about one.
- **Name what this employer actually operates, in the first sentence or two,
  using words taken from the job description.** Not "your organization" or "a
  complex portfolio" - the actual thing: the parks, the hotels, the rail, the
  brands, whatever the description says. "Why are you a fit for our company" is
  testing whether he knows who they are, and an answer that would fit any
  employer fails the only test being applied. The job description is above; if
  it genuinely says nothing about what they do, say so in your answer rather
  than inventing it.
- No headings, no bullets unless the question explicitly asks for a list. It is going into a plain text box.
- Return the answer only. No preamble, no "here is a draft", no commentary.`
  );

  try {
    // Through the router: this is employer-facing text and it should not stop
    // being available because one provider's balance hit zero.
    const response = await generateText({ system, user: context, maxTokens: 1500 });
    const raw = response.text.trim();
    const answer = stripToolCallLeak(raw) ?? "";
    if (!answer) return NextResponse.json({ error: "Nothing came back. Try again." }, { status: 502 });

    // The one outward-facing route that did not enforce the house rules.
    // This text is pasted straight into an employer's portal, which makes it
    // exactly as public as a cover letter, and every other route producing
    // employer-facing prose has run this from the start. Nothing bad had gone
    // out - there were no saved answers yet - so this closes it before the
    // first one rather than after.
    return NextResponse.json({ answer: enforceHouseLanguage(answer, protect) });
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }
}
