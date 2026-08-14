import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { generateStructured } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { cleanInlineText, stripToolCallLeak, stripDraftNotes } from "@/lib/text";
import { enforceHouseLanguage } from "@/lib/contact-block";
import { CORRESPONDENCE_TYPES } from "@/lib/constants";
import { effectiveSender } from "@/lib/mail-sender";
import { newestPart } from "@/lib/mail-thread";
import { ownAddresses } from "@/lib/follow-up";
import { protectedNames } from "@/lib/proper-nouns";
import { candidateName } from "@/lib/candidate";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Drafting a note to a person, rather than to a person about a role.
 *
 * `/api/correspondence` requires an applicationId, which the warm contacts do
 * not have - and they are precisely the ones worth writing to unprompted. This
 * takes the contact as the subject and the conversation so far as the context,
 * so a reply reads like a reply rather than a fresh introduction.
 *
 * It returns text and writes nothing. Saving is the composer's job, and only
 * `POST /api/correspondence/send` may ever mark anything sent.
 */
const DRAFT_TOOL = {
  name: "submit_draft",
  description: "Submit the drafted message.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      content: {
        type: "string",
        description: "The full message body, ready to send, signed off as Dan.",
      },
    },
    required: ["content"],
  },
};

/**
 * Output that is technically a string and obviously not a draft.
 *
 * A two-field version of this tool asked for a subject and a body and got the
 * salutation in the subject on every call, and once the literal word
 * "placeholder" as the entire message. One field removed the confusion; this
 * catches what is left, so a degenerate draft is retried rather than shown.
 */
function looksLikeADraft(text: string): boolean {
  if (text.length < 40) return false;
  if (/^(?:placeholder|todo|draft|\[.*\])$/i.test(text.trim())) return false;
  return true;
}

/**
 * How each kind of note differs, for the one route Dan actually writes from.
 *
 * The role page had these and the contact page did not, so the same prompt
 * produced a thank-you, a check-in and an "I am applying" note in the same
 * register. `role_outreach` is the one with real rules, and they are all
 * prohibitions: the failure mode is a note that asks for something.
 */
