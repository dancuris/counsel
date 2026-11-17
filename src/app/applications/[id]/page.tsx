import { Suspense } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { StatusForm } from "@/components/StatusForm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { connectedMailboxes } from "@/lib/mail-provider";
import { newestPart, groupByThread } from "@/lib/mail-thread";
import { DOCUMENT_FILENAME_LABELS, type DocumentType } from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { FollowUpLine } from "@/components/FollowUpLine";
import { ConfirmButton } from "@/components/ConfirmButton";
import { followUpFor } from "@/lib/follow-up";
import { effectiveSender } from "@/lib/mail-sender";
import { RecommendationBadge } from "@/components/RecommendationBadge";
import { formatDate, formatDateTime, formatFileSize } from "@/lib/format";
import {
  updateApplicationDetails,
  updateStatus,
  updateNotes,
  saveJobDescription,
  addContact,
  updateContact,
  deleteContact,
  addInterviewNote,
  addFollowUp,
  toggleFollowUp,
  setFollowUpDueDate,
  uploadFile,
  deleteUploadedFile,
  saveApplicationAnswer,
  deleteApplicationAnswer,
} from "./actions";
import { MeetingsPanel, MeetingsPanelFallback } from "./MeetingsPanel";
import { EvaluateButton } from "./EvaluateButton";
import { GenerateDocumentsButton } from "./GenerateDocumentsButton";
import { GenerateInterviewPrepButton } from "./GenerateInterviewPrepButton";
import { DocumentEditor } from "@/components/DocumentEditor";
import { DrivePicker } from "@/components/DrivePicker";
import { LinkedInMatch } from "@/components/LinkedInMatch";
import { CorrespondenceDraftForm } from "./CorrespondenceDraftForm";
import { InboundRequestForm } from "./InboundRequestForm";
import { restoreDocumentVersion } from "./document-actions";
import { CorrespondenceEditor } from "./CorrespondenceEditor";
import { DeleteApplicationButton } from "./DeleteApplicationButton";
import { RoleSwitcher } from "./RoleSwitcher";
import { QuickActionBox } from "./QuickActionBox";
import { FindPostingButton } from "./FindPostingButton";
import { unlinkMail, refileMail, addContactFromMail } from "@/app/inbox/actions";
import { ApplicationPicker } from "@/components/ApplicationPicker";
import { ApplicationAnswers } from "@/components/ApplicationAnswers";
import { parseLabelled } from "@/lib/contact-block";
import { MAIL_CATEGORY_LABELS, type MailCategory } from "@/lib/constants";
import { CollapsibleSections, Panel } from "@/components/CollapsibleSections";
import { panelInTab, resolveTab } from "@/lib/app-tabs";
import { driveFolderUrl } from "@/lib/drive-links";
import { getApplicationActivity } from "@/lib/activity";
import { describeSplit } from "@/lib/verdict-split";
import { modelLabel } from "@/lib/reviewer";
import { DEFAULT_MODEL } from "@/lib/models";
import { CompareDrafts } from "@/components/CompareDrafts";
import { ActivityTimeline } from "@/components/ActivityTimeline";
import { buttonClass, inputClass } from "@/lib/button";
import { PAGE_TITLE_RECORD, EMPTY_INLINE } from "@/lib/type";
import { TENANT_ID } from "@/lib/tenant";
import { NOT_DELETED } from "@/lib/data/applications";

export const dynamic = "force-dynamic";

// Attachments are stored as document references, so the filename shown here is
// derived the same way the send route derives it. Showing the name matters:
// the whole point of the confirm step is seeing what actually goes out.
function attachmentNamesFor(
  raw: string | null,
  documents: { id: string; type: string }[],
  companyName: string
): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const slug = companyName.replace(/[^a-zA-Z0-9]+/g, "");
    return parsed.flatMap((a: { documentId?: string; format?: string }) => {
      const doc = documents.find((d) => d.id === a?.documentId);
      if (!doc) return [];
      const label = DOCUMENT_FILENAME_LABELS[doc.type as DocumentType] ?? "Document";
      return [`Dan_Curis_${label}_${slug}.${a?.format === "pdf" ? "pdf" : "docx"}`];
    });
  } catch {
    return [];
  }
}

