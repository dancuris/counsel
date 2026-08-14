import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { generateStructured } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { enforceHouseLanguage } from "@/lib/contact-block";
import { protectedNames } from "@/lib/proper-nouns";

// Long documents take a while to rewrite in full, so this streams for the
// same reason the prep route does.
export const maxDuration = 300;

const REFINE_TOOL = {
  name: "submit_refined_document",
  description: "Submit the full refined document.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      content: {
        type: "string",
        description:
          'The complete refined document, using the markdown-lite contract: lines starting with "## " are section headings, "- " are bullets, blank lines separate paragraphs. Return the WHOLE document, not just the changed parts.',
      },
    },
    required: ["content"],
  },
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const documentId = body?.documentId;
  const content = body?.content;
  const instruction: string = typeof body?.instruction === "string" ? body.instruction.trim() : "";

  if (typeof documentId !== "string" || typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "documentId and content are required." }, { status: 400 });
  }

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
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const profileContext = await buildProfileContext();

  const protect = await protectedNames();
  const app = doc.application;
  const jd = app.jobDescriptions[0];
  const evaluation = app.evaluations[0];

  let result: { content?: unknown };
  try {
    const draft = await generateStructured<{ content?: unknown }>({
      model: body?.model,
      maxTokens: 8000,
      toolName: "submit_refined_document",
      schema: REFINE_TOOL.input_schema as unknown as Record<string, unknown>,
      system: cachedSystem(profileContext, `You are refining an existing job-search document (type: ${doc.type.replace(
        /_/g,
        " "
      )}) for the candidate described below.

Rules:
- Return the COMPLETE document every time, not a fragment or a diff.
- Preserve the markdown-lite structure: "## " headings, "- " bullets, blank lines between paragraphs.
- Keep the candidate's voice and keep every fact he included. Do not invent new claims, and use only the verified metrics listed in his positioning.
- **Never add a clause saying what something achieved.** This is the specific
  way this instruction gets broken, every single time, so it is called out on
  its own. Asked to add a capability, you will want to justify it with an
  outcome: "to cut cycle time", "improving time to market", "driving
  efficiency", "resulting in faster delivery". Those are inventions unless the
  exact outcome is written in the material you were given. Naming the tool, the
  system or the scope is what was asked for. Name it and stop. A real example:
  told to add his Workfront and Aha! work, a pass wrote "modernizing our
  work-management on Workfront and Aha! **to cut cycle time and get campaigns
  to market faster**" - the tools are his, the result was measured by nobody.
- **A "measured by" clause may only name a measure that appears in the source.**
  Do not attach one to a bullet that had none, and do not move one from the
  bullet it belongs to onto another.
- If an instruction cannot be carried out without inventing a number or an
  outcome, carry out the part that can be done and leave the rest alone. A
  smaller true change beats a complete invented one.
- No em-dashes or en-dashes anywhere. Plain first-person voice, nothing over-eager or AI-sounding, no preachy closing lines.
- If no specific instruction is given, tighten the prose and fix awkward wording without changing meaning or removing content.`),
      user: [
            `Company: ${app.company.name}`,
            `Role: ${app.roleTitle}`,
            instruction ? `\nWhat to change:\n${instruction}` : "\nNo specific instruction: do a general tightening pass.",
            evaluation ? `\nFit evaluation context:\n${evaluation.fitSummary}` : null,
            jd ? `\nJob description (for grounding, do not copy from it):\n${jd.rawText.slice(0, 6000)}` : null,
            `\nCurrent document:\n${content}`,
          ]
        .filter(Boolean)
        .join("\n"),
    });
    result = draft.data;
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }

  const refined = result.content;
  // Guard the same way the prep route does: never hand back something that
  // isn't a usable string, and never accept an empty rewrite over real content.
  if (typeof refined !== "string" || !refined.trim()) {
    return NextResponse.json({ error: "Claude returned an empty document. Nothing was changed." }, { status: 502 });
  }

  return NextResponse.json({ content: enforceHouseLanguage(refined, protect) });
}
