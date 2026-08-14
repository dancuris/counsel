import { NextRequest, NextResponse } from "next/server";
import { syncInterviewNotesToDriveQuietly } from "@/lib/drive-records";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { cleanInlineText } from "@/lib/text";
import { getAnthropicClient, resolveModel, getClaudeErrorMessage } from "@/lib/anthropic";
import { JOB_STATUSES, CORRESPONDENCE_TYPES } from "@/lib/constants";
import { advanceOnMeeting } from "@/lib/meeting-status";
import { candidateName } from "@/lib/candidate";

export const maxDuration = 300;

/**
 * The conversational assistant on the application page.
 *
 * Two rules define its shape, and both come from a real failure. The box this
 * replaced was one-shot and record-only: asked to "draft an email to Brian and
 * attach my resume", it logged a correspondence row marked `sent` and closed
 * the matching follow-up. Nothing had been sent. The tracker said the task was
 * handled while the recruiter was still waiting.
 *
 * So:
 * 1. Reads happen freely; every write is staged and applied only after an
 *    explicit confirmation in the UI.
 * 2. Nothing here can dispatch a message. Drafting produces a draft. Sending
 *    stays behind the Send button in the correspondence editor, which is the
 *    only code path that may set status "sent", and only with a real Gmail id.
 */

const WRITE_KINDS = [
  "draft_email",
  "log_past_message",
  "add_interview_note",
  "add_contact",
  "add_follow_up",
  "complete_follow_up",
  "update_status",
  "append_note",
  "set_salary",
] as const;
type WriteKind = (typeof WRITE_KINDS)[number];

type StagedAction = {
  kind: WriteKind;
  summary: string;
  subject: string;
  body: string;
  personName: string;
  personRole: string;
  personEmail: string;
  attachDocumentIds: string[];
  date: string;
  status: string;
  correspondenceType: string;
};

