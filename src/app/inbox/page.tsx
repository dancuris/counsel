import { SubmitButton } from "@/components/SubmitButton";
import { scheduleFromMail } from "./actions";
import { PendingTimes } from "@/components/PendingTimes";
import { pendingTimes } from "@/lib/pending-times";
import { toEasternInput } from "@/lib/local-time";

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { FILED_MAIL, UNFILED_MAIL } from "@/lib/mail-filing";
import { connectedMailboxes, oldestSync } from "@/lib/mail-provider";
import { formatDateTime } from "@/lib/format";
import { MAIL_CATEGORY_LABELS, type MailCategory } from "@/lib/constants";
import { createApplicationFromMail, attachMailToApplication, dismissMail, markMailJobRelated, addContactFromMail, fileMailToCompany, fileMailToContact } from "./actions";
import { MailboxSyncButton } from "@/components/MailboxSyncButton";
import { MailAutoSync } from "@/components/MailAutoSync";
import { FileMailControl } from "@/components/FileMailControl";
import { getSignatureOptions } from "@/lib/signature";
import { looksLikeAPerson } from "@/lib/mail-sender";
import { PAGE_TITLE, PAGE_WIDE, EMPTY_BLOCK, PAGE_LEDE } from "@/lib/type";
import { inputClass } from "@/lib/button";
import { NOT_DELETED } from "@/lib/data/applications";

export const dynamic = "force-dynamic";

const CATEGORY_TONE: Record<string, string> = {
  offer: "bg-green-600 text-white",
  interview_invite: "bg-flame text-white",
  recruiter_outreach: "bg-accent text-white",
  rejection: "bg-[var(--surface-2)] text-[var(--tx-2)]",
  application_confirmation: "bg-accent-light text-accent-dark",
  other_job_related: "bg-[var(--surface-2)] text-[var(--tx-2)]",
};


