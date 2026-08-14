"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { canEditCorrespondence } from "@/lib/correspondence-edit";
import { cleanInlineText } from "@/lib/text";
import { parseAttachments } from "@/lib/document-file";

/**
 * Writing to a person, rather than to a person about a role.
 *
 * The existing correspondence flow hangs off an application, which is right for
 * a thank-you after an interview and wrong for the people who are not attached
 * to a role at all - the warm contacts, who are exactly the ones worth writing
 * to. `Correspondence.applicationId` is nullable now so a note can belong to a
 * contact alone.
 *
 * Saving a draft and sending it stay separate, as they are everywhere else
 * here: only `POST /api/correspondence/send` may mark anything sent, and only
 * after Gmail returns an id.
 */
export async function saveContactNote(contactId: string, formData: FormData) {
  const subject = cleanInlineText(String(formData.get("subject") ?? ""));
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return;

  // Drive files picked in the composer, stored as references rather than
  // blobs so the file that goes out is whatever Drive holds at send time.
  const attachments = parseAttachments(String(formData.get("attachments") ?? ""));
  // Kept on the draft so what he decided while writing survives until he
  // sends, which can be days later. Validated at send time, not here: a
  // half-typed address should not stop a draft being saved.
  const cc = String(formData.get("cc") ?? "").trim() || null;
  const bcc = String(formData.get("bcc") ?? "").trim() || null;

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { name: true, role: true, email: true, applicationId: true },
  });
  if (!contact) return;

  // Editing an existing draft rather than writing a new one. A saved draft was
  // read-only - Send, Copy, Discard - so the only way to change a word was to
  // leave for the mail client, which is exactly what Dan ended up doing.
  //
  // Only a draft can be rewritten. Anything already sent, by either route, is
  // a record of what went out and must not be editable after the fact.
  const editingId = String(formData.get("correspondenceId") ?? "").trim();
  if (editingId) {
    const existing = await prisma.correspondence.findUnique({
      where: { id: editingId },
      select: { id: true, status: true, gmailMessageId: true, contactId: true },
    });
    if (existing && existing.contactId === contactId && canEditCorrespondence(existing)) {
      await prisma.correspondence.update({
        where: { id: editingId },
        data: {
          subject: subject || null,
          cc,
          bcc,
          content,
          contentHtml: String(formData.get("contentHtml") ?? "").trim() || null,
          // Kept with the note so reopening it does not start the conversation
          // with Claude over again.
          instructions: String(formData.get("instructions") ?? "").trim() || null,
          attachments: attachments.length ? JSON.stringify(attachments) : null,
        },
      });
      revalidatePath(`/contacts/${contactId}`);
      if (contact.applicationId) revalidatePath(`/applications/${contact.applicationId}`);
      return;
    }
  }

  await prisma.correspondence.create({
    data: {
      contactId,
      // Carried when the contact belongs to a role, so the note shows up on
      // that application's thread too rather than only here.
      applicationId: contact.applicationId,
      type: "general",
      direction: "outbound",
      recipientName: contact.name,
      recipientRole: contact.role,
      recipientEmail: contact.email,
      subject: subject || null,
      cc,
      bcc,
      content,
      instructions: String(formData.get("instructions") ?? "").trim() || null,
      contentHtml: String(formData.get("contentHtml") ?? "").trim() || null,
      attachments: attachments.length ? JSON.stringify(attachments) : null,
      status: "draft",
    },
  });

  revalidatePath(`/contacts/${contactId}`);
  if (contact.applicationId) revalidatePath(`/applications/${contact.applicationId}`);
}

