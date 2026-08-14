import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { buildProfileContext } from "@/lib/profile-context";
import { rolesFromVariant, diffRoles, type Role } from "@/lib/linkedin-diff";
import { generateStructured } from "@/lib/ai";
import { candidateName } from "@/lib/candidate";

export const maxDuration = 300;

/**
 * Compares a pasted LinkedIn profile against the resume.
 *
 * The division of labour is the point. **The model only extracts**: it turns
 * freeform profile text into roles and reports what the resume says that the
 * profile does not. **It is never asked whether two things match**, because
 * that is checkable, and a model asked to compare produces a confident
 * paragraph with no way to tell whether it actually looked.
 *
 * Dates run entirely through `diffRoles`. They are the one claim a recruiter
 * can verify independently, and this project has already put a wrong tenure in
 * front of one today.
 */
const EXTRACT_TOOL = {
  name: "submit_linkedin_profile",
  description: "Extract the structured content of a LinkedIn profile that has been pasted in.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      headline: { type: "string", description: "The headline under the name, or empty string." },
      about: { type: "string", description: "The About section verbatim, or empty string." },
      roles: {
        type: "array",
        description: "Every position listed, newest first.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            employer: { type: "string" },
            start: { type: "string", description: 'As written, e.g. "Aug 2022". Empty if absent.' },
            end: { type: "string", description: 'As written, or "Present". Empty if absent.' },
          },
          required: ["title", "employer", "start", "end"],
        },
      },
      missingFromLinkedIn: {
        type: "array",
        description:
          "Specific, substantive material that the RESUME carries and the profile does not. Name the actual thing: a platform, a programme, a measure, a scope. Never generic advice like 'add more detail'. Empty array if nothing is missing.",
        items: { type: "string" },
      },
    },
    required: ["headline", "about", "roles", "missingFromLinkedIn"],
  },
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const pasted = typeof body?.text === "string" ? body.text.trim() : "";

  if (pasted.length < 80) {
    return NextResponse.json(
      { error: "Paste the profile text, or the contents of the LinkedIn data export." },
      { status: 400 }
    );
  }

  const who = await candidateName();
  const variant =
    (await prisma.resumeVariant.findFirst({ where: { isDefault: true } })) ??
    (await prisma.resumeVariant.findFirst());
  if (!variant) {
    return NextResponse.json({ error: "No resume variant to compare against." }, { status: 400 });
  }

  let message;
  try {
    message = await generateStructured<Record<string, unknown>>({
      model: body?.model,
      maxTokens: 4000,
      toolName: "submit_linkedin_profile",
      schema: EXTRACT_TOOL.input_schema as unknown as Record<string, unknown>,
      system: cachedSystem(
        await buildProfileContext(),
        `You are reading a LinkedIn profile that ${who} pasted in, and comparing it against the resume he actually sends.

THE RESUME HE SENDS:

${variant.content}

Two jobs, and only two:

1. **Extract the profile.** Every role, with the dates exactly as LinkedIn writes them. Do not correct, tidy or reconcile anything: if the profile says a date the resume disagrees with, report what the PROFILE says. Something else compares them.

2. **Say what substantive material the resume carries and the profile does not.** Be specific and name the thing - a platform, a programme, a measured outcome, a scope. "The Adobe replatform is on the resume and not in the profile" is useful. "Add more detail about achievements" is not, and you should return nothing rather than write that.

Do not comment on style, length or keywords. Do not suggest what he should write. You are reporting a difference, not giving advice.`
      ),
      user: `The pasted LinkedIn profile:\n\n${pasted.slice(0, 24000)}`,
    });
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }

  const toolUse = { input: message.data };
  if (!toolUse.input) {
    return NextResponse.json({ error: "Could not read that profile." }, { status: 502 });
  }

  const out = toolUse.input as {
    headline?: string;
    about?: string;
    roles?: Role[];
    missingFromLinkedIn?: string[];
  };

  // Shape-checked before use, per the standing rule about tool output: a field
  // returned as a string instead of an array once produced a 318,000-character
  // document of "## undefined".
  const linkedinRoles = Array.isArray(out.roles)
    ? out.roles.filter(
        (r): r is Role =>
          !!r && typeof r.title === "string" && typeof r.employer === "string" && typeof r.start === "string" && typeof r.end === "string"
      )
    : [];

  return NextResponse.json({
    // The comparison itself is code, not the model.
    findings: diffRoles(rolesFromVariant(variant.content), linkedinRoles),
    missingFromLinkedIn: Array.isArray(out.missingFromLinkedIn)
      ? out.missingFromLinkedIn.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
      : [],
    headline: typeof out.headline === "string" ? out.headline : "",
    rolesFound: linkedinRoles.length,
    comparedAgainst: variant.name,
  });
}
