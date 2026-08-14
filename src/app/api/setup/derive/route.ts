import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateStructured } from "@/lib/ai";
import { getClaudeErrorMessage } from "@/lib/anthropic";
import { TENANT_ID } from "@/lib/tenant";
import { parseAnswers, SEARCH_QUESTIONS } from "@/lib/onboarding";
import { employersFrom } from "@/lib/career";
import { recordFailure } from "@/lib/failures";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Turns eight short answers and a pasted resume into a working profile.
 *
 * This is the step that makes setup finishable. The Profile fields this writes
 * ground every model call in the app and run to tens of thousands of
 * characters; asked for directly they would never be filled in, and a
 * half-filled version produces confident wrong verdicts rather than an error.
 *
 * ## The one thing this must not do
 *
 * Invent career facts. Everything it writes is read back later as though it
 * were true, and a fabricated employer or figure would be laundered through
 * the profile into a resume and out to an employer. So:
 *
 * - The prose fields are written **only** from the resume and the answers.
 * - `formattedResume` is a REFORMAT, not a rewrite. Same employers, same
 *   dates, same achievements, in the markup the renderers understand.
 * - Every employer the model returns is checked against the text it was given
 *   (`employersFrom`), and the route **fails rather than saving** when one
 *   appears that was not in the source. That is the same trade
 *   `missingEmployers` makes in generate-documents: a failed setup costs a
 *   retry, a fabricated career costs an application.
 */

const DERIVE_TOOL = {
  name: "submit_profile",
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      positioning: {
        type: "string",
        description:
          "How to describe this person in two or three short paragraphs: what they do, the level they operate at, and the lanes they are credible in. If their answers describe two different kinds of role, say so explicitly and give both equal weight rather than filing them under one. End with a VERIFIED METRICS line listing every figure that appears in their resume, and the instruction that no other figure may ever be used and that a figure keeps the noun it is attached to.",
      },
      careerNarrative: {
        type: "string",
        description:
          "The story of their career: each move, why it happened, what they were brought in to do, what they are proudest of. Written from the resume and from their own account. Several paragraphs. This is what a cover letter draws on, so it carries the reasons, not the dates.",
      },
      personalLogistics: {
        type: "string",
        description:
          "Where they are, what they will travel or relocate for and by when, remote or on site, compensation floor if given, and anything they asked never to be suggested. Short and factual.",
      },
      evaluationFramework: {
        type: "string",
        description:
          "The rule for judging whether a role is worth pursuing. State what counts as a strong fit, what is a stretch worth taking, and what is an automatic pass. Auto-pass must come from their own stated deal-breakers, never invented. Write it so a reader could apply it to a posting and reach the same verdict twice.",
      },
      standingPreferences: {
        type: "string",
        description:
          "House style for anything written for them: voice, what to avoid, resume length and bullet rules. Always include: no em-dashes or en-dashes anywhere, US English spelling, plain first person, no over-eager or AI-sounding phrasing, no preachy closing lines. Add whatever they asked for themselves.",
      },
      resumeTagline: {
        type: "string",
        description:
          "The line under their name on a resume: three short phrases separated by ' · '. Drawn from what they actually do, not aspiration.",
      },
      formattedResume: {
        type: "string",
        description:
          "Their resume, REFORMATTED into the app's markup and not rewritten. Keep every employer, title, date and achievement exactly as given; you may tidy wording and drop nothing. Sections in order, each introduced by '## ': EXECUTIVE PROFILE, CORE EXPERTISE, PROFESSIONAL EXPERIENCE, EARLIER EXPERIENCE (only if the source has older roles), EDUCATION. Under PROFESSIONAL EXPERIENCE each role is '### Job Title | Employer' on its own line, then a line of 'Mon YYYY to Mon YYYY · City, ST', then bullets starting '- '. Under EARLIER EXPERIENCE use one line each: '- Title, Employer (2010 to 2012)'. Never write the person's name, address, phone or email anywhere: the app adds the letterhead, and a model asked for one writes placeholders.",
      },
    },
    required: [
      "positioning",
      "careerNarrative",
      "personalLogistics",
      "evaluationFramework",
      "standingPreferences",
      "resumeTagline",
      "formattedResume",
    ],
  },
};

type Derived = {
  positioning: string;
  careerNarrative: string;
  personalLogistics: string;
  evaluationFramework: string;
  standingPreferences: string;
  resumeTagline: string;
  formattedResume: string;
};

/**
 * Employers in the output that are not in the input.
 *
 * Normalized loosely on purpose: the reformat is allowed to write "Delta Air
 * Lines" where the paste said "Delta Air Lines, Inc.", and flagging that would
 * make the check cry wolf. What it catches is a name that is not there at all.
 */