export async function updateContactDetails(contactId: string, formData: FormData) {
  const name = cleanInlineText(String(formData.get("name") ?? ""));
  if (!name) return;

  await prisma.contact.update({
    where: { id: contactId },
    data: {
      name,
      role: cleanInlineText(String(formData.get("role") ?? "")) || null,
      company: cleanInlineText(String(formData.get("company") ?? "")) || null,
      email: cleanInlineText(String(formData.get("email") ?? "")) || null,
      phone: cleanInlineText(String(formData.get("phone") ?? "")) || null,
      relationship: cleanInlineText(String(formData.get("relationship") ?? "")) || null,
      nextAction: String(formData.get("nextAction") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });

  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/contacts");
}

export async function clearNextAction(contactId: string) {
  await prisma.contact.update({ where: { id: contactId }, data: { nextAction: null } });
  revalidatePath(`/contacts/${contactId}`);
  revalidatePath("/");
}

/**
 * Forwards a message Dan already sent to somebody else, as a new draft.
 *
 * The case that prompted it: Ted introduced him to Brian, Dan wrote to Brian,
 * and Ted should be thanked. Copying Ted on the original would have been the
 * lazy version and a worse one - it turns a one-to-one note into a three-way
 * conversation, Brian answers more carefully knowing the introducer is
 * reading, and a cc is not a thank-you, it is evidence. A forward lets him say
 * the right thing to each person.
 *
 * It creates a DRAFT rather than sending. The note on top is the whole point,
 * and it is the only part that is actually addressed to the new recipient.
 */
export async function forwardCorrespondence(sourceId: string, formData: FormData) {
  let toContactId = String(formData.get("toContactId") ?? "").trim();

  /**
   * Forwarding to somebody who is not a contact yet.
   *
   * With an introduction this is the normal case, not the exception: the
   * person being thanked is often newer to the search than the person who was
   * written to. Requiring them to exist first means leaving the thread, making
   * a contact, coming back and finding the message again.
   *
   * The employer is recorded on the contact AND as a Company row when it is
   * new, so the person shows up under an employer that exists rather than
   * under a name nothing else knows about. Same case-insensitive match as mail
   * filing, so a typed "transunion" joins the real TransUnion.
   */
  if (!toContactId) {
    const name = String(formData.get("newContactName") ?? "").trim();
    const email = String(formData.get("newContactEmail") ?? "").trim();
    const companyName = String(formData.get("newContactCompany") ?? "").trim();
    if (!name || !email) return;

    if (companyName) {
      const existingCompany = await prisma.company.findFirst({
        where: { name: { equals: companyName, mode: "insensitive" } },
        select: { id: true },
      });
      if (!existingCompany) await prisma.company.create({ data: { name: companyName } });
    }

    // An address already on file is the same person, not a second copy of
    // them: duplicate contacts are how a thread ends up split in two.
    const already = await prisma.contact.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    toContactId =
      already?.id ??
      (
        await prisma.contact.create({
          data: { name, email, company: companyName || null, relationship: "Networking introduction" },
          select: { id: true },
        })
      ).id;
    revalidatePath("/contacts");
    revalidatePath("/companies");
  }
  if (!toContactId) return;

  const [source, target] = await Promise.all([
    prisma.correspondence.findUnique({
      where: { id: sourceId },
      select: {
        subject: true,
        content: true,
        contentHtml: true,
        attachments: true,
        sentAt: true,
        recipientName: true,
        status: true,
      },
    }),
    prisma.contact.findUnique({
      where: { id: toContactId },
      select: { id: true, name: true, role: true, email: true, applicationId: true },
    }),
  ]);
  if (!source || !target) return;
  // Only something that actually went out. Forwarding a draft would send
  // someone a message its supposed recipient has never seen.
  if (source.status === "draft") return;

  const sentOn = source.sentAt
    ? source.sentAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "recently";
  const quotedHtml = [
    "<div><br></div>",
    `<div>--- Forwarded message, sent to ${source.recipientName} on ${sentOn} ---</div>`,
    "<div><br></div>",
    source.contentHtml ?? source.content.split("\n").map((l) => `<div>${l || "<br>"}</div>`).join(""),
  ].join("");

  const draft = await prisma.correspondence.create({
    data: {
      contactId: target.id,
      applicationId: target.applicationId,
      type: "general",
      direction: "outbound",
      recipientName: target.name,
      recipientRole: target.role,
      recipientEmail: target.email,
      subject: source.subject ? `Fwd: ${source.subject}` : null,
      // The attachments come across, because "here is what I sent him" without
      // the resume is not what was sent.
      attachments: source.attachments,
      content: `\n\n--- Forwarded message, sent to ${source.recipientName} on ${sentOn} ---\n\n${source.content}`,
      contentHtml: quotedHtml,
      status: "draft",
    },
  });

  revalidatePath(`/contacts/${toContactId}`);
  if (target.applicationId) revalidatePath(`/applications/${target.applicationId}`);

  // Land in the draft, not beside it.
  //
  // Forwarding without this left a draft on somebody else's page and Dan on
  // the page he started from, with the actual point of a forward - the note
  // written on top, the only part addressed to the new recipient - still to
  // do, on a screen he had to go and find.
  redirect(`/contacts/${toContactId}?edit=${draft.id}`);
}
