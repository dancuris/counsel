import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { PublicLanding } from "@/components/PublicLanding";
import { prisma } from "@/lib/prisma";
import { UNFILED_MAIL } from "@/lib/mail-filing";
import {
  STATUS_GROUPS,
  JOB_STATUSES,
  type JobStatus,
} from "@/lib/constants";
import { StatusBadge } from "@/components/StatusBadge";
import { RecommendationDot } from "@/components/RecommendationDot";
import { DashboardControls } from "@/components/DashboardControls";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDate, formatDateTime } from "@/lib/format";
import { findMatchesForCompanies } from "@/lib/calendar";
import { describeSplit } from "@/lib/verdict-split";
import { restoreApplication } from "../applications/[id]/actions";
import { PAGE_TITLE, PAGE_LEDE, PAGE_WIDE, EMPTY_BLOCK, PAGE_HEADER } from "@/lib/type";
import { TENANT_ID } from "@/lib/tenant";
import { NOT_DELETED } from "@/lib/data/applications";

export const dynamic = "force-dynamic";

type SortField = "company" | "role" | "salary" | "status" | "lastChecked";
const SORT_FIELD_VALUES: SortField[] = ["company", "role", "salary", "status", "lastChecked"];

export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; q?: string; status?: string; stage?: string; archive?: string; deleted?: string; split?: string }>;
}) {
  const { sort, dir, q, status, stage, archive, deleted, split } = await searchParams;

  // Reachable signed out, so the home page can explain the app to Google's
  // verifier and to anyone who lands on the domain.
  if (!(await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value))) {
    return <PublicLanding />;
  }

  let sortField: SortField | null = null;
  let sortDir: "asc" | "desc" = "desc";

  if (sort) {
    sortField = SORT_FIELD_VALUES.includes(sort as SortField) ? (sort as SortField) : null;
    sortDir = dir === "asc" ? "asc" : "desc";
  } else {
    // No explicit sort in the URL (e.g. landed here via the nav link) - fall
    // back to the visitor's last-used sort, remembered via cookie.
    const cookieStore = await cookies();
    const saved = cookieStore.get("dashboardSort")?.value;
    if (saved) {
      const [field, savedDir] = saved.split(":");
      if (SORT_FIELD_VALUES.includes(field as SortField)) {
        sortField = field as SortField;
        sortDir = savedDir === "asc" ? "asc" : "desc";
      }
    }
  }

  const statusFilter = JOB_STATUSES.includes(status as JobStatus) ? (status as JobStatus) : null;

  /**
   * Where a role sits before any decision has been made about it.
   *
   * Status records what Dan decided; the verdict records what the models think.
   * Keeping them apart matters because the verdict changes - a role that came
   * back pass this morning is a stretch now - and a status mirroring it would
   * drift out of sync the moment an evaluation is re-run.
   */
  const PRE_DECISION = ["TARGET", "LIVE_POSTING_FOUND", "VERIFY"];
  type Stage = "needs-posting" | "needs-verdict" | "shortlist";
  const stageOf = (a: { status: string; evaluations: { recommendation: string }[]; jobDescriptions: { id: string }[] }): Stage | null => {
    if (!PRE_DECISION.includes(a.status)) return null;
    if (a.evaluations.length === 0) return a.jobDescriptions.length ? "needs-verdict" : "needs-posting";
    return a.evaluations[0].recommendation === "pass" ? null : "shortlist";
  };
  const stageFilter = (["needs-posting", "needs-verdict", "shortlist"] as const).includes(stage as Stage)
    ? (stage as Stage)
    : null;

  /**
   * Roles where the two providers reached different verdicts.
   *
   * Deliberately not another `Stage`. A stage is exclusive - a role is at
   * exactly one - and a split is orthogonal: a shortlisted role can be split
   * and folding it into the enum would make it stop being shortlisted.
   */
  const splitOf = (a: { evaluations: { id: string; model: string; recommendation: string }[] }) => {
    const byModel = new Map<string, (typeof a.evaluations)[number]>();
    for (const e of a.evaluations) if (!byModel.has(e.model)) byModel.set(e.model, e);
    const latest = a.evaluations[0];
    const other = [...byModel.values()].find((e) => e.id !== latest?.id);
    return describeSplit(latest, other);
  };
  const splitFilter = split === "1";
  const showArchive = archive === "1";
  const showDeleted = deleted === "1";
  const searchQuery = (q ?? "").trim().toLowerCase();

  // Request-time "now" - this page is force-dynamic (never statically
  // cached), so a per-request value is safe despite the rule's general
  // no-impure-calls-during-render guidance.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();

  const [
    allApplications,
    followUps,
    threadContacts,
    correspondenceDrafts,
    upcomingInterviews,
    profile,
    allLinkedUids,
    prepDocs,
    allEvaluations,
    appsWithJd,
    deletedApplications,
    mailToFile,
  ] = await Promise.all([
    prisma.jobApplication.findMany({
      where: NOT_DELETED,
      include: {
        company: true,
        // Enough to tell a role that has been judged from one that was merely
        // pasted in. Both are "live posting found" today, which is why the
        // pipeline reads as busier than it is.
        // Four rather than one, and carrying the model: a disagreement between
        // providers cannot be seen from a single row, and the extra three are
        // two short strings each across ninety roles.
        evaluations: { orderBy: { generatedAt: "desc" }, take: 4, select: { id: true, model: true, recommendation: true } },
        jobDescriptions: { take: 1, select: { id: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.followUp.findMany({
      where: { completed: false, application: { deletedAt: null } },
      include: { application: { include: { company: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // People owed a next action. Contacts with no application attached and a
    // thread status are what warm threads became.
    prisma.contact.findMany({
      // Same NULL-unsafe clause as the dashboard had, copied here when the
      // route was split. `not: "closed"` never matches a null thread status.
      where: {
        OR: [{ threadStatus: null }, { threadStatus: { not: "closed" } }],
        NOT: { nextAction: null },
      },
      select: { id: true, name: true, relationship: true, nextAction: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.correspondence.findMany({
      where: { status: "draft", application: { deletedAt: null } },
      include: { application: { include: { company: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.interviewNote.findMany({
      where: { date: { gte: new Date(now) }, application: { deletedAt: null } },
      include: { application: { include: { company: true } } },
      orderBy: { date: "asc" },
      take: 10,
    }),
    prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { icsCalendarUrl: true } }),
    prisma.interviewNote.findMany({ where: { calendarEventUid: { not: null } }, select: { calendarEventUid: true } }),
    prisma.document.findMany({ where: { type: "interview_prep" }, select: { applicationId: true } }),
    // Newest first, so the first row seen per application is its latest verdict.
    prisma.evaluation.findMany({
      orderBy: { generatedAt: "desc" },
      select: { applicationId: true, recommendation: true },
    }),
    prisma.jobDescription.findMany({ select: { applicationId: true }, distinct: ["applicationId"] }),
    prisma.jobApplication.findMany({
      where: { deletedAt: { not: null } },
      include: { company: true },
      orderBy: { deletedAt: "desc" },
    }),
    prisma.mailMessage.findMany({
      where: UNFILED_MAIL,
      orderBy: { receivedAt: "desc" },
      take: 6,
    }),
  ]);

  // "Upcoming interviews" combines interview notes already logged with
  // calendar matches that haven't been linked yet - otherwise a real
  // upcoming interview only appears once someone visits that application's
  // page and clicks "Add notes" on it.
  const linkedEventUidsGlobal = new Set(allLinkedUids.map((n) => n.calendarEventUid as string));
  // One entry per company, and which application it points at matters: there
  // are two AT&T roles, and building this with Map(...) let the last one win,
  // so a calendar match for AT&T opened whichever role happened to sort last.
  // Prefer a role actually at interview stage, then the most recently touched.
  const STAGE_RANK: Record<string, number> = { OFFER: 0, INTERVIEWING: 1, APPLIED: 2, LIVE_POSTING_FOUND: 3 };
  const rank = (status: string) => STAGE_RANK[status] ?? 9;
  const companiesById = new Map<string, { id: string; roleTitle: string; company: (typeof allApplications)[number]["company"] }>();
  // allApplications is already ordered by updatedAt desc, so an equal-ranked
  // later entry never displaces a more recently updated one.
  for (const a of allApplications) {
    const held = companiesById.get(a.companyId);
    const heldRank = held ? rank(allApplications.find((x) => x.id === held.id)!.status) : 99;
    if (!held || rank(a.status) < heldRank) {
      companiesById.set(a.companyId, { id: a.id, roleTitle: a.roleTitle, company: a.company });
    }
  }
  const matchesByCompany = await findMatchesForCompanies(
    profile?.icsCalendarUrl,
    Array.from(companiesById.values()).map((v) => ({ id: v.company.id, name: v.company.name }))
  );
  type UpcomingItem = { key: string; applicationId: string; companyName: string; label: string; date: Date };
  const upcomingFromNotes: UpcomingItem[] = upcomingInterviews.map((n) => ({
    key: `note-${n.id}`,
    applicationId: n.applicationId,
    companyName: n.application.company.name,
    label: n.roundName,
    date: n.date as Date,
  }));
  const upcomingFromCalendar: UpcomingItem[] = [];
  for (const [companyId, events] of matchesByCompany.entries()) {
    const app = companiesById.get(companyId);
    if (!app) continue;
    for (const e of events) {
      if (e.start.getTime() < now || linkedEventUidsGlobal.has(e.uid)) continue;
      upcomingFromCalendar.push({ key: `event-${e.uid}`, applicationId: app.id, companyName: app.company.name, label: e.summary, date: e.start });
    }
  }
  const upcomingAll = [...upcomingFromNotes, ...upcomingFromCalendar].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Interview-stage roles are what Dan should be prioritising, so they get
  // their own section at the top of the dashboard rather than being buried
  // inside the (much larger) "Active pipeline" group with everything else.
  const hasPrep = new Set(prepDocs.map((d) => d.applicationId));
  // allEvaluations arrives newest-first, so the first entry wins per application.
  const recommendationByApplication = new Map<string, string>();
  for (const e of allEvaluations) {
    if (!recommendationByApplication.has(e.applicationId)) {
      recommendationByApplication.set(e.applicationId, e.recommendation);
    }
  }
  const nextEventByApplication = new Map<string, UpcomingItem>();
  for (const item of upcomingAll) {
    if (!nextEventByApplication.has(item.applicationId)) nextEventByApplication.set(item.applicationId, item);
  }
  const interviewStage = allApplications
    .filter((a) => a.status === "INTERVIEWING" || a.status === "OFFER")
    .sort((a, b) => {
      // Anything with a scheduled meeting sorts first, soonest at the top.
      const aDate = nextEventByApplication.get(a.id)?.date.getTime();
      const bDate = nextEventByApplication.get(b.id)?.date.getTime();
      if (aDate && bDate) return aDate - bDate;
      if (aDate) return -1;
      if (bDate) return 1;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    });

  // A job description with no evaluation is the app's most valuable idle
  // state: the expensive part (getting the posting in) is already done.
  const evaluatedIds = new Set(allEvaluations.map((e) => e.applicationId));
  const readyToEvaluate = appsWithJd.filter((j) => !evaluatedIds.has(j.applicationId)).length;

  // Most of the pipeline is dormant (Verify) or finished, and it drowns the
  // handful of roles actually in play. Live groups stay open; the rest sit
  // behind one collapsed "Archive" section.
  const ARCHIVE_LABELS = new Set(["Verify", "Target companies", "Passed / reviewed", "Closed / rejected"]);
  const LIVE_GROUPS = STATUS_GROUPS.filter((g) => !ARCHIVE_LABELS.has(g.label));
  const ARCHIVE_GROUPS = STATUS_GROUPS.filter((g) => ARCHIVE_LABELS.has(g.label));
  const archiveStatuses = new Set(ARCHIVE_GROUPS.flatMap((g) => g.statuses));
  const archiveCount = allApplications.filter((a) => archiveStatuses.has(a.status as JobStatus)).length;

  // The queue. The dashboard used to open on a 69-row inventory and leave
  // "what should I do now" entirely to the reader. These are the things that
  // are actually waiting on Dan, most time-critical first.
  type QueueItem = {
    key: string;
    href: string;
    urgency: number; // lower sorts first
    label: string;
    detail: string;
    tone: "urgent" | "warn" | "calm";
    when?: string;
  };
  const DAY = 86_400_000;
  const queue: QueueItem[] = [];

  for (const item of upcomingAll.slice(0, 5)) {
    const daysAway = (item.date.getTime() - now) / DAY;
    queue.push({
      key: item.key,
      href: `/applications/${item.applicationId}`,
      urgency: daysAway,
      label: item.companyName,
      detail: hasPrep.has(item.applicationId) ? `${item.label} · prep ready` : `${item.label} · no prep yet`,
      tone: daysAway <= 3 ? "urgent" : "warn",
      when: formatDateTime(item.date),
    });
  }

  for (const app of interviewStage) {
    if (hasPrep.has(app.id) || nextEventByApplication.has(app.id)) continue;
    queue.push({
      key: `prep-${app.id}`,
      urgency: 20,
      href: `/applications/${app.id}`,
      label: app.company.name,
      detail: "At interview stage with no prep built",
      tone: "warn",
    });
  }

  for (const draft of correspondenceDrafts.slice(0, 3)) {
    queue.push({
      key: `draft-${draft.id}`,
      urgency: 30,
      href: draft.applicationId ? `/applications/${draft.applicationId}` : `/contacts/${draft.contactId ?? ""}`,
      label: draft.application?.company.name ?? draft.recipientName,
      detail: `Draft to ${draft.recipientName} not sent yet`,
      tone: "warn",
    });
  }

  if (readyToEvaluate > 0) {
    queue.push({
      key: "evaluate",
      urgency: 40,
      href: "/",
      label: `${readyToEvaluate} ready to evaluate`,
      detail: "Job description saved, no fit evaluation yet",
      tone: "calm",
    });
  }

  // A follow-up with a date is a commitment to someone and ranks by when it is
  // owed. Undated ones are a backlog, so they stay aggregated in one row rather
  // than burying the dated ones.
  const datedFollowUps = followUps.filter((f) => f.dueDate);
  const undatedFollowUps = followUps.filter((f) => !f.dueDate);

  for (const f of datedFollowUps) {
    const daysAway = ((f.dueDate as Date).getTime() - now) / DAY;
    queue.push({
      key: `followup-${f.id}`,
      urgency: daysAway,
      href: `/applications/${f.applicationId}`,
      label: f.application.company.name,
      detail: f.note,
      tone: daysAway <= 1 ? "urgent" : daysAway <= 4 ? "warn" : "calm",
      when: daysAway < 0 ? `Overdue ${formatDate(f.dueDate)}` : `Due ${formatDate(f.dueDate)}`,
    });
  }

  if (undatedFollowUps.length > 0) {
    queue.push({
      key: "followups",
      urgency: 50,
      href: `/applications/${undatedFollowUps[0].applicationId}`,
      label: `${undatedFollowUps.length} follow-${undatedFollowUps.length === 1 ? "up" : "ups"} with no date`,
      detail: undatedFollowUps
        .slice(0, 2)
        .map((f) => `${f.application.company.name}: ${f.note}`)
        .join(" · "),
      tone: "calm",
    });
  }

  // Unfiled mail is a thing that needs you, so it belongs in the one list
  // rather than behind its own route, its own nav item and its own badge.
  if (mailToFile.length > 0) {
    queue.push({
      key: "mail",
      urgency: 2,
      href: "/inbox",
      label: `${mailToFile.length} message${mailToFile.length === 1 ? "" : "s"} to file`,
      detail: "Job mail that matched no tracked role",
      tone: "warn",
      when: "",
    });
  }

  // People you owe something to belong in the same list as everything else you
  // owe. A separate card meant networking only happened if you remembered to
  // look at it.
  for (const c of threadContacts) {
    queue.push({
      key: `thread-${c.id}`,
      urgency: 6,
      href: "/contacts",
      label: c.relationship?.startsWith("Warm thread - ")
        ? `${c.name} (${c.relationship.replace("Warm thread - ", "")})`
        : c.name,
      detail: c.nextAction ?? "",
      tone: "calm",
      when: "",
    });
  }

  queue.sort((a, b) => a.urgency - b.urgency);

  const applications = allApplications.filter((a) => {
    if (statusFilter && a.status !== statusFilter) return false;
    if (stageFilter && stageOf(a) !== stageFilter) return false;
    if (splitFilter && !splitOf(a)) return false;
    if (searchQuery && !a.company.name.toLowerCase().includes(searchQuery) && !a.roleTitle.toLowerCase().includes(searchQuery)) {
      return false;
    }
    return true;
  });

  const sortComparators: Record<SortField, (a: (typeof applications)[number], b: (typeof applications)[number]) => number> = {
    company: (a, b) => a.company.name.localeCompare(b.company.name),
    role: (a, b) => a.roleTitle.localeCompare(b.roleTitle),
    salary: (a, b) => (a.salaryRange ?? "").localeCompare(b.salaryRange ?? ""),
    status: (a, b) => a.status.localeCompare(b.status),
    lastChecked: (a, b) => (a.lastCheckedAt?.getTime() ?? 0) - (b.lastCheckedAt?.getTime() ?? 0),
  };

  function applySort<T extends (typeof applications)[number]>(rows: T[]): T[] {
    if (!sortField) return rows;
    const sorted = [...rows].sort(sortComparators[sortField]);
    if (sortDir === "desc") sorted.reverse();
    return sorted;
  }

  applications.splice(0, applications.length, ...applySort(applications));

  const rolesByCompany = new Map<string, typeof applications>();
  for (const app of applications) {
    const list = rolesByCompany.get(app.companyId) ?? [];
    list.push(app);
    rolesByCompany.set(app.companyId, list);
  }

  // For a company with multiple matching roles, pick whichever role sits in
  // the earliest status group as the "anchor" row; its siblings render as
  // full lines directly beneath it (in every status group) instead of being
  // scattered across separate, possibly-collapsed sections.
  const groupIndexByStatus = new Map<string, number>();
  STATUS_GROUPS.forEach((g, i) => g.statuses.forEach((s) => groupIndexByStatus.set(s, i)));
  const anchorAppIdByCompany = new Map<string, string>();
  for (const [companyId, apps] of rolesByCompany.entries()) {
    if (apps.length <= 1) continue;
    let best = apps[0];
    let bestIdx = groupIndexByStatus.get(best.status) ?? 999;
    for (const a of apps.slice(1)) {
      const idx = groupIndexByStatus.get(a.status) ?? 999;
      if (idx < bestIdx) {
        best = a;
        bestIdx = idx;
      }
    }
    anchorAppIdByCompany.set(companyId, best.id);
  }

  const byStatus = new Map<string, typeof applications>();
  for (const app of applications) {
    const list = byStatus.get(app.status) ?? [];
    list.push(app);
    byStatus.set(app.status, list);
  }

  /**
   * One row, every width.
   *
   * There were two renderers: a `<table>` for desktop and a `md:hidden` list
   * for mobile, so every role was built and shipped twice and the page was
   * 555 KB. A table is also the wrong primitive here - the columns fought each
   * other, and the role title was once starved to 76px because a salary string
   * refused to wrap.
   *
   * This is a flex row that reflows instead: company and role stack under
   * ~640px, status and date drop to a second line, and nothing is duplicated.
   */
  function renderRow(app: (typeof applications)[number], isSibling = false) {
    return (
      <li key={app.id}>
        <Link
          href={`/applications/${app.id}`}
          className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-5 py-3.5 transition-colors hover:bg-[var(--surface-2)] sm:flex-nowrap"
        >
          {/*
            A sibling role put its title in the COMPANY column and left the
            role column out entirely, so the second Marriott role started
            where "Marriott International" started rather than under the
            first role's title. Chase and Coca-Cola read the same way.

            The company column is still rendered for a sibling, just empty.
            That is what holds the alignment: an omitted column collapses and
            everything after it slides left.
          */}
          <span className="flex min-w-0 flex-none items-baseline gap-2.5 sm:w-[30%]">
            {!isSibling && (
              <>
                <RecommendationDot recommendation={recommendationByApplication.get(app.id)} />
                <span className="truncate text-[14px] font-medium text-[var(--tx)]">{app.company.name}</span>
              </>
            )}
          </span>

          <span className="min-w-0 flex-1 basis-full sm:basis-auto">
            <span className="block truncate text-[13.5px] text-[var(--tx-2)]">
              {isSibling ? (
                <span className="text-[var(--tx-3)]">&#8627; {app.roleTitle}</span>
              ) : (
                app.roleTitle
              )}
            </span>
            {/* Siblings dropped this entirely, so Marriott's second role hid a
                real $182,100-$305,000 range while the first showed its own. */}
            {app.salaryRange && (
              <span className="mt-0.5 block truncate text-[11.5px] text-[var(--tx-3)]">{app.salaryRange}</span>
            )}
          </span>

          <span className="flex flex-none items-center gap-4">
            <StatusBadge status={app.status} />
            <span className="whitespace-nowrap text-[11.5px] text-[var(--tx-3)]">{formatDate(app.lastCheckedAt)}</span>
          </span>
        </Link>
      </li>
    );
  }

  const mainContent = statusFilter || stageFilter || splitFilter ? (
    <div className="overflow-hidden">
      {/* The status dropdown shows which status is on. Nothing showed that the
          split filter was, so a seven-row pipeline looked like the pipeline. */}
      {splitFilter && (
        <p className="flex flex-wrap items-center justify-between gap-2 pb-2.5 text-[12.5px] text-[var(--tx-3)]">
          <span>Roles where the two models reached different verdicts.</span>
          <Link href="/pipeline" className="text-accent hover:underline">
            Show everything
          </Link>
        </p>
      )}
      <ul className="divide-y divide-[var(--line)]">{applications.map((app) => renderRow(app))}</ul>
      {applications.length === 0 && <p className={EMPTY_BLOCK}>No matching applications.</p>}
    </div>
  ) : (
    <>
      {(() => {
        const stale = allApplications.filter((a) => stageOf(a) === "needs-posting").length;
        if (stale === 0) return null;
        return (
          <Link
            href={stageFilter === "needs-posting" ? "/" : "/?stage=needs-posting"}
            className={`block rounded-lg border px-4 py-2.5 text-[12.5px] transition-colors ${
              stageFilter === "needs-posting"
                ? "border-amber-line bg-[var(--amber-dim)] text-[var(--amber)]"
                : "border-line-2 bg-[var(--surface)] text-[var(--tx-3)] hover:bg-[var(--surface-2)]"
            }`}
          >
            <b className="font-semibold">{stale}</b> roles have no job description yet - worth clearing out or filling in
          </Link>
        );
      })()}

      {/* The disagreements are the point of paying for a second provider, and
          they were only visible by opening each role one at a time. A count
          that links nowhere is the fault this app keeps re-learning, so this
          one filters the list below it. */}
      {(() => {
        const splits = allApplications.filter((a) => splitOf(a)).length;
        if (splits === 0) return null;
        return (
          <Link
            href="/pipeline?split=1"
            className="mt-2 block rounded-lg border border-line-2 bg-[var(--surface)] px-4 py-2.5 text-[12.5px] text-[var(--tx-3)] transition-colors hover:bg-[var(--surface-2)]"
          >
            <b className="font-semibold">{splits}</b> {splits === 1 ? "role has" : "roles have"} a split verdict - the two
            models reached different conclusions
          </Link>
        );
      })()}

      {LIVE_GROUPS.map(renderStatusGroup)}
      {/*
        The archive is behind the URL, not behind a chevron.

        It was a collapsed <details> holding Verify, Target companies, Passed
        and Closed - the large majority of the sixty-odd roles - and collapsed
        is not unrendered, so every one of them shipped on every load of a page
        whose live section is a couple of dozen rows. Same fault as the
        dashboard and the tabs, in the last place it was still hiding.
      */}
      {archiveCount > 0 &&
        (showArchive ? (
          <div className="mt-6">
            <Link
              href="/pipeline"
              className="mb-1 flex items-baseline justify-between gap-2 border-t border-line px-5 py-3.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
            >
              Hide archive
              <span className="font-normal normal-case tracking-normal">{archiveCount}</span>
            </Link>
            {ARCHIVE_GROUPS.map(renderStatusGroup)}
          </div>
        ) : (
          <Link
            href="/pipeline?archive=1"
            className="mt-8 flex items-baseline justify-between gap-2 border-t border-line px-5 py-3.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
          >
            Show archive
            <span className="font-normal normal-case tracking-normal">{archiveCount}</span>
          </Link>
        ))}
    </>
  );

  function renderStatusGroup(group: (typeof STATUS_GROUPS)[number]) {
    {
        // Anchors + single-role apps are what this section actually displays;
        // a multi-role app that isn't the anchor renders under its anchor's
        // section instead, so it must not count toward this section either.
        // Re-sort after merging the group's statuses together - each status's
        // rows arrive pre-sorted individually, which is not the same as the
        // whole section being in one continuous order (e.g. all "Applied"
        // rows sorted A-Z followed by all "Interviewing" rows sorted A-Z is
        // NOT alphabetical across the section as a whole).
        const displayRows = applySort(group.statuses.flatMap((s) => byStatus.get(s) ?? [])).filter((app) => {
          const siblingCount = rolesByCompany.get(app.companyId)?.length ?? 1;
          return siblingCount <= 1 || anchorAppIdByCompany.get(app.companyId) === app.id;
        });
        if (displayRows.length === 0) return null;
        return (
          /*
            A sticky section header, not an accordion.

            Six <details> blocks meant six pieces of open/closed state to
            manage on a page that is pure reference, and the chevrons were
            hand-rolled SVGs from an older idiom. Worse, collapsing hid nothing
            expensive: the rows rendered either way.

            This is the iOS Contacts pattern instead. One continuous list,
            headers that stick as you scroll so you always know which status
            you are looking at, and nothing to open. Scrolling is the
            navigation.
          */
          <section key={group.label}>
            <h2 className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-line bg-[var(--bg)]/85 px-5 py-2.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--tx-3)] backdrop-blur">
              {group.label}
              <span className="font-normal normal-case tracking-normal">{displayRows.length}</span>
            </h2>
            <ul className="divide-y divide-[var(--line)]">
              {displayRows.flatMap((app) => {
                const siblings = rolesByCompany.get(app.companyId) ?? [];
                if (siblings.length <= 1) return [renderRow(app)];
                return [
                  renderRow(app),
                  ...siblings.filter((s) => s.id !== app.id).map((s) => renderRow(s, true)),
                ];
              })}
            </ul>
          </section>
        );
    }
  }

  return (
    <div className={PAGE_WIDE}>
      <header className={PAGE_HEADER}>
        <h1 className={PAGE_TITLE}>Pipeline</h1>
        <p className={PAGE_LEDE}>
          Every role, every status. Reference, not the day&apos;s work.
        </p>
      </header>


      {/* The full pipeline is reference, not the day's work.
          It was the second thing on the page and 197 rows long, which is what
          made the dashboard feel like a spreadsheet rather than a to-do list.
          Open when a filter is on, because then it is the answer to a question
          just asked. */}
      <section className="panel overflow-hidden">
        <DashboardControls sortField={sortField} sortDir={sortDir} q={q ?? ""} status={status ?? ""} />
        <div className="px-1 pb-1">{mainContent}</div>
      </section>

      {deletedApplications.length > 0 &&
        (showDeleted ? (
          <section className="mt-1">
            <Link
              href={showArchive ? "/pipeline?archive=1" : "/pipeline"}
              className="flex items-baseline justify-between gap-2 border-t border-line px-5 py-3.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
            >
              Hide recently deleted
              <span className="font-normal normal-case tracking-normal">{deletedApplications.length}</span>
            </Link>
            <ul className="divide-y divide-[var(--line)]">
              {deletedApplications.map((app) => (
                <li key={app.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-5 py-3.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-[var(--tx)]">{app.company.name}</span>
                    <span className="block truncate text-[13px] text-[var(--tx-2)]">{app.roleTitle}</span>
                  </span>
                  <span className="flex flex-none items-center gap-4">
                    <span className="whitespace-nowrap text-[11.5px] text-[var(--tx-3)]">
                      deleted {formatDate(app.deletedAt)}
                    </span>
                    <form action={restoreApplication.bind(null, app.id)}>
                      <SubmitButton className="rounded-lg border border-line px-2.5 py-1 text-[11.5px] text-[var(--tx-2)] transition-colors hover:text-[var(--tx)]">
                        Restore
                      </SubmitButton>
                    </form>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <Link
            href={showArchive ? "/pipeline?archive=1&deleted=1" : "/pipeline?deleted=1"}
            className="mt-1 flex items-baseline justify-between gap-2 border-t border-line px-5 py-3.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
          >
            Recently deleted
            <span className="font-normal normal-case tracking-normal">{deletedApplications.length}</span>
          </Link>
        ))}
    </div>
  );
}
