import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { generateStructured } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { CORRESPONDENCE_TYPES } from "@/lib/constants";
import { enforceHouseLanguage } from "@/lib/contact-block";
import { stripDraftNotes, cleanInlineText } from "@/lib/text";
import { protectedNames } from "@/lib/proper-nouns";

export const maxDuration = 120;

const DRAFT_TOOL = {
  name: "submit_correspondence",
  description: "Submit the drafted email correspondence.",
  input_schema: {
    type: "object" as const,
    properties: {
      content: {
        type: "string",
        description: "The full email text, ready to send.",
      },
    },
    required: ["content"],
  },
};

const TYPE_INSTRUCTIONS: Record<string, string> = {
  thank_you:
    "Write a short, genuine post-interview thank-you note. Reference specifics from the interview notes if given.",
  follow_up:
    "Write a brief, polite check-in email following up on a prior conversation or application where there's been no response in a while. Reference the role and any prior contact, and ask for a status update without being pushy.",
  // Telling somebody he knows that he is applying to a specific posting.
  //
  // Its own type because the register is unlike every other one here, and a
  // shared prompt kept producing a cover letter or a favour request. The case
  // that prompted it: Dan gave a CMO a reference for a friend, she
  // introduced him to someone on her team, and a posting at another employer then
  // appeared. Telling her is courtesy. Asking her for anything, days after she
  // did him a favour, converts a relationship into a transaction.
  role_outreach: [
    "THIS NOTE IS: reaching out to somebody Dan has met, about a specific posting, hoping they will help.",
    "**It has an ask, and the ask is the point.** He would like them to refer him, or pass his name to whoever owns the role. Say so plainly and once, without apologising for it and without grovelling. A note that carefully avoids asking wastes the relationship and reads as coy.",
    "**Open by referring to the conversation they had**, warmly and with something specific from it. This is the part he cares about most: the note should feel like it comes from the conversation, not from a job board.",
    "**Calibrate to how well they actually know each other.** Usually this is one conversation, not a friendship. Never write anything that presumes closeness: no 'I wanted you to hear it from me', no 'as you know', no in-jokes, no familiarity that has not been earned.",
    "Name the exact job title and company.",
    "**Never mention a favour Dan did for them**, in either direction. Warmth about the conversation is right; invoking a debt is not, and it would undo the goodwill that makes the ask possible.",
    "Do not restate his resume. One sentence at most on why the role fits.",
    "Six sentences at the outside. Warm, direct, and finished.",
  ].join("\n"),
  general:
    "Write a general piece of correspondence for this job search relationship. Infer the most useful and appropriate message from the context given (company, role, recipient, and any interview notes).",
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = body?.applicationId;
  const contactId: string | undefined = body?.contactId || undefined;
  const interviewNoteId: string | undefined = body?.interviewNoteId || undefined;
  const context: string = typeof body?.context === "string" ? body.context.trim() : "";
  const type: string = CORRESPONDENCE_TYPES.includes(body?.type) ? body.type : "thank_you";
  let recipientName: string | undefined = body?.recipientName || undefined;
  let recipientRole: string | undefined = body?.recipientRole || undefined;

  if (typeof applicationId !== "string") {
    return NextResponse.json({ error: "applicationId is required." }, { status: 400 });
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: {
      company: true,
      interviewNotes: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  if (contactId) {
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (contact) {
      recipientName = recipientName || contact.name;
      recipientRole = recipientRole || contact.role || undefined;
    }
  }
  if (!recipientName) {
    return NextResponse.json({ error: "recipientName is required." }, { status: 400 });
  }

  const interviewNote = interviewNoteId
    ? application.interviewNotes.find((n) => n.id === interviewNoteId)
    : application.interviewNotes[0];

  const profileContext = await buildProfileContext();

  const protect = await protectedNames();

  let draftResult: { content?: unknown };
  try {
    // Through the router so the fallback applies.
    const result = await generateStructured<{ content?: unknown }>({
      model: body?.model,
      maxTokens: 500,
      toolName: "submit_correspondence",
      schema: DRAFT_TOOL.input_schema as unknown as Record<string, unknown>,
      system: cachedSystem(profileContext, `You are drafting a piece of email correspondence for the candidate described below, related to their job search. ${TYPE_INSTRUCTIONS[type]} Follow their standing preferences exactly, especially: no em-dashes or en-dashes, brief and informal tone for outreach/networking messages, plain human voice, no AI-sounding or gratitude-stacking phrasing.

If you have nothing specific to work from - no interview notes and nothing he told you about the conversation - do not invent a detail to sound personal. Write the short, honest version and say in one line that he should add the specifics. A generic thank-you that pretends to remember the conversation is worse than a brief one.`),
      user: `Company: ${application.company.name}\nRole: ${application.roleTitle}\nRecipient: ${recipientName}${recipientRole ? ` (${recipientRole})` : ""}${
            context ? `\n\nWhat he wants this to reference (his own words, use it):\n${context}` : ""
          }${
            interviewNote
              ? `\n\nMost recent interview round: ${interviewNote.roundName}\nInterview notes: ${interviewNote.notes}`
              : "\n\n(No specific interview round notes on file.)"
          }`,
    });
    draftResult = result.data;
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }

  const raw = typeof draftResult.content === "string" ? draftResult.content : "";
  if (!raw) {
    return NextResponse.json({ error: "Model did not return a drafted message." }, { status: 502 });
  }

  // A leading "Subject: ..." line, lifted into the subject field rather than
  // left sitting at the top of the body. The contact-draft route already did
  // this; the two paths simply disagreed, so a note drafted here arrived with
  // its subject inside the message and the field empty.
  const leading = raw.match(/^\s*subject:\s*([^\n\r]{1,120})[\r\n]+/i);
  const input = { content: leading ? raw.slice(leading[0].length).trimStart() : raw };
  const drafted = leading ? cleanInlineText(leading[1]) : "";

  const correspondence = await prisma.correspondence.create({
    data: {
      applicationId,
      contactId,
      interviewNoteId: interviewNote?.id,
      type,
      recipientName,
      recipientRole,
      content: stripDraftNotes(enforceHouseLanguage(input.content, protect)),
      subject: drafted || null,
      status: "draft",
    },
  });

  return NextResponse.json({ correspondence });
}