function inventedEmployers(formatted: string, source: string): string[] {
  const haystack = source.toLowerCase().replace(/[^a-z0-9]/g, "");
  return employersFrom(formatted)
    .map((e) => e.name)
    .filter((name) => {
      const needle = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      return needle.length > 2 && !haystack.includes(needle);
    });
}

export async function POST() {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: { masterResume: true, setupAnswers: true, contactName: true },
  });

  const source = (profile?.masterResume ?? "").trim();
  if (!source) {
    return NextResponse.json(
      { error: "There is no resume to work from yet. Paste one first and this will have something to read." },
      { status: 400 }
    );
  }

  const answers = parseAnswers(profile?.setupAnswers);
  const answerText = SEARCH_QUESTIONS.map((q) => {
    const given = answers[q.name]?.trim();
    return given ? `${q.label}\n${given}` : null;
  })
    .filter(Boolean)
    .join("\n\n");

  let result;
  try {
    result = await generateStructured<Derived>({
      maxTokens: 16000,
      toolName: DERIVE_TOOL.name,
      schema: DERIVE_TOOL.input_schema as unknown as Record<string, unknown>,
      system: `You are setting up a job-search assistant for ${profile?.contactName?.trim() || "someone"}, from their resume and their answers to a few questions. What you write here is stored and used to ground every judgement the app later makes about a role, and every document it writes for them.

Two rules, and the first one matters more than anything else you do.

INVENT NOTHING. Every employer, title, date, figure, system and achievement must come from the resume or the answers below. If something is not there, it does not go in. Do not estimate a number, do not round one up, do not attribute a company's public results to this person, and do not describe an outcome that was not stated. Where the material is thin, write less.

WRITE IT FOR A READER WHO WILL ACT ON IT. These fields are read back verbatim by other models deciding whether to recommend a role and drafting letters. Be concrete and decisive. "Experienced leader with a track record of success" is worthless; the level, the domains, the size of what they ran and the rule for saying no are what make the app useful.

Write in US English. No em-dashes or en-dashes anywhere.`,
      user: `THEIR RESUME, as pasted:\n${source}\n\n${answerText ? `THEIR ANSWERS:\n${answerText}` : "They have not answered the questions yet, so work from the resume alone and keep the framework fields short and general."}`,
    });
  } catch (error) {
    await recordFailure("setup.derive", error, {});
    return NextResponse.json({ error: getClaudeErrorMessage(error) }, { status: 502 });
  }

  const data = result.data;
  if (!data?.formattedResume?.trim() || !data?.positioning?.trim()) {
    return NextResponse.json({ error: "The model returned an incomplete profile. Try again." }, { status: 502 });
  }

  // The guard. A resume that gained an employer is not a formatting pass, and
  // nothing is saved when it happens.
  const invented = inventedEmployers(data.formattedResume, source);
  if (invented.length > 0) {
    await recordFailure("setup.derive", new Error("Invented employers"), { invented });
    return NextResponse.json(
      {
        error: `The formatted resume named an employer that is not in what you pasted: ${invented.join(", ")}. Nothing was saved. Try again, and if it keeps happening paste the resume as plain text.`,
      },
      { status: 502 }
    );
  }

  const ruledOut = (answers.ruledOut ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  await prisma.$transaction(async (tx) => {
    await tx.profile.update({
      where: { id: TENANT_ID },
      data: {
        positioning: data.positioning.trim(),
        careerNarrative: data.careerNarrative.trim(),
        personalLogistics: data.personalLogistics.trim(),
        evaluationFramework: data.evaluationFramework.trim(),
        standingPreferences: data.standingPreferences.trim(),
        resumeTagline: data.resumeTagline.trim() || null,
        ruledOutCompanies: JSON.stringify(ruledOut),
      },
    });

    // The variant is what generation actually tailors from; `masterResume` is
    // the fallback and stays as the pasted original, which is the honest copy
    // of what they gave us.
    const existing = await tx.resumeVariant.findFirst({ where: { name: "Default" } });
    if (existing) {
      await tx.resumeVariant.update({
        where: { id: existing.id },
        data: { content: data.formattedResume.trim(), isDefault: true },
      });
    } else {
      await tx.resumeVariant.create({
        data: {
          name: "Default",
          description: "Built from the resume pasted during setup. Edit it, or add one per lane you are pursuing.",
          content: data.formattedResume.trim(),
          isDefault: true,
        },
      });
    }
  });

  return NextResponse.json({ ok: true, model: result.model });
}