// `looksLikeAPerson` is imported, not redefined. It lived here as a second,
// near-identical copy of the one in `mail-sender.ts` - the same fault as the
// two `toLocalInput` helpers that between them showed the right interview time
// and stored the wrong one. Who counts as a person decides which senders get
// offered as contacts here and which inbound mail resets the follow-up clock
// there, so the two copies disagreeing would be invisible and consequential.

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  // Filed and Everything else were collapsed <details> holding the whole
  // history and the whole noise bin, and collapsed is not unrendered: this was
  // the heaviest page in the app at 335 KB, on a day when there was nothing to
  // file. They are behind the URL now, like the pipeline archive.
  const show = (await searchParams).show;
  // Counted separately, because a link that cannot say how much is behind it
  // is the "4 live conversations" problem again.
  const FILED = FILED_MAIL;
  const [filedCount, noiseCount] = await Promise.all([
    prisma.mailMessage.count({ where: FILED }),
    prisma.mailMessage.count({
      where: { dismissedAt: null, OR: [{ category: "not_job_related" }, { category: null }] },
    }),
  ]);
  const [leads, applications, mailboxes, noise, filed, times, signature, companies, knownContacts] = await Promise.all([
    prisma.mailMessage.findMany({
      where: UNFILED_MAIL,
      orderBy: { receivedAt: "desc" },
    }),
    prisma.jobApplication.findMany({
      where: NOT_DELETED,
      include: { company: true },
      orderBy: { updatedAt: "desc" },
    }),
    connectedMailboxes(),
    show === "noise"
      ? prisma.mailMessage.findMany({
          where: { dismissedAt: null, OR: [{ category: "not_job_related" }, { category: null }] },
          orderBy: { receivedAt: "desc" },
          take: 60,
        })
      : Promise.resolve([]),
    // The audit trail. Filing used to be silent and irreversible from here,
    // so a message attached to the wrong role simply vanished.
    show === "filed"
      ? prisma.mailMessage.findMany({
          where: FILED,
          include: { application: { include: { company: true } }, company: true },
          orderBy: { receivedAt: "desc" },
          take: 20,
        })
      : Promise.resolve([]),
    pendingTimes(),
    getSignatureOptions(),
    // Only employers actually being tracked, so the picker is a real list
    // rather than every company name the app has ever seen.
    // Every company, not only those with a live application. Filtering to
    // tracked employers broke the one case this exists for: an introduction to
    // someone at a company with no posting behind it.
    prisma.company.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // So a sender already in the book shows as a link rather than offering to
    // add them a second time.
    prisma.contact.findMany({ where: { NOT: { email: null } }, select: { id: true, name: true, email: true } }),
  ]);

  const contactBySender = new Map(
    knownContacts.filter((c) => c.email).map((c) => [c.email!.trim().toLowerCase(), c])
  );

  // Gmail and Fastmail are one inbox here: sync pulls both, so the page reports
  // the oldest of their sync times, the only one that is true of all the mail.
  const connection = mailboxes.length ? { lastSyncedAt: oldestSync(mailboxes) } : null;

  const ownAddresses = new Set(
    [...(signature?.emails ?? []).map((e) => e.value), ...mailboxes.map((b) => b.email)]
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean)
  );

  return (
    <div className={PAGE_WIDE}>
      {/* Opening the Inbox is the moment you want it current, so it syncs
          itself here rather than waiting to be told. */}
      {connection && <MailAutoSync lastSyncedAt={connection.lastSyncedAt?.toISOString() ?? null} />}

      <PendingTimes items={times} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {/* The count is the headline, as on Today and Contacts. "Inbox" as a
              title said only what the nav already said. */}
          <h1 className={PAGE_TITLE}>
            {leads.length === 0 ? (
              "Nothing to file."
            ) : (
              <>
                {leads.length} message{leads.length === 1 ? "" : "s"} to file.
              </>
            )}
          </h1>
          {/* Unconditional. This was hidden whenever there was nothing to file,
              so clearing the inbox removed the only line under the heading and
              the page visibly jumped - the one page in the app whose header
              changed shape depending on its data. */}
          <p className={`${PAGE_LEDE} max-w-[52ch]`}>
            Job-related mail that matches nothing you are tracking. Filing it is how the pipeline learns what
            happened.
          </p>
        </div>
        {connection && (
          <div className="text-right">
            <MailboxSyncButton />
            <p className="mt-1 text-xs text-[var(--tx-3)]">
              {connection.lastSyncedAt ? `Synced ${formatDateTime(connection.lastSyncedAt)}` : "Never synced"}
            </p>
          </div>
        )}
      </div>

      {!connection && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No mailbox connected.{" "}
          <Link href="/settings" className="font-medium underline">
            Connect Gmail or Fastmail
          </Link>{" "}
          to start pulling mail.
        </p>
      )}

      {connection && leads.length === 0 && (
        <p className={`panel ${EMPTY_BLOCK}`}>
          Nothing waiting. Every job-related message is filed against a role.
        </p>
      )}

      <ul className="space-y-3">
        {leads.map((mail) => (
          <li key={mail.id} className="panel p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--tx)]">{mail.subject}</p>
                <p className="truncate text-xs text-[var(--tx-3)]">
                  {mail.forwardedFromEmail ? (
                    <>
                      {mail.forwardedFromName ? `${mail.forwardedFromName} · ` : ""}
                      {mail.forwardedFromEmail}
                      <span className="text-[var(--tx-3)]"> · forwarded by you</span>
                    </>
                  ) : (
                    <>
                      {mail.fromName ? `${mail.fromName} · ` : ""}
                      {mail.fromEmail}
                    </>
                  )}{" "}
                  · {formatDateTime(mail.receivedAt)}
                </p>
              </div>
              {mail.category && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    CATEGORY_TONE[mail.category] ?? "bg-[var(--surface-2)] text-[var(--tx-2)]"
                  }`}
                >
                  {MAIL_CATEGORY_LABELS[mail.category as MailCategory] ?? mail.category}
                </span>
              )}
            </div>

            {mail.summary && <p className="mt-2 text-sm text-[var(--tx-2)]">{mail.summary}</p>}

            {/* A time read out of prose is a guess, so it is shown next to the
                wording it came from and only reaches the calendar on a press. */}
            {mail.proposedStart && !mail.scheduledAt && (
              <form
                action={scheduleFromMail.bind(null, mail.id)}
                key={mail.proposedStart?.toISOString() ?? mail.id}
                className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border border-amber-line bg-[var(--amber-dim)] p-2.5"
              >
                <div className="min-w-0">
                  <p className="text-[11.5px] font-medium text-[var(--amber)]">Proposed interview time</p>
                  {mail.proposedLabel && (
                    <p className="text-[11px] text-[var(--tx-3)]">read from &ldquo;{mail.proposedLabel}&rdquo;</p>
                  )}
                </div>
                <input
                  type="datetime-local"
                  name="start"
                  defaultValue={toEasternInput(mail.proposedStart)}
                  className={inputClass("sm")}
                />
                <input
                  name="roundName"
                  placeholder="Round"
                  className={`w-28 ${inputClass("sm")}`}
                />
                <SubmitButton
                  pendingLabel="Adding..."
                  className="rounded bg-[var(--amber)] px-2.5 py-1 text-xs font-semibold text-white"
                >
                  Add to calendar
                </SubmitButton>
              </form>
            )}
            {mail.scheduledAt && (
              <p className="mt-2 text-[11.5px] text-[var(--mint)]">Added to your calendar</p>
            )}

            {(mail.detectedCompany || mail.detectedRole) && (
              <p className="mt-1.5 text-xs text-[var(--tx-2)]">
                <span className="font-medium">{mail.detectedCompany ?? "Unknown company"}</span>
                {mail.detectedRole ? ` - ${mail.detectedRole}` : ""}
              </p>
            )}

            {/*
              Dismiss on the left, everything constructive on the right, with
              the primary last.

              "Track this role" used to sit first and loudest, which made
              creating a job the default reading of every message - including a
              networking thread with a company that has no job behind it. It is
              now offered only when the classifier actually found a role, and
              it is the rightmost thing rather than the first.
            */}
            <div className="mt-3 border-t border-line pt-3">
              <FileMailControl
                applications={applications.map((a) => ({ id: a.id, company: a.company.name, role: a.roleTitle }))}
                companies={companies}
                suggestCompany={mail.detectedCompany}
                suggestRole={mail.detectedRole}
                fileToRole={attachMailToApplication.bind(null, mail.id)}
                fileToCompany={fileMailToCompany.bind(null, mail.id)}
                contacts={knownContacts.map((c) => ({ id: c.id, name: c.name, company: null }))}
                fileToPerson={fileMailToContact.bind(null, mail.id)}
              />

              {/* Quiet second tier: enrichment and dismissal, never the point. */}
              <div className="mt-2 flex flex-wrap items-center gap-4">
              {looksLikeAPerson(mail.forwardedFromEmail ?? mail.fromEmail, ownAddresses) &&
                (contactBySender.get((mail.forwardedFromEmail ?? mail.fromEmail ?? "").toLowerCase()) ? (
                  <Link
                    href={`/contacts/${contactBySender.get((mail.forwardedFromEmail ?? mail.fromEmail ?? "").toLowerCase())!.id}`}
                    className="text-xs text-[var(--tx-3)] underline-offset-2 hover:text-[var(--tx)] hover:underline"
                  >
                    {contactBySender.get((mail.forwardedFromEmail ?? mail.fromEmail ?? "").toLowerCase())!.name}
                  </Link>
                ) : (
                  <form action={addContactFromMail.bind(null, mail.id)}>
                    <SubmitButton className="text-xs text-[var(--tx-2)] hover:text-[var(--tx)] hover:underline">
                      Add as contact
                    </SubmitButton>
                  </form>
                ))}

              {mail.detectedRole && (
                <form action={createApplicationFromMail.bind(null, mail.id)}>
                  <SubmitButton className="text-xs text-[var(--tx-2)] hover:text-[var(--tx)] hover:underline">
                    Track it as a new role
                  </SubmitButton>
                </form>
              )}

              <form action={dismissMail.bind(null, mail.id)} className="ml-auto">
                <SubmitButton className="text-xs text-[var(--tx-3)] hover:text-[var(--tx-2)] hover:underline">Not relevant</SubmitButton>
              </form>
              </div>
            </div>

            <details className="mt-2">
              <summary className="cursor-pointer list-none text-xs text-[var(--tx-3)] hover:text-accent">
                Read the message
              </summary>
              <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-[var(--surface-2)] p-3 text-xs text-[var(--tx-2)]">
                {mail.body.slice(0, 6000)}
              </pre>
            </details>
          </li>
        ))}
      </ul>

      {filedCount > 0 &&
        (show === "filed" ? (
          <section className="panel">
            <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--tx-3)]">
                Filed <span className="font-normal normal-case tracking-normal">{filedCount}</span>
              </h2>
              <Link href="/inbox" className="text-[12px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]">
                Hide
              </Link>
            </div>

            {/* Sits between the header rule and the list rule, so it needs
                padding on both sides or it reads as crushed into the border. */}
            <p className="px-4 py-2.5 text-xs text-[var(--tx-3)]">
              Where each message ended up. Open the role to move it or send it back here.
            </p>
            <ul className="divide-y divide-[var(--line)] border-t border-line">
            {filed.map((mail) => (
              <li key={mail.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--tx)]">{mail.subject}</span>
                  <span className="block truncate text-xs text-[var(--tx-3)]">
                    {mail.fromEmail} · {formatDateTime(mail.receivedAt)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {looksLikeAPerson(mail.forwardedFromEmail ?? mail.fromEmail, ownAddresses) && (
                    <form action={addContactFromMail.bind(null, mail.id)}>
                      <SubmitButton className="text-xs text-[var(--tx-3)] hover:text-[var(--tx-2)] hover:underline">
                        Add as contact
                      </SubmitButton>
                    </form>
                  )}
                  {/* Where it went. A company-filed message has no role to
                      name, and linking it to an application it does not have
                      would be a dead link on the page whose job is the audit
                      trail. */}
                  {mail.applicationId ? (
                    <Link
                      href={`/applications/${mail.applicationId}`}
                      className="rounded-full bg-accent-light px-2 py-0.5 text-xs font-medium text-accent-dark hover:bg-accent hover:text-white"
                    >
                      {mail.application?.company.name} - {mail.application?.roleTitle}
                    </Link>
                  ) : mail.companyId ? (
                    <Link
                      href={`/companies/${mail.companyId}`}
                      className="rounded-full border border-line px-2 py-0.5 text-xs font-medium text-[var(--tx-2)] hover:text-[var(--tx)]"
                    >
                      {mail.company?.name}
                    </Link>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
                  </section>
        ) : (
          <Link
            href="/inbox?show=filed"
            className="block border-t border-line pt-4 text-[13px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
          >
            Filed <span>{filedCount}</span>
          </Link>
        ))}

      {noiseCount > 0 &&
        (show === "noise" ? (
          <section className="panel">
            <div className="flex items-baseline justify-between gap-2 border-b border-line px-4 py-3">
              <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--tx-3)]">
                Everything else <span className="font-normal normal-case tracking-normal">{noiseCount}</span>
              </h2>
              <Link href="/inbox" className="text-[12px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]">
                Hide
              </Link>
            </div>

            <p className="px-4 py-2.5 text-xs text-[var(--tx-3)]">
              Classified as not job related. If something here actually matters, promote it and it moves up to be filed.
            </p>
            <ul className="divide-y divide-[var(--line)] border-t border-line">
            {noise.map((mail) => (
              <li key={mail.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--tx)]">{mail.subject}</span>
                  <span className="block truncate text-xs text-[var(--tx-3)]">
                    {mail.fromEmail} · {formatDateTime(mail.receivedAt)}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <form action={markMailJobRelated.bind(null, mail.id)}>
                    <SubmitButton
                      className="rounded border border-accent px-2 py-1 text-xs text-accent hover:bg-accent-light"
                      pendingLabel="Filing..."
                    >
                      Job related
                    </SubmitButton>
                  </form>
                  <form action={dismissMail.bind(null, mail.id)}>
                    <SubmitButton className="text-xs text-[var(--tx-3)] hover:text-red-600 hover:underline" pendingLabel="Deleting...">Delete</SubmitButton>
                  </form>
                </span>
              </li>
            ))}
          </ul>
                  </section>
        ) : (
          <Link
            href="/inbox?show=noise"
            className="block border-t border-line pt-4 text-[13px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
          >
            Everything else <span>{noiseCount}</span>
          </Link>
        ))}
    </div>
  );
}