const asText = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const asIdList = (v: unknown) =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
const asDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00Z`) : null);

const READ_TOOLS = [
  {
    name: "list_documents",
    description:
      "List the generated resumes and cover letters for this application, newest first. Use this to find the document id to attach to an email.",
    strict: true,
    input_schema: { type: "object" as const, additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "read_document",
    description: "Read the text of one document, to quote or summarise it.",
    strict: true,
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: { documentId: { type: "string" } },
      required: ["documentId"],
    },
  },
  {
    name: "get_application",
    description:
      "The application's status, notes, salary, open follow-ups, contacts, latest evaluation, and recent correspondence.",
    strict: true,
    input_schema: { type: "object" as const, additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "find_person",
    description:
      "Look up a person by name across saved contacts and the connected mailbox, to find their email address. Use this before asking the user for an address.",
    strict: true,
    input_schema: {
      type: "object" as const,
      additionalProperties: false,
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  },
];

const STAGE_TOOL = {
  name: "stage_action",
  description:
    "Stage one change for the user to confirm. Nothing is written until they press Apply. Call this once per change. To draft an email, use kind 'draft_email' - this creates a draft only; you cannot send.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      kind: { type: "string", enum: [...WRITE_KINDS] },
      summary: { type: "string", description: "One short line describing this change, shown next to a checkbox." },
      subject: { type: "string", description: "Email subject. Only for draft_email. Empty otherwise." },
      body: {
        type: "string",
        description:
          "The main text: the email body, the note, the follow-up wording, or the message content. Empty if not applicable.",
      },
      personName: { type: "string", description: "Person involved. Empty if none." },
      personRole: { type: "string", description: "Their role or company. Empty if unknown." },
      personEmail: { type: "string", description: "Their email. Empty if unknown." },
      attachDocumentIds: {
        type: "array",
        items: { type: "string" },
        description: "Document ids to attach, from list_documents. Only for draft_email.",
      },
      date: { type: "string", description: "YYYY-MM-DD if stated or clearly implied, otherwise empty." },
      status: { type: "string", enum: ["", ...JOB_STATUSES], description: "Only for update_status." },
      correspondenceType: { type: "string", enum: ["", ...CORRESPONDENCE_TYPES], description: "Only for message kinds." },
    },
    required: [
      "kind", "summary", "subject", "body", "personName", "personRole",
      "personEmail", "attachDocumentIds", "date", "status", "correspondenceType",
    ],
  },
};

/**
 * The one route that still builds its own Anthropic client, deliberately.
 *
 * Everything else goes through `generateStructured`/`generateText`, which gives
 * it the Gemini fallback when a balance runs out. This cannot: it is a genuine
 * agentic loop - the model calls a read tool, the route executes it, the result
 * goes back, and it decides what to do next over several turns. The one-shot
 * helpers have no shape for that, and porting the loop to a second provider's
 * function-calling protocol is a real piece of work rather than a wrapper.
 *
 * So it degrades honestly instead: when Anthropic is unavailable the error says
 * that the assistant specifically needs it, rather than reporting a generic
 * failure the user cannot act on. Ask, drafting, evaluation, documents and
 * interview prep all keep working on Gemini in the meantime.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = asText(body?.applicationId);
  if (!applicationId) return NextResponse.json({ error: "applicationId is required." }, { status: 400 });

  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: {
      company: true,
      contacts: true,
      followUps: { where: { completed: false } },
      evaluations: { orderBy: { generatedAt: "desc" }, take: 1 },
      correspondence: { orderBy: { createdAt: "desc" }, take: 5 },
      documents: { orderBy: { generatedAt: "desc" } },
    },
  });
  if (!application || application.deletedAt) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  if (body?.apply) return applyActions(applicationId, body.actions, application.notes);

  const history: Anthropic.MessageParam[] = Array.isArray(body?.messages)
    ? body.messages
        .filter((m: unknown) => {
          const msg = m as { role?: unknown; content?: unknown };
          return (msg.role === "user" || msg.role === "assistant") && asText(msg.content).length > 0;
        })
        .map((m: { role: "user" | "assistant"; content: string }) => ({ role: m.role, content: m.content }))
    : [];
  if (history.length === 0) return NextResponse.json({ error: "Say something first." }, { status: 400 });

  let anthropic;
  let model: string;
  try {
    anthropic = await getAnthropicClient();
    model = await resolveModel(body?.model);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  // Only the newest document of each type is current; the rest are history.
  const currentResume = application.documents.find((d) => d.type === "resume");
  const currentCover = application.documents.find((d) => d.type === "cover_letter");

  const runRead = async (name: string, input: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case "list_documents":
        if (application.documents.length === 0) return "No documents generated yet for this application.";
        return application.documents
          .map((d) => {
            const current = d.id === currentResume?.id || d.id === currentCover?.id;
            return `id=${d.id} | ${d.type} | ${d.generatedAt.toISOString().slice(0, 10)} | ${
              current ? "CURRENT" : "older version"
            } | ${d.content.split(/\s+/).length} words`;
          })
          .join("\n");
      case "read_document": {
        const doc = application.documents.find((d) => d.id === asText(input.documentId));
        return doc ? doc.content.slice(0, 6000) : "No document with that id on this application.";
      }
      case "get_application":
        return [
          `Company: ${application.company.name}`,
          `Role: ${application.roleTitle}`,
          `Status: ${application.status}`,
          `Salary: ${application.salaryRange ?? "not recorded"}`,
          `Notes: ${application.notes ?? "none"}`,
          `Open follow-ups: ${application.followUps.map((f) => f.note).join(" | ") || "none"}`,
          `Contacts: ${
            application.contacts.map((c) => `${c.name}${c.email ? ` <${c.email}>` : ""}`).join(", ") || "none"
          }`,
          `Latest evaluation: ${application.evaluations[0]?.recommendation ?? "none"} - ${
            application.evaluations[0]?.fitSummary?.slice(0, 500) ?? ""
          }`,
          `Recent correspondence: ${
            application.correspondence
              .map((c) => `${c.status} to ${c.recipientName}: ${c.content.slice(0, 80)}`)
              .join(" | ") || "none"
          }`,
        ].join("\n");
      case "find_person": {
        const needle = asText(input.name).toLowerCase();
        if (needle.length < 2) return "Give a name to search for.";
        const contacts = await prisma.contact.findMany({ where: { name: { contains: needle, mode: "insensitive" } } });
        const mail = await prisma.mailMessage.findMany({
          where: { OR: [{ fromName: { contains: needle, mode: "insensitive" } }, { fromEmail: { contains: needle, mode: "insensitive" } }] },
          distinct: ["fromEmail"],
          take: 5,
        });
        const lines = [
          ...contacts.map((c) => `contact: ${c.name}${c.role ? ` (${c.role})` : ""} ${c.email ?? "no email on file"}`),
          ...mail.map((m) => `mailbox: ${m.fromName ?? m.fromEmail} <${m.fromEmail}>`),
        ];
        return lines.length ? lines.join("\n") : `Nobody matching "${needle}" in contacts or the mailbox.`;
      }
      default:
        return "Unknown tool.";
    }
  };

  const who = await candidateName();
  const system = `You are helping ${who} manage one job application inside their tracker. Today is ${new Date()
    .toISOString()
    .slice(0, 10)}. He talks to you in plain language and you work out what needs doing.

