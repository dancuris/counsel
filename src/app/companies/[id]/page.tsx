import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/format";
import { PAGE_TITLE_RECORD } from "@/lib/type";

export const dynamic = "force-dynamic";

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      applications: {
        where: { deletedAt: null },
        orderBy: { updatedAt: "desc" },
        include: {
          _count: { select: { contacts: true, documents: true, correspondence: true, interviewNotes: true } },
        },
      },
      // Mail filed against the employer rather than one of its roles. This is
      // where a networking introduction lands: there is no application behind
      // it, and without somewhere to show it, filing it would be the same as
      // losing it.
      mailMessages: {
        where: { applicationId: null },
        orderBy: { receivedAt: "desc" },
        select: {
          id: true,
          subject: true,
          summary: true,
          fromEmail: true,
          forwardedFromEmail: true,
          receivedAt: true,
        },
      },
    },
  });

  if (!company) notFound();

  // Who each filed message is from, as a contact, so a row is a way in rather
  // than a dead end. People-work happens on the contact page in this app - the
  // thread and the composer are there - so that is where a filed message
  // should lead. Matched on the forwarded sender first, because half this
  // mailbox arrives as forwards of Dan's own threads.
  const senders = [
    ...new Set(
      company.mailMessages
        .map((m) => (m.forwardedFromEmail ?? m.fromEmail ?? "").toLowerCase())
        .filter(Boolean)
    ),
  ];
  const [bySender, atCompany] = await Promise.all([
    prisma.contact.findMany({
      where: { email: { in: senders, mode: "insensitive" } },
      select: { id: true, name: true, email: true },
    }),
    // People at this employer, for the common case the sender match misses:
    // half of what lands here is Dan's OWN sent mail, forwarded or synced
    // back, so the sender is him and there is no contact to open. What he
    // actually wants from that row is the person the message concerns.
    prisma.contact.findMany({
      where: { company: { equals: company.name, mode: "insensitive" } },
      select: { id: true, name: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const contactsBySender = new Map(bySender.map((c) => [(c.email ?? "").toLowerCase(), c]));
  // Only when there is exactly one, since guessing between two people is worse
  // than not linking at all.
  const soleContact = atCompany.length === 1 ? atCompany[0] : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className={PAGE_TITLE_RECORD}>{company.name}</h1>
        <p className="mt-1 text-sm text-[var(--tx-3)]">
          {company.applications.length} role{company.applications.length === 1 ? "" : "s"} tracked at this company.
          {company.driveFolderName && <span className="text-[var(--tx-3)]"> Drive folder: {company.driveFolderName}</span>}
        </p>
      </div>

      <div className="space-y-3">
        {company.applications.map((app) => (
          <Link
            key={app.id}
            href={`/applications/${app.id}`}
            className="block panel p-4 shadow-sm transition-colors hover:border-accent"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-medium text-[var(--tx)]">{app.roleTitle}</h2>
              <StatusBadge status={app.status} />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--tx-3)]">
              {app.salaryRange && <span>{app.salaryRange}</span>}
              {app.lastCheckedAt && <span>Last checked {formatDate(app.lastCheckedAt)}</span>}
              <span>{app._count.documents} document{app._count.documents === 1 ? "" : "s"}</span>
              <span>{app._count.contacts} contact{app._count.contacts === 1 ? "" : "s"}</span>
              <span>{app._count.interviewNotes} interview note{app._count.interviewNotes === 1 ? "" : "s"}</span>
              <span>{app._count.correspondence} correspondence{app._count.correspondence === 1 ? "" : ""}</span>
            </div>
            {app.notes && <p className="mt-2 text-sm text-[var(--tx-2)]">{app.notes}</p>}
          </Link>
        ))}
      </div>

      {atCompany.length > 0 && (
        <div className="mt-8">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">People here</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {atCompany.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/contacts/${c.id}`}
                  className="inline-block rounded-lg border border-line px-2.5 py-1 text-[12.5px] text-[var(--tx-2)] transition-colors hover:text-[var(--tx)]"
                >
                  {c.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mail that belongs to the employer and not to any of its roles. A
          networking introduction has no application behind it, so this is the
          only place it can live - and when a role does appear, the history is
          already here rather than lost. */}
      {company.mailMessages.length > 0 && (
        <div className="mt-8">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">
            Filed against the company
          </h2>
          <ul className="mt-2 divide-y divide-[var(--line)] border-t border-line">
            {company.mailMessages.map((m) => {
              return (() => {
                const who = contactsBySender.get((m.forwardedFromEmail ?? m.fromEmail ?? "").toLowerCase()) ?? soleContact;
                const inner = (
                  <>
                    <p className="text-[13px] font-medium text-[var(--tx)]">{m.subject ?? "(no subject)"}</p>
                    <p className="mt-0.5 text-[11.5px] text-[var(--tx-3)]">
                      {m.forwardedFromEmail ?? m.fromEmail ?? "unknown sender"} · {formatDate(m.receivedAt)}
                      {who && <span className="text-accent"> · open the thread with {who.name}</span>}
                    </p>
                    {m.summary && <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--tx-2)]">{m.summary}</p>}
                  </>
                );
                return who ? (
                  <li key={m.id} className="py-3">
                    <Link href={`/contacts/${who.id}`} className="block rounded-lg px-1 -mx-1 hover:bg-[var(--surface-2)]">
                      {inner}
                    </Link>
                  </li>
                ) : (
                  <li key={m.id} className="py-3">
                    {inner}
                  </li>
                );
              })();
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
