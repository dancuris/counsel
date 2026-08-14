import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ContactDetailsForm } from "@/components/ContactDetailsForm";
import { parseLabelled } from "@/lib/contact-block";
import { forwardCorrespondence } from "@/app/contacts/actions";
import { GENERAL_KINDS, type GeneralKind } from "@/lib/general-documents";
import { formatDate, formatDateTime } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { ContactConversation } from "@/components/ContactConversation";
import type { ThreadEntry } from "@/components/ThreadMessage";
import { parseAttachments } from "@/lib/document-file";
import { getSignatureOptions } from "@/lib/signature";
import { newestPart } from "@/lib/mail-thread";
import { saveContactNote, updateContactDetails, clearNextAction } from "../actions";
import { discardDraft, markSentElsewhere } from "./thread-actions";
import { PAGE_TITLE } from "@/lib/type";
import { TENANT_ID } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Everything about one person, in one place.
 *
 * The contacts list used to link through to an application, which dropped you
 * into a role with no explanation of why you were there. A person is a thing in
 * their own right: what you owe them, what has been said, and where they touch
 * the search.
 *
 * The thread reads both directions. Mail synced from the mailbox is matched to
 * an application rather than to a person, so anything from this address is
 * pulled in alongside the notes written to them - otherwise half a
 * conversation would be missing and it would look like nothing had been said.
 */
