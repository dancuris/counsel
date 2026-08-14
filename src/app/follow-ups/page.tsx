import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { toggleFollowUp } from "../applications/[id]/actions";
import { PAGE_TITLE, PAGE_READING, EMPTY_BLOCK, PAGE_HEADER, PAGE_LEDE } from "@/lib/type";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Follow-ups - Counsel" };

/**
 * Everything owed, in one place, closable from here.
 *
 * Today aggregated the undated ones into a single row reading "23 follow-ups
 * with no date" and linked it to `undatedFollowUps[0].applicationId` - the
 * first one in the list. So a count of twenty-three took you to one arbitrary
 * role, and the other twenty-two were reachable only by remembering which
 * applications they were filed against.
 *
 * The dated ones already appear individually on Today, because a date is a
 * commitment to a person on a day. This page is where the whole backlog lives,
 * and it is the only place that can honestly answer "what do I owe".
 */
export default async function FollowUpsPage() {
  const followUps = await prisma.followUp.findMany({
    where: { completed: false, application: { deletedAt: null } },
    include: { application: { include: { company: true } } },
    orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
  });

  // Request-time "now" - this page is force-dynamic (never statically cached),
  // so a per-request value is safe despite the rule's general no-impure-calls
  // guidance. Same reasoning as /pipeline.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const overdue = followUps.filter((f) => f.dueDate && f.dueDate.getTime() < now);
  const scheduled = followUps.filter((f) => f.dueDate && f.dueDate.getTime() >= now);
  const undated = followUps.filter((f) => !f.dueDate);

  const groups = [
    { label: "Overdue", rows: overdue, tone: true },
    { label: "Scheduled", rows: scheduled, tone: false },
    { label: "No date", rows: undated, tone: false },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className={PAGE_READING}>
      <section className={PAGE_HEADER}>
        <h1 className={PAGE_TITLE}>
          {followUps.length === 0 ? (
            "Nothing owed."
          ) : (
            <>
              {followUps.length} follow-up{followUps.length === 1 ? "" : "s"} open.
              {overdue.length > 0 && (
                <>
                  <br />
                  <span className="text-[var(--amber)]">{overdue.length} overdue.</span>
                </>
              )}
            </>
          )}
        </h1>
        <p className={`${PAGE_LEDE} max-w-[52ch]`}>
          Everything you have committed to. A dated one surfaces on Today as its day approaches; an undated one
          is backlog and stays here until you give it a date or close it.
        </p>
      </section>

      {groups.map((g) => (
        <section key={g.label}>
          <h2 className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-line bg-[var(--bg)]/85 px-1 py-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--tx-3)] backdrop-blur">
            {g.label}
            <span className="font-normal normal-case tracking-normal">{g.rows.length}</span>
          </h2>
          <ul className="divide-y divide-[var(--line)]">
            {g.rows.map((f) => (
              <li key={f.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1.5 px-1 py-4">
                <Link
                  href={`/applications/${f.applicationId}`}
                  className="flex min-w-0 flex-1 basis-full flex-col gap-0.5 transition-opacity hover:opacity-60 sm:basis-auto"
                >
                  <span className="text-[15px] font-medium tracking-[-0.01em]">{f.application.company.name}</span>
                  <span className="text-[13.5px] text-[var(--tx-2)]">{f.note}</span>
                  <span className="text-[11.5px] text-[var(--tx-3)]">{f.application.roleTitle}</span>
                </Link>
                {f.dueDate && (
                  <span className={`shrink-0 text-[12.5px] ${g.tone ? "text-[var(--amber)]" : "text-[var(--tx-3)]"}`}>
                    {formatDate(f.dueDate)}
                  </span>
                )}
                {/* Closable from here: a list of what you owe that cannot be
                    cleared is a list you stop opening. */}
                <form action={toggleFollowUp.bind(null, f.id, f.applicationId, true)} className="shrink-0">
                  <SubmitButton className="rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-[var(--tx-2)] transition-colors hover:text-[var(--tx)]">
                    Done
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {followUps.length === 0 && (
        <p className={EMPTY_BLOCK}>
          Nothing is waiting on you. Follow-ups are added from a role&apos;s page.
        </p>
      )}
    </div>
  );
}