const TYPE_GUIDANCE: Record<string, string> = {
  thank_you: "This is a thank-you after a conversation. Reference something specific that was said.",
  follow_up: "This is a check-in on something already in motion. Ask where it stands without pressing.",
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
  general: "",
};

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const protect = await protectedNames();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  // What kind of note. This route ignored it entirely, which is why adding a
  // type with its own prompt changed nothing on the page you write from.
  const noteType: string = CORRESPONDENCE_TYPES.includes(body?.type) ? body.type : "general";
  // Capped and trimmed: this is a sitting's worth of nudges, not a transcript,
  // and it must not crowd out the thread that keeps the draft factual.
  const priorInstructions: string[] = Array.isArray(body?.priorInstructions)
    ? body.priorInstructions.filter((i: unknown): i is string => typeof i === "string" && i.trim().length > 0).slice(-6)
    : [];
  const existing = typeof body?.existing === "string" ? body.existing.trim() : "";

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      application: { include: { company: true, interviewNotes: { orderBy: { createdAt: "desc" }, take: 3 } } },
      correspondence: { orderBy: { createdAt: "desc" }, take: 6 },
    },
  });
  if (!contact) return NextResponse.json({ error: "Contact not found." }, { status: 404 });

  // Their side of the thread lives on MailMessage, matched the same three ways
  // the contact page matches it: their address, their address recovered from a
  // forward, and mail filed to them by hand.
  //
  // The third was missing, and it is the one that matters most here. A thread
  // Dan forwards to himself recovers as being from Dan, so it can never match
  // on address - which is why filing to a person exists - and a thank-you
  // thread hand-filed to a contact, the single most relevant thing to know
  // before writing to them again, was invisible to the route drafting it. Matching on address
  // alone means hand-filing a message improves every page except the one that
  // writes.
  const inbound = await prisma.mailMessage.findMany({
    where: {
      OR: [
        { contactId: contact.id },
        ...(contact.email
          ? [
              { fromEmail: { equals: contact.email, mode: "insensitive" as const } },
              { forwardedFromEmail: { equals: contact.email, mode: "insensitive" as const } },
            ]
          : []),
      ],
    },
    orderBy: { receivedAt: "desc" },
    take: 6,
    select: { subject: true, snippet: true, body: true, receivedAt: true, fromEmail: true, forwardedFromEmail: true },
  });
  const own = await ownAddresses();

  const thread = [
    // Sent only. A draft is something Dan has not said, and it was being fed
    // back as conversation: Claude read his unsent words as though the
    // recipient had seen them, and a single saved draft was enough to make the
    // route believe a thread existed and skip drafting a subject line.
    ...contact.correspondence
      .filter((c) => c.status === "sent" || c.status === "sent_externally")
      .map((c) => ({
      at: c.sentAt ?? c.createdAt,
      who: "Dan wrote",
      text: `${c.subject ? `Subject: ${c.subject}\n` : ""}${c.content}`,
    })),
    ...inbound.map((m) => {
      // Who actually wrote it, not who the row is filed under. A message filed
      // to a contact by hand is often Dan's own forward of his own reply, and
      // labelling that "they wrote" would have the model answer a
      // note he sent - inventing a shared history is the one thing the house
      // rules forbid outright.
      const sender = effectiveSender(m);
      const fromDan = Boolean(sender && own.has(sender.toLowerCase()));
      // The newest part only. These forwards carry the whole prior chain
      // quoted beneath them, so the untrimmed body repeats every earlier
      // message inside every later one.
      const text = newestPart(m.body) || m.snippet || "";
      return {
        at: m.receivedAt,
        who: fromDan ? "Dan wrote" : `${contact.name} wrote`,
        text: `${m.subject ? `Subject: ${m.subject}\n` : ""}${text}`,
      };
    }),
  ]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((t) => `[${t.at.toISOString().slice(0, 10)}] ${t.who}:\n${t.text}`)
    .join("\n\n---\n\n");

  // The subject a reply inherits, computed here rather than after the call,
  // because whether one can be derived at all decides what the model is asked
  // for. Forwarding and reply prefixes are stripped before `Re:` is added, or
  // replying to "Fw: Re: AT&T Opportunity" sends Jennifer a subject announcing
  // that Dan forwarded her own message to himself.
  const answering = (inbound.find((m) => m.subject?.trim())?.subject ?? "")
    .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "")
    .trim();
  const threaded = answering ? `Re: ${answering}` : "";

  /**
   * Suppress the subject line only when one can actually be inherited.
   *
   * This used to test `Boolean(thread)`, and the two are not the same thing.
   * A thread counts Dan's own sent notes, while the fallback subject is read
   * off **inbound** mail - so on any contact he has written to who has not
   * written back, the model was told "return the message body only, no subject
   * line" and there was nothing to fall back to. The box stayed empty forever,
   * whatever was typed into the instruction field, and nothing said why.
   *
   * Tying the instruction to the fallback means the two cannot disagree: the
   * subject is left out only in the one case where the code can supply it.
   */
  const canInheritSubject = Boolean(threaded);

  /**
   * Asking for a different subject did nothing at all.
   *
   * Two independent faults, and either alone was enough. The prompt says
   * "return the message body only, no subject line" whenever a thread exists,
   * so on a reply the model was **instructed** not to produce the thing being
   * asked for. And the composer only applied a returned subject when its box
   * was still empty, so even an unprompted one was discarded.
   *
   * Detected in code rather than by asking the model to report what it did.
   * Same reasoning as everywhere else here: an instruction is a request, and
   * the failure is silent - the note looks drafted, the subject is simply the
   * old one, and nothing says so.
   */
  const allInstructions = [...priorInstructions, instruction].join(" ");
  const wantsNewSubject = /\bsubj(?:ect)?\b|\bsubject line\b|\bre-?title\b|\bheadline\b/i.test(allInstructions);

  const app = contact.application;
  const context = [
    `Recipient: ${contact.name}${contact.role ? `, ${contact.role}` : ""}`,
    contact.relationship ? `How Dan knows them: ${contact.relationship}` : "",
    contact.nextAction ? `What Dan owes them: ${contact.nextAction}` : "",
    contact.notes ? `Notes on them: ${contact.notes}` : "",
    app ? `Related role: ${app.roleTitle} at ${app.company.name} (status: ${app.status})` : "Not attached to any role Dan is pursuing.",
    app?.interviewNotes.length
      ? `Interview notes:\n${app.interviewNotes.map((n) => `- ${n.roundName}: ${n.notes ?? ""}`).join("\n")}`
      : "",
    thread ? `Conversation so far, oldest first:\n\n${thread}` : "No correspondence with them yet.",
    existing ? `Dan has already started writing this. Work from his draft rather than replacing it:\n\n${existing}` : "",
    // Everything he has asked for in this sitting, not just the latest line.
    // Without it the second instruction discarded the first: "make it shorter"
    // followed by "mention the referral" produced a short note with no
    // referral in it, and he had to repeat himself.
    priorInstructions.length
      ? `Earlier instructions in this sitting, all still in force:\n${priorInstructions.map((i) => `- ${i}`).join("\n")}`
      : "",
    TYPE_GUIDANCE[noteType] ?? "",
    instruction ? `What Dan wants this message to do:\n${instruction}` : "Write the message that most usefully moves this relationship forward right now.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const who = await candidateName();
  const system = cachedSystem(
    await buildProfileContext(),
    `You are drafting an email that ${who} will send themselves, so it has to sound like them and not like an assistant.

House style, which is not negotiable:
- No em-dashes or en-dashes anywhere. Use a comma, a full stop, or a colon.
- Plain first-person voice. Nothing over-eager, nothing that sounds generated.
- No preachy closing line, no "I look forward to hearing from you at your earliest convenience".
- Short. A note someone reads on a phone and can answer in two lines.
- Never invent a fact, a metric, a meeting or a shared history that is not in the context below.
- Sign off "Best," then "${who}" on its own line. Nothing after that: the app appends contact details.
- **US English throughout.** Not British: "optimize" not "optimise", "program"
  not "programme", "while" not "whilst", "toward" not "towards", "among" not
  "amongst", "color" and "favor" and "labor" without the u. Spellings are
  converted in code afterwards, so a slip is caught, but write it correctly.
- **Complete sentences, always.** No fragments, no telegraphic notes.
- **Never end a sentence with a preposition.** Not "thanks for reaching out",
  "a role I would like to hear more about", "the team I would be working with".
  Rewrite the sentence rather than leaving the preposition hanging: "thank you
  for the note", "I would like to understand the role in more detail", "the
  team I would join".
${
  canInheritSubject && !wantsNewSubject
    ? "- Return the message body only. No subject line, no preamble, no commentary about the draft."
    : `- **Begin with a single line "Subject: ..." and then a blank line**, because
  ${wantsNewSubject ? "Dan has asked for the subject to change, so it must be written out" : "there is no earlier message whose subject this can inherit"}. Make it specific
  to what the message is about; never a generic "Touching base" or "Hello".
  After that line, the message body only, with no preamble or commentary.`
}
`
  );

  try {

    // Two attempts, because the leak is intermittent rather than deterministic:
    // the same request produced a clean draft and a mangled one back to back.
    let out: { content?: unknown } | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      // Through the router, so a dry Anthropic balance falls back to Gemini
      // rather than stopping the drafting entirely.
      const result = await generateStructured<{ content?: unknown }>({
        maxTokens: 2000,
        toolName: "submit_draft",
        schema: DRAFT_TOOL.input_schema as unknown as Record<string, unknown>,
        system,
        user: context,
      });
      const candidate = result.data;
      const cleaned = typeof candidate.content === "string" ? stripToolCallLeak(candidate.content) : null;
      if (cleaned && looksLikeADraft(cleaned)) {
        out = candidate;
        break;
      }
    }
    if (!out) {
      return NextResponse.json({ error: "Claude did not return a usable draft. Try again." }, { status: 502 });
    }
    // Tool output is never trusted for shape. `strict: true` is set and it still
    // put the entire message body into `subject`, wrapped in a leaked tool-call
    // fragment, on the first real call: the same failure that once wrote
    // "</antml...>" into a salary. So the subject is cleaned and then sanity
    // checked, and anything that does not look like a subject line is dropped
    // rather than shown - an empty subject box costs nothing, a corrupt one
    // gets sent to a recruiter.
    const content = stripToolCallLeak(typeof out.content === "string" ? out.content : "") ?? "";
    if (!content) return NextResponse.json({ error: "Claude returned an empty draft." }, { status: 502 });

    // The model was told to write the body only, and it complied by putting
    // "Subject: Re: AT&T Opportunity..." as the first line of the body - which
    // would have gone out as visible text in the email. It is not wrong about
    // wanting a subject, only about where to put it, so the line is lifted out
    // rather than deleted.
    //
    // This is why the two-field version failed and a single field plus parsing
    // works: asking for a subject alongside a body made it confuse the two,
    // but a subject stated inside the body is unambiguous about which is which.
    const leading = content.match(/^\s*subject:\s*([^\n\r]{1,120})[\r\n]+/i);
    // Named apart from the request `body` above. The two shadowed each other,
    // which is a temporal-dead-zone trap waiting for the next edit in here.
    const messageBody = leading ? content.slice(leading[0].length).trimStart() : content;
    const fromBody = leading ? cleanInlineText(leading[1]) : "";

    // Failing that, `threaded` above: a reply carries the subject of what it
    // answers, with Re: added once and never stacked.
    //
    // `replaceSubject` tells the composer this subject was asked for, so it may
    // overwrite one already in the box. Only true when Dan's instruction was
    // about the subject AND a subject actually came back: without the second
    // half, a failed extraction would blank a subject he had typed himself.
    return NextResponse.json({
      subject: fromBody || threaded,
      replaceSubject: wantsNewSubject && Boolean(fromBody),
      content: stripDraftNotes(enforceHouseLanguage(messageBody, protect)),
    });

  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }
}
