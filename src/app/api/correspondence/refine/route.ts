import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { generateStructured } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { enforceHouseLanguage } from "@/lib/contact-block";
import { stripDraftNotes } from "@/lib/text";
import { protectedNames } from "@/lib/proper-nouns";

export const maxDuration = 300;

const REFINE_TOOL = {
  name: "submit_refined_correspondence",
  description: "Submit the refined correspondence.",
  input_schema: {
    type: "object" as const,
    properties: {
      content: { type: "string", description: "The refined message text." },
    },
    required: ["content"],
  },
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = body?.applicationId;
  const content = body?.content;
  const recipientName = body?.recipientName;
  const recipientRole: string | undefined = body?.recipientRole || undefined;
  const type: string = body?.type || "general";

  if (typeof applicationId !== "string" || typeof content !== "string" || !content.trim()) {
    return NextResponse.json({ error: "applicationId and content are required." }, { status: 400 });
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { company: true },
  });
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const profileContext = await buildProfileContext();

  const protect = await protectedNames();

  let refined: { content?: unknown };
  try {
    const result = await generateStructured<{ content?: unknown }>({
      model: body?.model,
      maxTokens: 500,
      toolName: "submit_refined_correspondence",
      schema: REFINE_TOOL.input_schema as unknown as Record<string, unknown>,
      system: cachedSystem(profileContext, `The candidate has written their own draft of a piece of job-search correspondence (type: ${type}). Refine it: tighten the phrasing and fix any awkward wording, but keep their voice, keep every fact and detail they included, and don't invent new claims. Apply their standing preferences exactly, especially: no em-dashes or en-dashes, brief and informal tone for outreach/networking messages, plain human voice, no AI-sounding or gratitude-stacking phrasing. If the draft is already solid, make only light touch-ups.`),
      user: `Company: ${application.company.name}\nRole: ${application.roleTitle}${
        recipientName ? `\nRecipient: ${recipientName}${recipientRole ? ` (${recipientRole})` : ""}` : ""
      }\n\nDraft to refine:\n${content}`,
    });
    refined = result.data;
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }

  if (typeof refined.content !== "string" || !refined.content.trim()) {
    return NextResponse.json({ error: "Model did not return refined content." }, { status: 502 });
  }
  const toolUse = { input: refined as { content: string } };
  const input = toolUse.input as { content: string };

  return NextResponse.json({ content: stripDraftNotes(enforceHouseLanguage(input.content, protect)) });
}