/** A JSON array of strings, or nothing. Never throws on bad data. */
function safeList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export default async function ContactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ write?: string; prompt?: string; edit?: string }>;
}) {
  const { id } = await params;
  // Ask sends people here to act on a recommendation, so the composer opens
  // with the suggested instruction already in Claude's box. Landing on a closed
  // "Write to Brian..." button would make the advice one more thing to re-type.
  const { write, prompt, edit } = await searchParams;

  // The two documents that belong to no role, so a networking note is one
  // click rather than a hunt through the Drive picker.
  const generalRows = await prisma.generalDocument.findMany();
  const sendAnywhere = (Object.keys(GENERAL_KINDS) as GeneralKind[])
    .map((id) => {
      const row = generalRows.find((r) => r.id === id);
      return { id, label: GENERAL_KINDS[id].label, docx: row?.driveFileIdDocx ?? null, pdf: row?.driveFileIdPdf ?? null };
    })
    .filter((d) => d.docx || d.pdf);

  // Everyone he might copy: other contacts, and his own addresses so a test
  // or a self-copy is a pick rather than a retype.
  const [otherContacts, ownProfile, allCompanies] = await Promise.all([
    prisma.contact.findMany({ where: { email: { not: null } }, select: { id: true, name: true, email: true, company: true } }),
    prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { contactEmails: true } }),
    prisma.company.findMany({ select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  const companyNames = allCompanies.map((c) => c.name);
  const ownAddresses = parseLabelled(ownProfile?.contactEmails).map((e) => ({ label: e.label, value: e.value }));
  // Everyone except the person whose page this is: forwarding to the original
  // recipient is not a thing anyone means to do.
  const forwardTargets = otherContacts
    .filter((c) => c.id !== id)
    .map((c) => ({ id: c.id, label: `${c.name}${c.company ? ` - ${c.company}` : ""}` }));
  const addressBook = [
    ...parseLabelled(ownProfile?.contactEmails).map((e) => ({ label: `You (${e.label})`, value: e.value })),
    ...otherContacts
      .filter((c) => c.email)
      .map((c) => ({ label: `${c.name}${c.company ? ` - ${c.company}` : ""}`, value: c.email as string })),
  ];

  // A draft to open in the composer on arrival. Set by a forward, which lands
  // here so the note on top can be written immediately.
  const editDraft = edit
    ? await prisma.correspondence.findFirst({
        where: { id: edit, contactId: id, status: "draft" },
        select: { id: true, subject: true, content: true, contentHtml: true, instructions: true },
      })
    : null;

  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      application: { include: { company: true } },
      correspondence: { orderBy: { createdAt: "desc" } },
      interviewsAttended: { orderBy: { date: "desc" }, include: { application: { include: { company: true } } } },
    },
  });
  if (!contact) notFound();

  const signature = await getSignatureOptions();

  // Their side of the conversation, matched on address since synced mail hangs
  // off an application rather than a person.
  // Matched on the recovered sender too, not just the envelope. Dan is
  // migrating off his personal address, so his own forwards carry other
  // people's mail: Jennifer's AT&T outreach arrived as "from Dan" and her
  // thread showed nothing until this.
  // Mail that is theirs by address, and mail Dan filed to them by hand.
  //
  // Address matching alone misses the case filing to a person exists for: a
  // thread that arrives from an assistant, or from Dan's own forward, but
  // belongs to the relationship. He files it to the person; it has to show up
  // on the person.
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
        select: { id: true, gmailId: true, threadId: true, subject: true, snippet: true, body: true, receivedAt: true, applicationId: true },
      });

  const thread: ThreadEntry[] = [
    ...contact.correspondence.map((c) => ({
      key: c.id,
      at: c.sentAt ?? c.createdAt,
      from: "you" as const,
      who: "You",
      subject: c.subject,
      body: c.content,
      html: c.contentHtml,
      status: c.status,
      attachments: parseAttachments(c.attachments).map((a) =>
        a.kind === "drive" ? { id: a.driveFileId, label: a.name } : { id: a.documentId, label: `Generated ${a.format}` }
      ),
      recipientEmail: c.recipientEmail ?? contact.email,
      // Carried so a draft saved with copies on it still has them days later,
      // and so the send confirmation can name everyone who will receive it.
      cc: c.cc,
      bcc: c.bcc,
      gmailId: c.gmailMessageId,
    })),
    ...inbound.map((m) => ({
      key: m.id,
      at: m.receivedAt,
      from: "them" as const,
      who: contact.name,
      subject: m.subject,
      // The whole message, not the Gmail snippet - but only the part of it that
      // is new. Each forward carries the entire prior chain quoted beneath, so
      // showing the raw body repeated every earlier message inside every later
      // one. `newestPart` keeps the shallowest quote level and drops the rest,
      // which is already sitting in its own row above.
      body: newestPart(m.body) || (m.snippet ?? "").trim(),
      html: null,
      status: "received",
      attachments: [] as { id: string; label: string }[],
      recipientEmail: contact.email,
      gmailId: m.gmailId,
    })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    // Dates are formatted here so the client component takes strings and does
    // not have to agree with the server about a timezone.
    .map((m) => ({ ...m, at: formatDateTime(m.at) }));

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/contacts" className="text-[12px] text-[var(--tx-3)] hover:text-[var(--tx)]">
        ← Contacts
      </Link>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className={PAGE_TITLE}>{contact.name}</h1>
        {contact.email && (
          <a href={`mailto:${contact.email}`} className="text-[13px] text-[var(--tx-3)] hover:text-[var(--tx)]">
            {contact.email}
          </a>
        )}
      </div>
      <p className="mt-1 text-sm text-[var(--tx-3)]">
        {[contact.role, contact.company, contact.phone].filter(Boolean).join(" · ") || "No details yet"}
      </p>
      {contact.application && (
        // Deliberately a separate line, and deliberately worded as a
        // connection rather than an affiliation. Running these together is
        // what read as somebody working at a company they had only made an
        // introduction into.
        <p className="mt-0.5 text-[13px] text-[var(--tx-3)]">
          Relevant to{" "}
          <Link href={`/applications/${contact.application.id}`} className="underline hover:text-[var(--tx)]">
            {contact.application.company.name} · {contact.application.roleTitle}
          </Link>
        </p>
      )}
      {contact.relationship && (
        <p className="mt-0.5 text-[13px] text-[var(--tx-2)]">{contact.relationship.replace("Warm thread - ", "")}</p>
      )}

      {contact.nextAction && (
        <section className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-line bg-[var(--amber-dim)] p-3">
          <p className="min-w-0 text-[13px] text-[var(--tx)]">
            <b className="font-semibold text-[var(--amber)]">You owe them:</b> {contact.nextAction}
          </p>
          <form action={clearNextAction.bind(null, contact.id)}>
            <SubmitButton className="rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-[var(--tx-2)] transition hover:text-[var(--tx)]">
              Done
            </SubmitButton>
          </form>
        </section>
      )}

      <ContactConversation
        addressBook={addressBook}
        ownAddresses={ownAddresses}
        forwardTargets={forwardTargets}
        companyNames={companyNames}
        initialEdit={
          editDraft
            ? {
                id: editDraft.id,
                subject: editDraft.subject ?? "",
                html: editDraft.contentHtml ?? editDraft.content.split("\n").map((l) => `<div>${l || "<br>"}</div>`).join(""),
                instructions: safeList(editDraft.instructions),
              }
            : null
        }
        onForward={forwardCorrespondence}
        sendAnywhere={sendAnywhere}
        contactId={contact.id}
        name={contact.name}
        signature={signature}
        thread={thread}
        save={saveContactNote.bind(null, contact.id)}
        discard={discardDraft.bind(null, contact.id)}
        markSentElsewhere={markSentElsewhere.bind(null, contact.id)}
        openComposer={write === "1"}
        initialInstruction={typeof prompt === "string" ? prompt.slice(0, 300) : ""}
      />

      {/*
        Drafts you have saved, listed where you would look for them.
        
        They were only ever reachable at /contacts/<id>?edit=<id>, a URL nobody
        has unless something handed it to them. Dan asked whether the drafts
        being written for him were meant to disappear: they were not, they were
        simply unreachable. A saved draft that the page does not show is the
        same fault as a page nothing links to.
      */}
      {contact.correspondence.some((c) => c.status === "draft") && (
        <section className="panel mt-4 p-4">
          <h2 className="text-[13px] font-semibold">Saved drafts</h2>
          <ul className="mt-2 space-y-2">
            {contact.correspondence
              .filter((c) => c.status === "draft")
              .map((d) => (
                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-[var(--tx)]">
                      {d.subject || "No subject"}
                    </span>
                    <span className="block truncate text-[12px] text-[var(--tx-3)]">
                      {d.content.replace(/\s+/g, " ").slice(0, 90)}
                    </span>
                  </span>
                  <Link
                    href={`/contacts/${contact.id}?write=1&edit=${d.id}`}
                    className="shrink-0 text-[12.5px] font-medium text-accent hover:underline"
                  >
                    Open
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      )}

      {contact.interviewsAttended.length > 0 && (
        <section className="panel mt-4 p-4">
          <h2 className="text-[13px] font-semibold">Interviews they sat in on</h2>
          <ul className="mt-2 space-y-1.5">
            {contact.interviewsAttended.map((n) => (
              <li key={n.id} className="text-[13px]">
                <Link href={`/applications/${n.applicationId}`} className="hover:underline">
                  <span className="font-medium">{n.application.company.name}</span>
                  <span className="text-[var(--tx-3)]">
                    {" "}
                    · {n.roundName}
                    {n.date ? ` · ${formatDate(n.date)}` : ""}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <details className="panel mt-4 p-4">
        <summary className="cursor-pointer text-[13px] font-semibold">Edit details</summary>
        {/*
          Keyed on every field it edits, not just a couple, so a write from
          anywhere else repaints the boxes rather than leaving stale text over
          a Save button.
        */}
        <ContactDetailsForm
          key={[contact.name, contact.role, contact.company, contact.email, contact.phone, contact.relationship, contact.nextAction, contact.notes].join("|")}
          action={updateContactDetails.bind(null, contact.id)}
          initial={{
            name: contact.name,
            role: contact.role ?? "",
            company: contact.company ?? "",
            email: contact.email ?? "",
            phone: contact.phone ?? "",
            relationship: contact.relationship ?? "",
            nextAction: contact.nextAction ?? "",
            notes: contact.notes ?? "",
          }}
        />
      </details>
    </div>
  );
}