export default async function ApplicationDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; doc?: string; review?: string }>;
}) {
  const { id } = await params;
  // The tab lives in the URL rather than in localStorage, so the page can
  // build only the panels it is about to show. It used to hand all twelve to
  // a client component that picked three: every tab was rendered and
  // serialized on every load, which was most of this page's weight.
  //
  // Two things come free with the move. The back button works, and a link to
  // a role's Talk tab is a link somebody can actually open.
  const sp = await searchParams;
  const activeTab = resolveTab(sp.tab);
  // Which document is expanded, and whether to review it on arrival.
  //
  // The review lives inside a document because that is where the refine it
  // feeds is, but that put the only surface that can actually fix anything
  // behind a disclosure triangle, while the read-only comparison sat in the
  // top action row. Dan used the one he could see, which is the same fault as
  // the Ask button he could not find: a control he cannot see does not exist.
  //
  // In the URL rather than client state so the top row can link to it, the
  // back button works, and a link to a role's resume review is shareable with
  // himself on a phone.
  const openDoc = sp.doc ?? null;
  const autoReview = sp.review === "1";
  const shows = (panelId: string) => panelInTab(panelId, activeTab);

  // One round trip, not five. These queries do not depend on each other, and
  // run in series they simply added their latencies together before anything
  // could render.
  const [application, profile, activity, allApplications, allContacts, mailboxes] = await Promise.all([
    prisma.jobApplication.findUnique({
      where: { id },
      include: {
        company: {
          include: {
            applications: { where: { deletedAt: null }, select: { id: true, roleTitle: true, status: true }, orderBy: { updatedAt: "desc" } },
          },
        },
        jobDescriptions: { orderBy: { pastedAt: "desc" }, take: 1 },
        evaluations: { orderBy: { generatedAt: "desc" }, take: 6 },
        documents: { orderBy: { generatedAt: "desc" } },
        contacts: { orderBy: { createdAt: "desc" } },
        interviewNotes: { orderBy: { createdAt: "desc" }, include: { interviewers: true } },
        followUps: { orderBy: { createdAt: "desc" } },
        correspondence: { orderBy: { createdAt: "desc" } },
        uploadedFiles: {
          orderBy: { uploadedAt: "desc" },
          select: { id: true, fileName: true, mimeType: true, size: true, uploadedAt: true },
        },
        mailMessages: { orderBy: { receivedAt: "desc" } },
        applicationAnswers: { orderBy: { createdAt: "desc" } },
      },
    }),
    // One read of the profile, not two: the calendar URL and the contact
    // labels live on the same singleton row.
    prisma.profile.findUnique({
      where: { id: TENANT_ID },
      select: { icsCalendarUrl: true, contactAddresses: true, contactEmails: true, preferredModel: true },
    }),
    getApplicationActivity(id),
    // Needed so a message filed against the wrong role can be moved without
    // going hunting for it.
    prisma.jobApplication.findMany({
      where: { ...NOT_DELETED, NOT: { id } },
      include: { company: true },
      orderBy: { updatedAt: "desc" },
    }),
    // Every contact, not just this role's: the same recruiter writes about
    // more than one role, and a sender filed elsewhere is still reachable.
    prisma.contact.findMany({ where: { email: { not: null } }, select: { id: true, name: true, email: true } }),
    connectedMailboxes(),
  ]);

  if (!application) notFound();

  // What the model picker says when nothing is overridden, so the control
  // names the model that will actually run rather than the word "model".
  const defaultModelLabel = modelLabel(profile?.preferredModel || DEFAULT_MODEL);
  const addressLabels = parseLabelled(profile?.contactAddresses).map((a) => a.label);
  const emailLabels = parseLabelled(profile?.contactEmails).map((e) => e.label);

  // Inbound and outbound in one timeline. A draft is dated by when it was
  // written and a sent message by when it left, so a reply sits beside the
  // message it answers.
  type ThreadEntry =
    | { kind: "received"; at: Date; mail: (typeof application.mailMessages)[number] }
    | { kind: "outbound"; at: Date; item: (typeof application.correspondence)[number] };
  // Who a received message is from, as a contact. The Messages panel could
  // show a recruiter's email and offer only "move it" or "unfile it" - there
  // was no way to answer the person, which is the one thing you open a message
  // to do. Rather than build a second composer here, the message links to the
  // contact page, where the thread and the editor already live.
  //
  // Matched across ALL contacts, not the ones filed against this role: the two
  // AT&T roles each hold one of the two AT&T people, and a recruiter who wrote
  // about one role is still the same person when they write about the other.
  const contactByEmail = new Map<string, { id: string; name: string }>();
  for (const c of allContacts) {
    if (c.email) contactByEmail.set(c.email.trim().toLowerCase(), { id: c.id, name: c.name });
  }

  // Dan's own addresses. Most of this mailbox is forwards from himself, and
  // where the forward wraps his own reply there is no original sender to
  // recover, so `fromEmail` falls back to him. Without this the panel offered
  // "Add sender as contact" for Dan, on his own messages - which is both wrong
  // and what made the whole panel read as having no way to reply.
  const ownAddresses = new Set(
    parseLabelled(profile?.contactEmails)
      .map((e) => e.value.trim().toLowerCase())
      .concat(mailboxes.map((b) => b.email.trim().toLowerCase()))
      .filter(Boolean)
  );

  const senderOf = (mail: { fromEmail: string | null; forwardedFromEmail: string | null }) =>
    effectiveSender(mail) ?? "";
  const isFromDan = (mail: { fromEmail: string | null; forwardedFromEmail: string | null }) =>
    ownAddresses.has(senderOf(mail));
  const contactFor = (mail: { fromEmail: string | null; forwardedFromEmail: string | null }) =>
    contactByEmail.get(senderOf(mail)) ?? null;

  // Gmail already threaded these - all five AT&T forwards share one threadId -
  // so the grouping is a lookup rather than a guess. Numbering them tells you
  // where in the conversation you are without reading the quoted history that
  // `newestPart` just removed.
  const mailThreads = groupByThread(
    application.mailMessages.map((m) => ({ id: m.id, threadId: m.threadId, receivedAt: m.receivedAt }))
  );
  const threadPosition = new Map<string, { index: number; total: number }>();
  for (const t of mailThreads) {
    const oldestFirst = [...t.messages].reverse();
    oldestFirst.forEach((m, i) => threadPosition.set(m.id, { index: i + 1, total: t.messages.length }));
  }

  const thread: ThreadEntry[] = [
    ...application.mailMessages.map((mail) => ({ kind: "received" as const, at: mail.receivedAt, mail })),
    ...application.correspondence.map((item) => ({ kind: "outbound" as const, at: item.sentAt ?? item.createdAt, item })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  // Request-time "now" to split notes into upcoming/past - this page is
  // force-dynamic (never statically cached), so a per-request value is safe
  // despite the rule's general no-impure-calls-during-render guidance.
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  const upcomingNotes = application.interviewNotes
    .filter((n) => n.date && n.date.getTime() >= nowMs)
    .sort((a, b) => a.date!.getTime() - b.date!.getTime());
  const pastNotes = application.interviewNotes
    .filter((n) => !n.date || n.date.getTime() < nowMs)
    .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

  function renderInterviewNote(n: (typeof upcomingNotes)[number]) {
    return (
      <li key={n.id} id={`note-${n.id}`} className="text-sm">
        <p className="font-medium text-[var(--tx)]">
          {n.roundName} {n.date && <span className="font-normal text-[var(--tx-3)]">- {formatDateTime(n.date)}</span>}
        </p>
        {n.interviewers.length > 0 && (
          <p className="text-xs text-[var(--tx-3)]">Spoke with: {n.interviewers.map((iv) => iv.name).join(", ")}</p>
        )}
        <p className="text-[var(--tx-2)]">{n.notes}</p>
        {n.calendarConflict && <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">⚠️ {n.calendarConflict}</p>}
      </li>
    );
  }

  const latestJd = application.jobDescriptions[0];
  const latestEval = application.evaluations[0];
  // A second opinion is only worth running if you can see both. Keep the most
  // recent verdict from each model rather than only the newest overall, which
  // hid whichever of a concurrent pair happened to finish first.
  const verdictByModel = new Map<string, (typeof application.evaluations)[number]>();
  for (const e of application.evaluations) if (!verdictByModel.has(e.model)) verdictByModel.set(e.model, e);
  const verdicts = [...verdictByModel.values()];
  const others = verdicts.filter((e) => e.id !== latestEval?.id);
  // Derived from the rows rather than passed back from the evaluate call, so it
  // survives the refresh that call triggers and is still there tomorrow.
  const split = describeSplit(latestEval, others[0]);
  const strengths: string[] = latestEval ? JSON.parse(latestEval.strengths) : [];
  const gaps: string[] = latestEval ? JSON.parse(latestEval.gaps) : [];
  const latestPrep = application.documents.find((d) => d.type === "interview_prep");
  // Newest of each, which is what a comparison is against.
  const currentResume = application.documents.find((d) => d.type === "resume");
  const currentCoverLetter = application.documents.find((d) => d.type === "cover_letter");

  // Documents arrive newest-first, so the head of each type's list is the
  // current one and everything behind it is history. Both generating and
  // saving an edit append a row, so this is the whole version story.
  const DOC_TYPE_ORDER = ["recruiter_response", "resume", "cover_letter", "interview_prep", "job_description"];
  const documentsByType = new Map<string, typeof application.documents>();
  for (const doc of application.documents) {
    const list = documentsByType.get(doc.type) ?? [];
    list.push(doc);
    documentsByType.set(doc.type, list);
  }
  const documentGroups = [...documentsByType.entries()].sort((a, b) => {
    const ai = DOC_TYPE_ORDER.indexOf(a[0]);
    const bi = DOC_TYPE_ORDER.indexOf(b[0]);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const boundUpdateStatus = updateStatus.bind(null, application.id);
  const boundUpdateNotes = updateNotes.bind(null, application.id);
  const boundSaveJd = saveJobDescription.bind(null, application.id);
  const boundAddContact = addContact.bind(null, application.id);
  const boundAddInterviewNote = addInterviewNote.bind(null, application.id);
  const boundAddFollowUp = addFollowUp.bind(null, application.id);
  const boundUploadFile = uploadFile.bind(null, application.id);

  // Reuses the set built above rather than reading the profile again: a
  // forward of his own note must not read as somebody having written to him.
  const followUp = followUpFor(application, ownAddresses, new Date());

  return (
    <div className="space-y-8">
      <div>
        <RoleSwitcher
          companyId={application.company.id}
          companyName={application.company.name}
          roles={application.company.applications}
          currentId={application.id}
        />
        <h1 className={PAGE_TITLE_RECORD}>{application.roleTitle}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-[var(--tx-3)]">
          <StatusBadge status={application.status} />
          {/* The verdict is the punchline of the whole page, so it sits with the
              status rather than waiting in a panel below the fold. The panel
              still carries the reasoning, strengths and gaps. */}
          {latestEval && (
            <Link href="#section-evaluation" className="transition-opacity hover:opacity-80">
              <RecommendationBadge recommendation={latestEval.recommendation} />
            </Link>
          )}
          {application.salaryRange && <span>{application.salaryRange}</span>}
          {application.lastCheckedAt && <span>Last checked {formatDate(application.lastCheckedAt)}</span>}
          {/* Once anything has been filed for this role the folder id is known,
              so the label becomes the way into it. Before that it is still just
              the name Dan gave the company's folder. */}
          {application.driveFolderId ? (
            <a
              href={driveFolderUrl(application.driveFolderId)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Drive folder
            </a>
          ) : (
            application.company.driveFolderName && (
              <span className="text-[var(--tx-3)]">Drive folder: {application.company.driveFolderName}</span>
            )
          )}
        </div>
        {/* Where this stands on following up. It sits under the status row
            because it is a statement about the role, like the verdict, rather
            than an item in a list of things. */}
        <div className="mt-2">
          <FollowUpLine
            state={followUp}
            applicationId={application.id}
            contacts={application.contacts.map((c) => ({ id: c.id, name: c.name, role: c.role }))}
          />
        </div>
        {/* Apply goes to the employer's own posting, not a LinkedIn wrapper.
            "Find the real posting" resolves it from the company's ATS. */}
        <div className="mt-3">
          <FindPostingButton
            applicationId={application.id}
            postingLink={application.postingLink}
            status={application.status}
            documents={documentGroups
              .filter(([type]) => type === "resume" || type === "cover_letter")
              .map(([type, versions]) => ({ id: versions[0].id, type }))}
          />
        </div>

        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-accent hover:underline">Edit role / company</summary>
          {/* Same reason: an evaluation writes salaryRange and three paths
              write postingLink, so this form can be showing values the database
              no longer holds. Keyed on what it edits, so it repaints when any
              of them changes underneath. */}
          <form
            action={updateApplicationDetails.bind(null, application.id, application.company.id)}
            className="mt-2 grid max-w-xl grid-cols-1 gap-2 sm:grid-cols-2"
            key={`${application.company.name}|${application.roleTitle}|${application.salaryRange ?? ""}|${application.postingLink ?? ""}`}
          >
            <div>
              <label className="text-xs font-medium text-[var(--tx-2)]">Company name</label>
              <input
                name="companyName"
                defaultValue={application.company.name}
                className={`mt-1 ${inputClass("md")}`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--tx-2)]">Role title</label>
              <input
                name="roleTitle"
                defaultValue={application.roleTitle}
                required
                className={`mt-1 ${inputClass("md")}`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--tx-2)]">Salary range</label>
              <input
                name="salaryRange"
                defaultValue={application.salaryRange ?? ""}
                className={`mt-1 ${inputClass("md")}`}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-[var(--tx-2)]">Posting link</label>
              <input
                name="postingLink"
                defaultValue={application.postingLink ?? ""}
                className={`mt-1 ${inputClass("md")}`}
              />
            </div>
            <div className="sm:col-span-2">
              <SubmitButton className={buttonClass("primary", "md")} pendingLabel="Saving...">Save</SubmitButton>
            </div>
          </form>
        </details>
        <div className="mt-2">
          <DeleteApplicationButton
            applicationId={application.id}
            companyId={application.company.id}
            companyName={application.company.name}
            roleTitle={application.roleTitle}
          />
        </div>
      </div>

      <QuickActionBox applicationId={application.id} />

      {/* Counts are passed rather than summed from the panels, because the
          panels for the other two tabs no longer exist to be summed. A tab you
          are not standing on must still show what is behind it: a role last
          left on Talk otherwise reads as having no history at all. */}
      <CollapsibleSections
        applicationId={application.id}
        active={activeTab}
        counts={{
          work: application.documents.length + application.uploadedFiles.length,
          talk:
            thread.length +
            application.contacts.length +
            application.interviewNotes.length +
            application.followUps.length,
          history: activity.length,
        }}
      >
          {shows("status") && (
          <Panel id="status" title="Status & notes">
            <StatusForm
              key={application.status}
              action={boundUpdateStatus}
              status={application.status}
              lastCheckedAt={application.lastCheckedAt ? application.lastCheckedAt.toISOString().slice(0, 10) : ""}
            />
            <p className="mt-1 text-xs text-[var(--tx-3)]">
              The date is whatever you set here (e.g. when you actually applied) - it doesn&apos;t auto-update.
            </p>
            {/* Keyed on the notes themselves. Several code paths append to
                this field - a status moved by mail, a pass verdict, an import -
                and an uncontrolled textarea keeps whatever it first rendered.
                Saving a stale box would delete the reason the status changed. */}
            <form action={boundUpdateNotes} className="mt-4" key={application.notes ?? "no-notes"}>
              <textarea
                name="notes"
                defaultValue={application.notes ?? ""}
                rows={3}
                className="w-full rounded border border-line-2 p-2 text-sm"
                placeholder="Notes..."
              />
              <SubmitButton className="mt-2 rounded border border-line-2 px-3 py-1 text-sm hover:bg-[var(--surface-2)]">Save notes</SubmitButton>
            </form>
          </Panel>
          )}

          {shows("jd") && (
          <Panel id="jd" title="Job description">
            {/* Sits above the textarea because for 58 of 88 roles the textarea
                is empty, and searching is the faster way to fill it than going
                to find the posting yourself. */}
            <LinkedInMatch applicationId={application.id} hasJd={Boolean(latestJd?.rawText?.trim())} />
            {/* Keyed on the stored description so it repaints when one is
                attached from LinkedIn. An uncontrolled textarea keeps whatever
                it first rendered, so the description saved fine and the box
                stayed empty - which reads as "it did not save". */}
            <form action={boundSaveJd} className="mt-3" key={latestJd?.id ?? "no-jd"}>
              <textarea
                name="rawText"
                defaultValue={latestJd?.rawText ?? ""}
                rows={8}
                className="w-full rounded border border-line-2 p-2 text-sm font-mono"
                placeholder="Paste the job description here..."
              />
              <div className="mt-2 flex gap-2">
                <SubmitButton className="rounded border border-line-2 px-3 py-1 text-sm hover:bg-[var(--surface-2)]" pendingLabel="Saving...">Save</SubmitButton>
              </div>
            </form>
            <div className="mt-3">
              <EvaluateButton defaultModelLabel={defaultModelLabel} applicationId={application.id} hasJobDescription={!!latestJd} />
              {latestJd && <p className="mt-1 text-xs text-[var(--tx-3)]">Saved as a docx/pdf under Documents too.</p>}
            </div>
          </Panel>
          )}

          {latestEval && shows("evaluation") && (
            <Panel id="evaluation" title="Fit evaluation">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <RecommendationBadge recommendation={latestEval.recommendation} />
                <span className="text-[11px] text-[var(--tx-3)]">
                  {latestEval.model} · {formatDate(latestEval.generatedAt)}
                </span>
              </div>
              {/* Where the two providers land differently, say which way and
                  what to do about it. The "disagrees" chip further down states
                  that they differ, which reads the same whether the second
                  opinion was warmer or colder - and those call for opposite
                  actions. */}
              {split && (
                <p className="mt-2 border-l-2 border-amber-line pl-2.5 text-[13px] leading-relaxed text-[var(--tx-2)]">
                  <span className="font-medium text-[var(--amber)]">Split verdict.</span> {split.meaning}
                </p>
              )}
              <p className="mt-2 text-sm text-[var(--tx-2)]">{latestEval.fitSummary}</p>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase text-[var(--tx-3)]">Strengths</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-[var(--tx-2)]">
                    {strengths.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase text-[var(--tx-3)]">Gaps</h3>
                  <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-[var(--tx-2)]">
                    {gaps.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {others.length > 0 && (
                <div className="mt-4 border-t border-line pt-3">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--tx-3)]">
                    Also evaluated by
                  </p>
                  {others.map((e) => {
                    const disagrees = e.recommendation !== latestEval.recommendation;
                    return (
                      <div key={e.id} className="mt-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <RecommendationBadge recommendation={e.recommendation} />
                          <span className="text-[11px] text-[var(--tx-3)]">
                            {e.model} · {formatDate(e.generatedAt)}
                          </span>
                          {disagrees && (
                            <span className="rounded-full border border-amber-line bg-[var(--amber-dim)] px-2 py-0.5 text-[10px] font-medium text-[var(--amber)]">
                              disagrees
                            </span>
                          )}
                        </div>
                        <p className="mt-1.5 text-sm text-[var(--tx-2)]">{e.fitSummary}</p>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {shows("prep") && (
          <Panel id="prep" title="Interview prep">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {latestPrep && (
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-[var(--tx-3)]">{formatDate(latestPrep.generatedAt)}</span>
                  <a href={`/api/documents/${latestPrep.id}?format=docx`} className="text-accent hover:underline">
                    .docx
                  </a>
                  <a href={`/api/documents/${latestPrep.id}?format=pdf`} className="text-accent hover:underline">
                    .pdf
                  </a>
                </div>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--tx-3)]">
              Role snapshot, positioning, focus areas with prepared answers, tough questions, STAR stories, and questions to ask them.
            </p>
            {/* The prep document lives on its own route rather than inline: at
                ~11,000px it buried every section below it on this page. */}
            {latestPrep && (
              <Link
                href={`/applications/${application.id}/prep`}
                className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-accent/25 bg-accent-light/40 px-3 py-2.5 transition-colors hover:border-accent/50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-accent-dark">Open the prep</span>
                  <span className="block text-xs text-[var(--tx-3)]">
                    {latestPrep.content.trim().split(/\s+/).length.toLocaleString()} words · updated{" "}
                    {formatDate(latestPrep.generatedAt)}
                  </span>
                </span>
                <span aria-hidden className="text-accent">
                  →
                </span>
              </Link>
            )}
            <div className="mt-3">
              <GenerateInterviewPrepButton
                applicationId={application.id}
                hasJobDescription={!!latestJd}
                hasExistingPrep={!!latestPrep}
              />
            </div>
          </Panel>
          )}

          {shows("activity") && (
          <Panel id="activity" title="Activity" badge={`${activity.length}`}>
            <p className="mb-3 text-xs text-[var(--tx-3)]">
              Every version and change, newest first. Most of it is read back off the records
              themselves, so it covers this role from the day it was added.
            </p>
            <div className="max-h-[28rem] overflow-y-auto pr-1">
              <ActivityTimeline items={activity} />
            </div>
          </Panel>
          )}

          {shows("documents") && (
          <Panel id="documents" title="Documents" isEmpty={application.documents.length === 0} badge={`${application.documents.length}`}>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <GenerateDocumentsButton
                defaultModelLabel={defaultModelLabel}
                applicationId={application.id}
                hasJobDescription={!!latestJd}
                addressLabels={addressLabels}
                emailLabels={emailLabels}
              />
              {/* Generating is not the only way a role gets documents: plenty
                  already exist in Drive, written before Counsel or filed
                  somewhere the reconciliation would not guess at. */}
              <DrivePicker applicationId={application.id} />
              {/* The two "Review the ..." links that sat here are gone. They
                  were a patch for the review being hard to find, and they
                  added two more buttons to a row that already had too many.
                  Each document now states its own status and offers its own
                  next action, so there is nothing left for them to solve.
                  ?doc=<type>&review=1 still works as a link. */}
              {/* Only where there is a pair to compare against, and only with
                  a posting to draft from - the alternative is generated from
                  the job description like any other draft. */}
              {currentResume?.content.trim() && currentCoverLetter && latestJd && (
                <CompareDrafts
                  applicationId={application.id}
                  resumeDocId={currentResume.id}
                  coverLetterDocId={currentCoverLetter.id}
                  currentResume={currentResume.content}
                  currentCoverLetter={currentCoverLetter.content}
                  currentModel={currentResume.model}
                />
              )}
            </div>
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {documentGroups.length === 0 && (
                <li className="py-2 text-sm text-[var(--tx-3)]">No documents generated yet.</li>
              )}
              {documentGroups.map(([type, versions]) => {
                const current = versions[0];
                const older = versions.slice(1);
                return (
                  <li key={type} className="py-2 text-sm">
                    {/* `undefined`, not `false`, when this is not the requested document.
                        Passing false makes React manage the attribute, and a
                        router.refresh() after saving could then snap shut a
                        document Dan had opened by hand. Undefined leaves it
                        uncontrolled, exactly as it was before the URL could
                        open one. */}
                    <details className="group" open={openDoc === type || undefined} id={`doc-${type}`}>
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                        <span className="flex items-center gap-2">
                          <svg className="chevron h-3 w-3 shrink-0 text-[var(--tx-3)]" viewBox="0 0 8 8" fill="currentColor">
                            <path d="M1 0l6 4-6 4V0z" />
                          </svg>
                          <span className="capitalize">
                            {type.replace(/_/g, " ")}
                            {current.isAtsSafe ? " (ATS-safe)" : ""}
                          </span>
                          {older.length > 0 && (
                            <span className="rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--tx-3)]">
                              v{versions.length}
                            </span>
                          )}
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="text-[var(--tx-3)]">{formatDate(current.generatedAt)}</span>
                          <span className="text-xs text-accent group-open:hidden">Edit</span>
                        </span>
                      </summary>

                      <DocumentEditor
                        documentId={current.id}
                        applicationId={application.id}
                        initialContent={current.content}
                        driveFileIdDocx={current.driveFileIdDocx}
                        driveFileIdPdf={current.driveFileIdPdf}
                        writtenBy={current.model}
                        autoReview={autoReview && openDoc === type}
                      />

                      {older.length > 0 && (
                        <details className="group/v mt-3 border-t border-line pt-2">
                          <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-[var(--tx-3)] hover:text-accent">
                            <svg className="chevron h-2.5 w-2.5 text-[var(--tx-3)]" viewBox="0 0 8 8" fill="currentColor">
                              <path d="M1 0l6 4-6 4V0z" />
                            </svg>
                            {older.length} earlier {older.length === 1 ? "version" : "versions"}
                          </summary>
                          <ul className="mt-2 space-y-1.5">
                            {older.map((v, i) => (
                              <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                <span className="text-[var(--tx-3)]">
                                  v{older.length - i} · {formatDateTime(v.generatedAt)} ·{" "}
                                  {v.content.trim().split(/\s+/).length.toLocaleString()} words
                                </span>
                                <span className="flex items-center gap-2">
                                  {/* Downloads only. No Drive link on purpose:
                                      there is one Drive file per document type
                                      and it always holds the current version,
                                      so a link here would open something other
                                      than the version this row describes.
                                      Restore first, which pushes it to Drive. */}
                                  <a href={`/api/documents/${v.id}?format=docx`} className="text-accent hover:underline">
                                    .docx
                                  </a>
                                  <a href={`/api/documents/${v.id}?format=pdf`} className="text-accent hover:underline">
                                    .pdf
                                  </a>
                                  <form action={restoreDocumentVersion.bind(null, v.id, application.id)}>
                                    <SubmitButton
                                      className="rounded border border-line-2 px-1.5 py-0.5 hover:bg-[var(--surface-2)]"
                                      pendingLabel="Restoring..."
                                    >
                                      Restore
                                    </SubmitButton>
                                  </form>
                                </span>
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </details>
                  </li>
                );
              })}
            </ul>
          </Panel>
          )}

          {/* One thread. Mail that arrived and mail that went out are the same
              conversation, and keeping them in two panels - in two different
              columns - meant a reply sat nowhere near the message it answered. */}
          {shows("messages") && (
          <Panel
            id="messages"
            title="Messages"
            isEmpty={thread.length === 0}
            badge={thread.length ? String(thread.length) : undefined}
          >
            <p className="mt-0.5 text-xs text-[var(--tx-3)]">
              Everything received from the connected mailbox and everything drafted or sent for this role, in order.
            </p>

            <div className="mt-3 rounded-lg border border-accent/20 bg-accent-light/40 p-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-accent-dark">Something came in</h3>
              <div className="mt-2">
                <InboundRequestForm applicationId={application.id} />
              </div>
            </div>

            <div className="mt-4">
              <CorrespondenceDraftForm
                applicationId={application.id}
                contacts={application.contacts.map((c) => ({ id: c.id, name: c.name, role: c.role }))}
              />
            </div>

            <div className="mt-5 space-y-5">
              {thread.length === 0 && <p className={EMPTY_INLINE}>Nothing yet.</p>}

              {thread.map((entry) =>
                entry.kind === "received" ? (
                  <div
                    key={`m-${entry.mail.id}`}
                    className={`border-l-2 pl-3 ${
                      entry.mail.direction === "sent" ? "border-[var(--amber)]" : "border-line-2"
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          entry.mail.direction === "sent"
                            ? "border-amber-line bg-[var(--amber-dim)] text-[var(--amber)]"
                            : "border-line bg-[var(--surface-2)] text-[var(--tx-2)]"
                        }`}
                      >
                        {entry.mail.direction === "sent"
                          ? "Sent"
                          : isFromDan(entry.mail)
                            ? "You forwarded this"
                            : "Received"}
                      </span>
                      {entry.mail.category && (
                        <span className="text-[10px] text-[var(--tx-3)]">
                          {MAIL_CATEGORY_LABELS[entry.mail.category as MailCategory] ?? entry.mail.category}
                        </span>
                      )}
                      {(threadPosition.get(entry.mail.id)?.total ?? 1) > 1 && (
                        <span
                          className="rounded-full border border-line px-2 py-0.5 text-[10px] text-[var(--tx-3)]"
                          title="This conversation arrived as several forwards"
                        >
                          thread {threadPosition.get(entry.mail.id)!.index} of{" "}
                          {threadPosition.get(entry.mail.id)!.total}
                        </span>
                      )}
                    </span>
                    <p className="mt-1 truncate text-sm font-medium text-[var(--tx)]">{entry.mail.subject}</p>
                    <p className="truncate text-xs text-[var(--tx-3)]">
                      {entry.mail.direction === "sent" || isFromDan(entry.mail)
                        ? "you"
                        : (entry.mail.forwardedFromName ?? entry.mail.forwardedFromEmail ?? entry.mail.fromEmail)}{" "}
                      ·{" "}
                      {formatDateTime(entry.mail.receivedAt)}
                    </p>
                    {entry.mail.summary && <p className="mt-1.5 text-sm text-[var(--tx-2)]">{entry.mail.summary}</p>}
                    {/* Only Claude's summary was shown, which is fine for
                        scanning and useless for answering: you cannot write a
                        reply to a message you cannot read. */}
                    {newestPart(entry.mail.body) && (
                      <details className="mt-1.5 group/mail">
                        <summary className="cursor-pointer list-none text-[11.5px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]">
                          <span className="group-open/mail:hidden">Read the message</span>
                          <span className="hidden group-open/mail:inline">Hide the message</span>
                        </summary>
                        <p className="mt-1.5 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-line bg-[var(--surface-2)] p-3 text-[12.5px] leading-relaxed text-[var(--tx-2)]">
                          {newestPart(entry.mail.body)}
                        </p>
                      </details>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <form action={refileMail.bind(null, entry.mail.id, application.id)} className="min-w-[220px] flex-1">
                        <ApplicationPicker
                          applications={allApplications.map((a) => ({ id: a.id, company: a.company.name, role: a.roleTitle }))}
                          suggestCompany={entry.mail.detectedCompany}
                          suggestRole={entry.mail.detectedRole}
                          submitLabel="Move to this role"
                        />
                      </form>
                      {entry.mail.direction !== "sent" &&
                        !isFromDan(entry.mail) &&
                        (contactFor(entry.mail) ? (
                          <Link
                            href={`/contacts/${contactFor(entry.mail)!.id}`}
                            className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-[var(--tx-2)] transition-colors hover:text-[var(--tx)]"
                          >
                            Reply to {contactFor(entry.mail)!.name}
                          </Link>
                        ) : (
                          <form action={addContactFromMail.bind(null, entry.mail.id)}>
                            <SubmitButton className="rounded-lg border border-line px-2.5 py-1 text-xs text-[var(--tx-2)] transition-colors hover:text-[var(--tx)]">
                              Add sender as contact
                            </SubmitButton>
                          </form>
                        ))}
                      <form action={unlinkMail.bind(null, entry.mail.id, application.id)}>
                        <SubmitButton className="text-xs text-[var(--tx-3)] hover:text-accent hover:underline">
                          Send back to Inbox
                        </SubmitButton>
                      </form>
                    </div>

                    <details className="mt-2">
                      <summary className="cursor-pointer list-none text-xs text-[var(--tx-3)] hover:text-accent">
                        Read the message
                      </summary>
                      <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded bg-[var(--surface-2)] p-3 text-xs text-[var(--tx-2)]">
                        {entry.mail.body.slice(0, 6000)}
                      </pre>
                    </details>
                  </div>
                ) : (
                  <div
                    key={`c-${entry.item.id}`}
                    className={`border-l-2 pl-3 ${
                      entry.item.direction === "inbound" ? "border-line-2" : "border-[var(--amber)]"
                    }`}
                  >
                    <span
                      className={`mb-1 inline-block rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        entry.item.direction === "inbound"
                          ? "border-line bg-[var(--surface-2)] text-[var(--tx-2)]"
                          : "border-amber-line bg-[var(--amber-dim)] text-[var(--amber)]"
                      }`}
                    >
                      {entry.item.direction === "inbound" ? "Received" : entry.item.status === "sent" ? "Sent" : "Draft"}
                    </span>
                    <CorrespondenceEditor
                      id={entry.item.id}
                      applicationId={application.id}
                      type={entry.item.type}
                      recipientName={entry.item.recipientName}
                      recipientRole={entry.item.recipientRole}
                      recipientEmail={entry.item.recipientEmail}
                      subject={entry.item.subject}
                      initialContent={entry.item.content}
                      status={entry.item.status}
                      sentAt={entry.item.sentAt}
                      attachmentNames={attachmentNamesFor(entry.item.attachments, application.documents, application.company.name)}
                      gmailMessageId={entry.item.gmailMessageId}
                      composerHref={
                        entry.item.status === "draft" && entry.item.contactId
                          ? `/contacts/${entry.item.contactId}?write=1&edit=${entry.item.id}`
                          : null
                      }
                    />
                  </div>
                )
              )}
            </div>
          </Panel>
          )}
          {/* The boxes an employer's form adds beyond the resume. Sits on Work
              because it is part of producing the application, next to the
              documents it complements rather than duplicates. */}
          {shows("formanswers") && (
          <Panel
            id="formanswers"
            title="Application questions"
            badge={application.applicationAnswers.length ? String(application.applicationAnswers.length) : undefined}
          >
            <ApplicationAnswers
              applicationId={application.id}
              saved={application.applicationAnswers.map((a) => ({
                id: a.id,
                question: a.question,
                answer: a.answer,
                createdAt: a.createdAt.toISOString(),
              }))}
              save={saveApplicationAnswer.bind(null, application.id)}
              remove={deleteApplicationAnswer.bind(null, application.id)}
            />
          </Panel>
          )}

          {shows("files") && (
          <Panel id="files" title="Uploaded files" isEmpty={application.uploadedFiles.length === 0} badge={`${application.uploadedFiles.length}`}>
            <p className="mt-0.5 text-xs text-[var(--tx-3)]">Anything a recruiter or contact sent you directly - offer letters, role summaries, etc.</p>
            <ul className="mt-3 divide-y divide-[var(--line)]">
              {application.uploadedFiles.length === 0 && (
                <li className="py-2 text-sm text-[var(--tx-3)]">No files uploaded yet.</li>
              )}
              {application.uploadedFiles.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <a href={`/api/uploads/${f.id}`} className="min-w-0 truncate text-accent hover:underline">
                    {f.fileName}
                  </a>
                  <span className="flex shrink-0 items-center gap-3 text-xs text-[var(--tx-3)]">
                    <span>{formatFileSize(f.size)}</span>
                    <span>{formatDate(f.uploadedAt)}</span>
                    <ConfirmButton
                      label="Delete"
                      question={`Delete ${f.fileName}?`}
                      confirmLabel="Delete it"
                      action={deleteUploadedFile.bind(null, f.id, application.id)}
                      pendingLabel="Deleting..."
                    />
                  </span>
                </li>
              ))}
            </ul>
            <form action={boundUploadFile} className="mt-3 flex flex-wrap items-center gap-2">
              {/* min-w-0 lets the file input actually shrink; without it its
                  intrinsic width pushes the Upload button off screen. */}
              <input
                type="file"
                name="file"
                required
                className={`min-w-0 flex-1 ${inputClass("sm")}`}
              />
              <SubmitButton className="rounded border border-line-2 px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]">Upload</SubmitButton>
            </form>
          </Panel>
          )}

          {shows("contacts") && (
          <Panel id="contacts" title="Contacts" isEmpty={application.contacts.length === 0} badge={`${application.contacts.length}`}>
            <ul className="mt-2 space-y-1.5">
              {application.contacts.map((c) => (
                <li key={c.id}>
                  <details className="group rounded border border-transparent open:border-line open:bg-[var(--surface-2)]">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-2 rounded px-1.5 py-1 text-sm hover:bg-[var(--surface-2)]">
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <svg className="chevron h-2.5 w-2.5 shrink-0 text-[var(--tx-3)]" viewBox="0 0 8 8" fill="currentColor">
                          <path d="M1 0l6 4-6 4V0z" />
                        </svg>
                        <span className="min-w-0 flex-1 truncate">
                          <span className="font-medium text-[var(--tx)]">{c.name}</span>
                          {c.role && <span className="text-[var(--tx-3)]"> · {c.role}</span>}
                        </span>
                        {c.email && (
                          <span className="hidden shrink-0 text-[11.5px] text-[var(--tx-3)] sm:inline">{c.email}</span>
                        )}
                      </span>
                    </summary>
                    <form action={updateContact.bind(null, c.id, application.id)} className="space-y-1.5 px-1.5 pb-2 pt-1">
                      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                        <input name="name" defaultValue={c.name} placeholder="Name" className={inputClass("md")} />
                        <input name="role" defaultValue={c.role ?? ""} placeholder="Role" className={inputClass("md")} />
                        <input name="email" defaultValue={c.email ?? ""} placeholder="Email" className={inputClass("md")} />
                        <input name="phone" defaultValue={c.phone ?? ""} placeholder="Phone" className={inputClass("md")} />
                      </div>
                      <textarea name="notes" defaultValue={c.notes ?? ""} placeholder="Notes" rows={2} className={inputClass("md")} />
                      <div className="flex items-center gap-3">
                        <SubmitButton className="rounded border border-line-2 px-2 py-1 text-xs hover:bg-[var(--surface)]" pendingLabel="Saving...">Save</SubmitButton>
                        <ConfirmButton
                          label="Delete"
                          question={`Delete ${c.name}?`}
                          confirmLabel="Delete them"
                          action={deleteContact.bind(null, c.id, application.id)}
                          pendingLabel="Deleting..."
                        />
                      </div>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
            <form action={boundAddContact} className="mt-3 space-y-2">
              <input name="name" placeholder="Name" className={inputClass("md")} />
              <input name="role" placeholder="Role" className={inputClass("md")} />
              <input name="email" placeholder="Email" className={inputClass("md")} />
              <input name="phone" placeholder="Phone" className={inputClass("md")} />
              <textarea name="notes" placeholder="Notes" rows={2} className={inputClass("md")} />
              <SubmitButton className="rounded border border-line-2 px-3 py-1 text-sm hover:bg-[var(--surface-2)]">Add contact</SubmitButton>
            </form>
          </Panel>
          )}

          {/* Always rendered, unlike the other conditional panels: whether there
              are any matches is only known once the calendar answers, and
              waiting for that to decide is what used to hold up the page. */}
          {shows("meetings") && (
          <Panel id="meetings" title="Meetings">
            <Suspense fallback={<MeetingsPanelFallback />}>
              <MeetingsPanel
                applicationId={application.id}
                companyId={application.company.id}
                companyName={application.company.name}
                icsCalendarUrl={profile?.icsCalendarUrl}
                dismissedUidsJson={application.dismissedCalendarEventUids}
                notes={application.interviewNotes.map((n) => ({ id: n.id, calendarEventUid: n.calendarEventUid }))}
              />
            </Suspense>
          </Panel>
          )}

          {shows("notes") && (
          <Panel id="notes" title="Interview notes" isEmpty={application.interviewNotes.length === 0} badge={`${application.interviewNotes.length}`}>
            {application.interviewNotes.length === 0 ? (
              <p className={EMPTY_INLINE}>No interview notes yet.</p>
            ) : (
              <div className="mt-2 space-y-4">
                {upcomingNotes.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--tx-3)]">Upcoming</p>
                    <ul className="space-y-2">{upcomingNotes.map((n) => renderInterviewNote(n))}</ul>
                  </div>
                )}
                {pastNotes.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-[var(--tx-3)]">Past</p>
                    <ul className="space-y-2">{pastNotes.map((n) => renderInterviewNote(n))}</ul>
                  </div>
                )}
              </div>
            )}
            <form action={boundAddInterviewNote} className="mt-3 space-y-2">
              <input name="roundName" placeholder="Round (e.g. CDO screen)" className={inputClass("md")} />
              <input name="date" type="datetime-local" className={inputClass("md")} />
              <p className="text-xs text-[var(--tx-3)]">
                Include the time to get a warning if it overlaps something on your calendar.
              </p>
              {/* Defaults on: an interview with a time on it belongs on the
                  calendar. Opt-out rather than opt-in, but visible, because it
                  writes to a real calendar other people may see. */}
              <label className="flex items-center gap-2 text-xs text-[var(--tx-2)]">
                <input type="checkbox" name="addToCalendar" defaultChecked />
                Add it to my Google Calendar
              </label>
              <textarea name="notes" placeholder="Notes" rows={2} className={inputClass("md")} />
              {application.contacts.length > 0 && (
                <fieldset className="rounded border border-line p-2">
                  <legend className="px-1 text-xs font-medium text-[var(--tx-3)]">Who did you speak to?</legend>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {application.contacts.map((c) => (
                      <label key={c.id} className="flex items-center gap-1.5 text-xs text-[var(--tx-2)]">
                        <input type="checkbox" name="interviewerIds" value={c.id} />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <SubmitButton className="rounded border border-line-2 px-3 py-1 text-sm hover:bg-[var(--surface-2)]">Add note</SubmitButton>
            </form>
          </Panel>
          )}

          {shows("followups") && (
          <Panel id="followups" title="Follow-ups" isEmpty={application.followUps.length === 0} badge={`${application.followUps.length}`}>
            <ul className="mt-2 space-y-2">
              {application.followUps.map((f) => (
                <li key={f.id} className="text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <span className={f.completed ? "text-[var(--tx-3)] line-through" : "text-[var(--tx-2)]"}>{f.note}</span>
                    {!f.completed && (
                      <form action={toggleFollowUp.bind(null, f.id, application.id, true)}>
                        <SubmitButton className="shrink-0 text-xs text-[var(--tx-3)] hover:underline">Done</SubmitButton>
                      </form>
                    )}
                  </div>
                  {!f.completed && (
                    <form
                      action={setFollowUpDueDate.bind(null, f.id, application.id)}
                      className="mt-1 flex flex-wrap items-center gap-2"
                    >
                      <label className="text-xs text-[var(--tx-3)]">Due</label>
                      <input
                        type="date"
                        name="dueDate"
                        defaultValue={f.dueDate ? f.dueDate.toISOString().slice(0, 10) : ""}
                        className={inputClass("sm")}
                      />
                      <SubmitButton className="text-xs text-accent hover:underline" pendingLabel="Saving...">Save</SubmitButton>
                      {f.dueDate && <span className="text-xs text-amber-700">{formatDate(f.dueDate)}</span>}
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <form action={boundAddFollowUp} className="mt-3 space-y-2">
              <input name="note" placeholder="Follow-up note" className={inputClass("md")} />
              <input name="dueDate" type="date" className={inputClass("md")} />
              <SubmitButton className="rounded border border-line-2 px-3 py-1 text-sm hover:bg-[var(--surface-2)]">Add follow-up</SubmitButton>
            </form>
          </Panel>
          )}

      </CollapsibleSections>
    </div>
  );
}
