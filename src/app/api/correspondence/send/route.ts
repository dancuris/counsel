import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { downloadDriveFile } from "@/lib/google-drive";
import { latestMessageRef, sendMail } from "@/lib/google-mail";
import { parseLabelled } from "@/lib/contact-block";
import { MAIL_CONNECTION_ID } from "@/lib/google-connections";
import { parseAttachments, renderDocumentFile } from "@/lib/document-file";
import { TENANT_ID } from "@/lib/tenant";

export const maxDuration = 120;

// Dispatching a drafted message. This is the only place in the app that causes
// something to leave the building, and it only ever runs from an explicit press
// in the UI - nothing here is triggered by a sync, a cron, or a model.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const id = body?.id;
  if (typeof id !== "string") {
    return NextResponse.json({ error: "id is required." }, { status: 400 });
  }

  const draft = await prisma.correspondence.findUnique({
    where: { id },
    include: { application: { include: { company: true } } },
  });
  if (!draft) return NextResponse.json({ error: "Draft not found." }, { status: 404 });

  // Idempotency guard: a double-click or a retry must not send twice, and a
  // duplicate note to a recruiter is not recoverable.
  if (draft.gmailMessageId) {
    return NextResponse.json({ error: "This was already sent." }, { status: 409 });
  }

  const to = (typeof body?.to === "string" ? body.to : draft.recipientEmail ?? "").trim();
  /**
   * No invented subject for a person.
   *
   * This used to fall back to `Note to ${name}`, and it went out that way to a
   * TransUnion executive on a networking introduction: an internal-sounding
   * label as the actual subject line of a real email. "Company - Role" is a
   * defensible default for an application, because that is genuinely what the
   * thread is about and a recruiter reads it as a reference. "Note to Brian
   * Silver" is not a subject a person writes, and the app should not write it
   * for him.
   *
   * Same rule as the rest of this route: it is the only place allowed to claim
   * something was sent, so it is the place that refuses to send something
   * wrong.
   */
  const subject =
    (typeof body?.subject === "string" ? body.subject : draft.subject ?? "").trim() ||
    (draft.application ? `${draft.application.company.name} - ${draft.application.roleTitle}` : "");
  const content = typeof body?.content === "string" && body.content.trim() ? body.content : draft.content;

  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json({ error: "A valid recipient email address is required." }, { status: 400 });
  }

  /**
   * Every extra address is checked, and one bad entry stops the send.
   *
   * Gmail will happily accept a header with a malformed address in it and
   * simply not deliver to that one, which is the worst outcome available here:
   * the message goes, the app reports success, and the person Dan meant to
   * copy never hears about it and neither does he.
   */
  const parseList = (raw: unknown, label: string): { list: string; error?: string } => {
    const parts = String(typeof raw === "string" ? raw : "")
      .split(/[,;\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);
    const bad = parts.filter((p) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p));
    if (bad.length) return { list: "", error: `${label} has an address that is not valid: ${bad.join(", ")}. Nothing was sent.` };
    return { list: parts.join(", ") };
  };

  const ccParsed = parseList(body?.cc ?? draft.cc, "Cc");
  if (ccParsed.error) return NextResponse.json({ error: ccParsed.error }, { status: 400 });
  const bccParsed = parseList(body?.bcc ?? draft.bcc, "Bcc");
  if (bccParsed.error) return NextResponse.json({ error: bccParsed.error }, { status: 400 });
  const cc = ccParsed.list;
  const bcc = bccParsed.list;
  if (!subject) {
    return NextResponse.json(
      { error: "This needs a subject. Nothing was sent - write one and send again." },
      { status: 400 }
    );
  }

  // Attachments are rendered now, not when the draft was written, so what
  // goes out is the current version of the document.
  const refs = parseAttachments(draft.attachments);
  const attachments = [];
  for (const ref of refs) {
    if (ref.kind === "drive") {
      let file;
      try {
        file = await downloadDriveFile(ref.driveFileId);
      } catch (e) {
        return NextResponse.json({ error: (e as Error).message }, { status: 502 });
      }
      if (!file) {
        return NextResponse.json(
          { error: `"${ref.name}" is no longer in Drive. Remove it from the draft and try again.` },
          { status: 409 }
        );
      }
      attachments.push(file);
      continue;
    }
    const file = await renderDocumentFile(ref.documentId, ref.format);
    if (!file) {
      return NextResponse.json(
        { error: "An attached document no longer exists. Remove it from the draft and try again." },
        { status: 409 }
      );
    }
    attachments.push(file);
  }

  /**
   * A copy to himself, to see what it actually looks like.
   *
   * The same subject, body, formatting and attachments, assembled by the same
   * code, so what he reads is the message and not an approximation of it.
   *
   * Two properties make this safe. The destination must be one of HIS OWN
   * addresses, checked against the profile and the connected mailbox rather
   * than taken from the request - otherwise a mis-click sends a half-written
   * draft to the recruiter with "test" in his head and nothing in the message
   * saying so. And it returns before the update below, so the draft is still a
   * draft: this route is the only thing allowed to claim something was sent,
   * and a test was not.
   */
  if (body?.test === true) {
    const profile = await prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { contactEmails: true } });
    const own = new Set(
      [
        ...parseLabelled(profile?.contactEmails).map((e) => e.value),
        (await prisma.googleConnection.findUnique({ where: { id: MAIL_CONNECTION_ID }, select: { email: true } }))?.email,
      ]
        .filter((v): v is string => Boolean(v))
        .map((v) => v.toLowerCase())
    );
    const testTo = String(body?.testTo ?? "").trim();
    if (!own.has(testTo.toLowerCase())) {
      return NextResponse.json(
        { error: "A test can only go to one of your own addresses. Nothing was sent." },
        { status: 400 }
      );
    }
    try {
      await sendMail({
        to: testTo,
        subject: `[TEST] ${subject}`,
        body: content,
        bodyHtml: draft.contentHtml ?? undefined,
        attachments,
      });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 502 });
    }
    return NextResponse.json({ test: true, to: testTo, subject, attachments: attachments.length });
  }

  let sent;
  try {
    sent = await sendMail({
      to,
      cc: cc || undefined,
      bcc: bcc || undefined,
      subject,
      body: content,
      bodyHtml: draft.contentHtml ?? undefined,
      threadId: draft.gmailThreadId,
      // Gmail's threadId only threads it on Dan's side. The recipient's client
      // and the ATS thread on In-Reply-To/References, which need this.
      threadRef: await latestMessageRef(draft.gmailThreadId),
      attachments,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }

  const updated = await prisma.correspondence.update({
    where: { id },
    data: {
      recipientEmail: to,
      cc: cc || null,
      bcc: bcc || null,
      subject,
      content,
      status: "sent",
      sentAt: new Date(),
      gmailMessageId: sent.id,
      gmailThreadId: sent.threadId,
    },
  });

  return NextResponse.json({ id: updated.id, sentAt: updated.sentAt, to, cc, bcc, subject });
}
