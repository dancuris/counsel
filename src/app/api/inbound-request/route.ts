import { NextRequest, NextResponse } from "next/server";
import { todayLocalISO } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { generateStructured } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";

export const maxDuration = 300;

// Turns a pasted inbound email into the records it implies: a logged
// correspondence entry, a follow-up if there's a deadline, and - when the
// sender is asking for a written deliverable - a first draft of it.
const INTAKE_TOOL = {
  name: "submit_inbound_request",
  description: "Extract what an inbound email is asking for, and draft the response document if one is requested.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      senderName: { type: "string", description: "Sender's name, or empty string if not stated." },
      senderRole: {
        type: "string",
        description: "Sender's role and company, e.g. 'Principal, Example Search'. Empty string if not stated.",
      },
      summary: { type: "string", description: "One or two sentences: what they are asking for." },
      deadline: {
        type: "string",
        description:
          "Any stated or implied deadline, as plain text (e.g. 'as soon as possible', 'by Friday'). Empty string if none.",
      },
      deadlineDate: {
        type: "string",
        description:
          "The deadline resolved to a calendar date, as YYYY-MM-DD. Resolve relative wording ('tomorrow', 'by Friday') against today's date given in the message. If they asked for a prompt reply with no specific day, use tomorrow. Empty string only if there is genuinely no deadline at all.",
      },
      wantsDocument: {
        type: "boolean",
        description:
          "True only if they are asking for a written deliverable (a document, written answers, a questionnaire response). False for a simple reply, a scheduling request, or an FYI.",
      },
      targetPages: {
        type: "number",
        description: "Requested page count if stated, otherwise 0.",
      },
      documentContent: {
        type: "string",
        description:
          'If wantsDocument is true, the FULL drafted document answering everything they asked, using the markdown-lite contract ("## " headings, "- " bullets, blank lines between paragraphs). Use one "## " heading per question they asked, in their order, phrased as a section title. If wantsDocument is false, return an empty string.',
      },
    },
    required: ["senderName", "senderRole", "summary", "deadline", "deadlineDate", "wantsDocument", "targetPages", "documentContent"],
  },
};

type IntakeInput = {
  senderName: string;
  senderRole: string;
  summary: string;
  deadline: string;
  deadlineDate: string;
  wantsDocument: boolean;
  targetPages: number;
  documentContent: string;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = body?.applicationId;
  const emailText = typeof body?.emailText === "string" ? body.emailText.trim() : "";

  if (typeof applicationId !== "string" || !emailText) {
    return NextResponse.json({ error: "applicationId and emailText are required." }, { status: 400 });
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

  const profileContext = await buildProfileContext();
  const jd = application.jobDescriptions[0];
  const evaluation = application.evaluations[0];

  let input: IntakeInput;
  try {
    const result = await generateStructured<IntakeInput>({
      model: body?.model,
      maxTokens: 8000,
      toolName: "submit_inbound_request",
      schema: INTAKE_TOOL.input_schema as unknown as Record<string, unknown>,
      system: cachedSystem(profileContext, `An email has arrived about a live job opportunity. Work out what the sender is asking for, and if they want a written deliverable, draft it in full.

Rules for any document you draft:
- Answer every question they asked, in their order, one "## " section per question.
- Write as the candidate, first person, in his own plain voice, ready to send after a read-through. No em-dashes or en-dashes. Nothing over-eager or AI-sounding. No preachy closing lines.
- Use ONLY the verified metrics listed in his positioning. Never invent or estimate any other figure, and never attribute a company's public statistics to him.
- If they ask for a page count, write to roughly 475 words per page.
- If a question rests on a factual premise you cannot verify from his background, answer the substance and do not adopt the false premise.
- Be concrete about real experience rather than generically positive. Where there is a genuine gap, address it honestly rather than dodging.`),
      user: [
            `Today is ${todayLocalISO()}.`,
            `This email is about: ${application.company.name} - ${application.roleTitle}`,
            evaluation ? `\nFit evaluation context:\n${evaluation.fitSummary}` : null,
            jd ? `\nJob description:\n${jd.rawText.slice(0, 8000)}` : null,
            `\nThe email that arrived:\n${emailText}`,
          ]
        .filter(Boolean)
        .join("\n"),
    });
    input = result.data;
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }

  const senderName = asText(input.senderName) || "Unknown sender";
  const wantsDocument = input.wantsDocument === true;
  const draft = asText(input.documentContent);

  if (wantsDocument && !draft) {
    return NextResponse.json(
      { error: "Claude flagged a document request but returned no draft. Nothing was saved, try again." },
      { status: 502 }
    );
  }

  // Log the inbound email itself so the thread is preserved, not just the reply.
  const correspondence = await prisma.correspondence.create({
    data: {
      applicationId: application.id,
      type: "general",
      recipientName: senderName,
      recipientRole: asText(input.senderRole) || null,
      content: `RECEIVED from ${senderName}${asText(input.senderRole) ? ` (${asText(input.senderRole)})` : ""}\n\n${emailText}`,
      status: "sent",
      direction: "inbound",
      sentAt: new Date(),
    },
  });

  const document = wantsDocument
    ? await prisma.document.create({
        data: {
          applicationId: application.id,
          type: "recruiter_response",
          content: draft,
          isAtsSafe: false,
        },
      })
    : null;

  const parsedDue = /^\d{4}-\d{2}-\d{2}$/.test(asText(input.deadlineDate))
    ? new Date(`${asText(input.deadlineDate)}T12:00:00Z`)
    : null;

  const followUp = await prisma.followUp.create({
    data: {
      applicationId: application.id,
      dueDate: parsedDue,
      note: `Reply to ${senderName}${asText(input.deadline) ? ` (${asText(input.deadline)})` : ""}: ${
        asText(input.summary) || "inbound request"
      }`,
    },
  });

  return NextResponse.json({
    summary: asText(input.summary),
    deadline: asText(input.deadline),
    wantsDocument,
    targetPages: typeof input.targetPages === "number" ? input.targetPages : 0,
    correspondenceId: correspondence.id,
    documentId: document?.id ?? null,
    followUpId: followUp.id,
  });
}