Application: ${application.company.name} - ${application.roleTitle} (status: ${application.status})

How you work:
- Use the read tools freely to find things out. Look before you ask him.
- When something needs to change, call stage_action. Staged changes appear as checkboxes; nothing is written until he presses Apply. Say plainly what you have staged.
- If a request is ambiguous or you are missing something that matters (an email address, which document), ask him rather than guessing.
- Then write a short reply in plain first person. No em-dashes or en-dashes. Do not be over-eager and do not pad.

What you cannot do, and must say so rather than pretend:
- You cannot send email. draft_email creates a draft; he reviews it and presses Send himself.
- Attachments are rendered as Word .docx files at the moment he sends, so they are always the current version. That is the default and you do not need to caveat it.
- You cannot generate or edit a resume or cover letter. That is the Generate button on this page. You can read the existing ones and attach them.
- Never record something as already done when it has not happened. log_past_message is only for messages he tells you he already sent or received.`;

  const messages: Anthropic.MessageParam[] = [...history];
  const staged: StagedAction[] = [];
  let reply = "";

  try {
    // Bounded so a tool loop cannot run away against a live API key.
    for (let turn = 0; turn < 8; turn += 1) {
      const response = await anthropic.messages.create({
        model,
        max_tokens: 4000,
        system,
        tools: [...READ_TOOLS, STAGE_TOOL],
        messages,
      });

      reply = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      if (toolUses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const call of toolUses) {
        const input = (call.input ?? {}) as Record<string, unknown>;
        if (call.name === "stage_action") {
          const kind = asText(input.kind) as WriteKind;
          if (!WRITE_KINDS.includes(kind)) {
            results.push({ type: "tool_result", tool_use_id: call.id, content: "Unknown action kind." });
            continue;
          }
          staged.push({
            kind,
            summary: asText(input.summary),
            subject: asText(input.subject),
            body: asText(input.body),
            personName: asText(input.personName),
            personRole: asText(input.personRole),
            personEmail: asText(input.personEmail),
            attachDocumentIds: asIdList(input.attachDocumentIds),
            date: asText(input.date),
            status: asText(input.status),
            correspondenceType: asText(input.correspondenceType),
          });
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: "Staged for the user to confirm. Not written yet, and nothing has been sent.",
          });
          continue;
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content: await runRead(call.name, input) });
      }

      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    {
      const message = getClaudeErrorMessage(e);
      const outOfCredit = /credit balance|quota|rate limit|insufficient/i.test(message);
      return NextResponse.json(
        {
          error: outOfCredit
            ? `The per-role assistant runs a tool loop and needs Anthropic specifically, so it cannot fall back to Gemini like the rest of the app. ${message}`
            : message,
        },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({ reply, actions: staged });
}

async function applyActions(applicationId: string, raw: unknown, existingNotes: string | null) {
  const actions: StagedAction[] = Array.isArray(raw) ? raw : [];
  if (actions.length === 0) return NextResponse.json({ error: "Nothing to apply." }, { status: 400 });

  // Re-read rather than trusting the client, and re-validate every action:
  // the payload has been through the browser since it was staged.
  const followUps = await prisma.followUp.findMany({ where: { applicationId, completed: false } });
  const applied: string[] = [];
  let notes = existingNotes;

  for (const a of actions) {
    if (!WRITE_KINDS.includes(a?.kind)) continue;
    const text = asText(a.body);
    const person = asText(a.personName);

    switch (a.kind) {
      case "draft_email": {
        if (!text) break;
        const ids = asIdList(a.attachDocumentIds);
        const valid = ids.length
          ? (await prisma.document.findMany({ where: { id: { in: ids }, applicationId }, select: { id: true } })).map(
              (d) => d.id
            )
          : [];
        await prisma.correspondence.create({
          data: {
            applicationId,
            type: CORRESPONDENCE_TYPES.includes(a.correspondenceType as never) ? a.correspondenceType : "general",
            recipientName: person || "Unknown",
            recipientRole: asText(a.personRole) || null,
            recipientEmail: asText(a.personEmail) || null,
            subject: asText(a.subject) || null,
            content: text,
            // Always a draft. Only the send route may set "sent", and only
            // once Gmail has returned a message id.
            status: "draft",
            attachments: valid.length ? JSON.stringify(valid.map((id) => ({ documentId: id, format: "docx" }))) : null,
          },
        });
        applied.push(`${a.summary} (draft - review and press Send)`);
        break;
      }
      case "log_past_message": {
        if (!text) break;
        await prisma.correspondence.create({
          data: {
            applicationId,
            type: CORRESPONDENCE_TYPES.includes(a.correspondenceType as never) ? a.correspondenceType : "general",
            recipientName: person || "Unknown",
            recipientRole: asText(a.personRole) || null,
            recipientEmail: asText(a.personEmail) || null,
            subject: asText(a.subject) || null,
            content: text,
            status: "sent",
            sentAt: asDate(asText(a.date)) ?? new Date(),
          },
        });
        applied.push(a.summary);
        break;
      }
      case "add_interview_note": {
        if (!text) break;
        const noteDate = asDate(asText(a.date));
        await prisma.interviewNote.create({
          data: { applicationId, roundName: person || "Conversation", notes: text, date: noteDate },
        });
        await syncInterviewNotesToDriveQuietly(applicationId);
        // Dated only: an undated note is a record, not a booking.
        if (noteDate) await advanceOnMeeting(applicationId);
        applied.push(a.summary);
        break;
      }
      case "add_contact": {
        if (!person) break;
        await prisma.contact.create({
          data: {
            applicationId,
            name: person,
            role: asText(a.personRole) || null,
            email: asText(a.personEmail) || null,
            notes: text || null,
          },
        });
        applied.push(a.summary);
        break;
      }
      case "add_follow_up": {
        if (!text) break;
        await prisma.followUp.create({ data: { applicationId, note: text, dueDate: asDate(asText(a.date)) } });
        applied.push(a.summary);
        break;
      }
      case "complete_follow_up": {
        // Must genuinely match. This previously fell back to "if there is
        // exactly one open follow-up, close that one", which closed "send
        // Brian a copy of the resume" on the strength of a request to draft
        // that email. Closing the wrong task is silent, so no fallback.
        const needle = text.toLowerCase();
        if (needle.length < 4) break;
        const target = followUps.find((f) => f.note.toLowerCase().includes(needle));
        if (!target) break;
        await prisma.followUp.update({ where: { id: target.id }, data: { completed: true } });
        applied.push(a.summary);
        break;
      }
      case "update_status": {
        if (!JOB_STATUSES.includes(a.status as never)) break;
        await prisma.jobApplication.update({
          where: { id: applicationId },
          data: { status: a.status, lastCheckedAt: new Date() },
        });
        applied.push(a.summary);
        break;
      }
      case "append_note": {
        if (!text) break;
        const stamp = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        notes = `${notes ? `${notes}\n\n` : ""}${stamp}: ${text}`;
        await prisma.jobApplication.update({ where: { id: applicationId }, data: { notes } });
        applied.push(a.summary);
        break;
      }
      case "set_salary": {
        // The one field write that skipped cleanInlineText, and the only place
        // markup has reached the database since that rule existed: a leaked
        // tool-call fragment was stored as the salary and rendered on the
        // pipeline as visible angle brackets. Every one-line field goes through
        // the sanitiser, no exceptions.
        const salary = cleanInlineText(text ?? "");
        if (!salary) break;
        await prisma.jobApplication.update({ where: { id: applicationId }, data: { salaryRange: salary } });
        applied.push(a.summary);
        break;
      }
    }
  }

  return NextResponse.json({ applied });
}
