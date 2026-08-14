import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { StatusBadge } from "@/components/StatusBadge";
import { DocContent } from "@/components/DocContent";
import { formatDate, formatDateTime } from "@/lib/format";
import { findMatchingEvents } from "@/lib/calendar";
import { buttonClass } from "@/lib/button";
import { PAGE_TITLE_RECORD } from "@/lib/type";
import { TENANT_ID } from "@/lib/tenant";

export const dynamic = "force-dynamic";

// Prep gets its own route because it is a document, not a page section: it
// renders around 11,000px, which buried every other section on the detail
// page. Having a URL also means it can be opened directly on a phone walking
// into an interview.
export default async function InterviewPrepPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const application = await prisma.jobApplication.findUnique({
    where: { id },
    include: {
      company: true,
      documents: { where: { type: "interview_prep" }, orderBy: { generatedAt: "desc" } },
      contacts: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!application) notFound();

  const versions = application.documents;
  const prep = versions[0];

  const profile = await prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { icsCalendarUrl: true } });
  const matches = await findMatchingEvents(profile?.icsCalendarUrl, application.company.id, application.company.name);
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();
  const nextMeeting = matches.filter((e) => e.start.getTime() >= nowMs).sort((a, b) => a.start.getTime() - b.start.getTime())[0];

  return (
    <div className="space-y-5">
      <div>
        <Link href={`/applications/${application.id}`} className="text-xs text-accent hover:underline">
          ← {application.company.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className={PAGE_TITLE_RECORD}>Interview prep</h1>
          <StatusBadge status={application.status} />
        </div>
        <p className="mt-1 text-sm text-[var(--tx-3)]">{application.roleTitle}</p>
      </div>

      {(nextMeeting || application.contacts.length > 0) && (
        <section className="rounded-xl border border-accent/25 bg-accent-light/50 p-4">
          {nextMeeting && (
            <p className="text-sm font-medium text-accent-dark">
              {nextMeeting.summary} · {formatDateTime(nextMeeting.start)}
            </p>
          )}
          {application.contacts.length > 0 && (
            <p className={`text-xs text-[var(--tx-2)] ${nextMeeting ? "mt-1" : ""}`}>
              {application.contacts.map((c) => `${c.name}${c.role ? ` (${c.role})` : ""}`).join(" · ")}
            </p>
          )}
        </section>
      )}

      {!prep ? (
        <section className="panel p-6 text-center shadow-sm">
          <p className="text-sm text-[var(--tx-3)]">No prep built for this role yet.</p>
          <Link
            href={`/applications/${application.id}`}
            className={buttonClass("primary", "md", "mt-3 inline-block")}
          >
            Build it on the application
          </Link>
        </section>
      ) : (
        <>
          <section className="panel p-5 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
              <span className="text-xs text-[var(--tx-3)]">Generated {formatDate(prep.generatedAt)}</span>
              <span className="flex items-center gap-3 text-xs">
                <a href={`/api/documents/${prep.id}?format=docx`} className="text-accent hover:underline">
                  .docx
                </a>
                <a href={`/api/documents/${prep.id}?format=pdf`} className="text-accent hover:underline">
                  .pdf
                </a>
              </span>
            </div>
            <DocContent content={prep.content} />
          </section>

          {versions.length > 1 && (
            <details className="group panel p-4 shadow-sm">
              <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-[var(--tx)]">
                <svg className="chevron h-3 w-3 text-[var(--tx-3)]" viewBox="0 0 8 8" fill="currentColor">
                  <path d="M1 0l6 4-6 4V0z" />
                </svg>
                {versions.length - 1} earlier {versions.length - 1 === 1 ? "version" : "versions"}
              </summary>
              <ul className="mt-3 space-y-2">
                {versions.slice(1).map((v, i) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-[var(--tx-3)]">
                      v{versions.length - 1 - i} · {formatDateTime(v.generatedAt)} ·{" "}
                      {v.content.trim().split(/\s+/).length.toLocaleString()} words
                    </span>
                    <span className="flex items-center gap-2">
                      <a href={`/api/documents/${v.id}?format=docx`} className="text-accent hover:underline">
                        .docx
                      </a>
                      <a href={`/api/documents/${v.id}?format=pdf`} className="text-accent hover:underline">
                        .pdf
                      </a>
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
