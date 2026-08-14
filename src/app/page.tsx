import Link from "next/link";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";
import { PublicLanding } from "@/components/PublicLanding";
import { prisma } from "@/lib/prisma";
import { UNFILED_MAIL } from "@/lib/mail-filing";
import { FOLLOW_UP_INCLUDE, followUpFor, ownAddresses } from "@/lib/follow-up";
import { FOLLOW_UP_STATUSES } from "@/lib/constants";
import {
  STATUS_GROUPS,
  JOB_STATUSES,
  type JobStatus,
} from "@/lib/constants";
import { JobSearchBox } from "@/components/JobSearchBox";
import { LinkedInImport } from "@/components/LinkedInImport";
import { formatDate, formatDateTime } from "@/lib/format";
import { findMatchesForCompanies, findMatchesForContacts } from "@/lib/calendar";
import { PAGE_TITLE_HERO, PAGE_WIDE, EMPTY_BLOCK, PAGE_HEADER_HERO } from "@/lib/type";
import { TENANT_ID } from "@/lib/tenant";
import { NOT_DELETED } from "@/lib/data/applications";
import { UpdateNotice } from "@/components/UpdateNotice";

export const dynamic = "force-dynamic";

type SortField = "company" | "role" | "salary" | "status" | "lastChecked";
const SORT_FIELD_VALUES: SortField[] = ["company", "role", "salary", "status", "lastChecked"];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string; q?: string; status?: string; stage?: string }>;
}) {
  const { sort, dir, q, status, stage } = await searchParams;

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
    mailToFile,
    recentJobMail,
    noiseCount,
    followUpRoles,
    allContacts,
    own,
  ] = await Promise.all([
    prisma.jobApplication.findMany({
      where: NOT_DELETED,
      include: {
        company: true,
        // Enough to tell a role that has been judged from one that was merely
        // pasted in. Both are "live posting found" today, which is why the
        // pipeline reads as busier than it is.
        evaluations: { orderBy: { generatedAt: "desc" }, take: 1, select: { recommendation: true } },
        jobDescriptions: { take: 1, select: { id: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.followUp.findMany({
      where: { completed: false, application: { deletedAt: null } },
      include: { application: { include: { company: true } } },
      orderBy: { createdAt: "asc" },
    }),
    // Everyone owed a next action, whether or not they are attached to a role.
    //
    // This filtered on `applicationId: null` because the query was written when
    // warm threads became contacts, and those have no application. The effect
    // was that anyone owed something who *was* attached to a role never reached
    // the queue at all - a recruiter who had offered to walk a resume in was
    // owed a reply, and the one thing that had to happen was invisible
    // on the page whose whole job is saying what needs doing.
    prisma.contact.findMany({
      // `threadStatus: { not: "closed" }` compiles to SQL `<> 'closed'`, which
      // is NULL-unsafe: a contact whose thread status was never set is not
      // "closed" but does not match either. Only the five migrated warm threads
      // ever had one, so every ordinary contact owed something was excluded by
      // the very clause meant to exclude finished ones. Null has to be spelled
      // out.
      where: {
        OR: [{ threadStatus: null }, { threadStatus: { not: "closed" } }],
        NOT: { nextAction: null },
      },
      select: {
        id: true,
        name: true,
        relationship: true,
        nextAction: true,
        company: true,
        application: { select: { id: true, company: { select: { name: true } } } },
      },
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
    prisma.mailMessage.findMany({
      where: UNFILED_MAIL,
      orderBy: { receivedAt: "desc" },
      take: 6,
    }),
    prisma.mailMessage.findMany({
      where: { archivedAt: null, dismissedAt: null, NOT: { category: "not_job_related" } },
      orderBy: { receivedAt: "desc" },
      take: 4,
    }),
    prisma.mailMessage.count({
      where: { applicationId: null, archivedAt: null, dismissedAt: null, category: "not_job_related" },
    }),
    // Separate from `allApplications` on purpose. The cadence needs four
    // relations per role and this page is deliberately lean, so it loads them
    // only for roles that can actually be followed up, and selects only the
    // columns the rule reads.
    prisma.jobApplication.findMany({
      where: { ...NOT_DELETED, status: { in: [...FOLLOW_UP_STATUSES] } },
      select: { id: true, roleTitle: true, company: { select: { name: true } }, ...FOLLOW_UP_INCLUDE },
    }),
    // Names only, to match against calendar invite titles. Cheap, and it is
    // the only way a networking meeting reaches this page: those events name
    // the person and never the employer.
    prisma.contact.findMany({
      select: { id: true, name: true, company: true, applicationId: true },
    }),
    ownAddresses(),
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
  // `applicationId` is null for a meeting matched to a person rather than to a
  // tracked role: a networking coffee has nobody's requisition behind it.
  type UpcomingItem = {
    key: string;
    applicationId: string | null;
    contactId?: string;
    companyName: string;
    label: string;
    date: Date;
  };
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
  // Meetings titled after a person rather than an employer. A calendar invite
  // for a networking conversation names the two humans in it and nothing else,
  // so company matching above finds none of them - a coffee with a VP sat on
  // the calendar under two people's names and Today did not know about it on
  // the afternoon it happened.
  const contactMatches = await findMatchesForContacts(
    profile?.icsCalendarUrl,
    allContacts.map((c) => ({ id: c.id, name: c.name }))
  );
  const contactsById = new Map(allContacts.map((c) => [c.id, c]));
  const upcomingFromContacts: UpcomingItem[] = [];
  // A meeting can match a person and a company both, which is the ordinary case
  // for a real interview. The company row already carries a role to open, so
  // the person row would be the same meeting listed twice.
  const companyMatchedUids = new Set(upcomingFromCalendar.map((u) => u.key));
  for (const [contactId, events] of contactMatches.entries()) {
    const contact = contactsById.get(contactId);
    if (!contact) continue;
    for (const e of events) {
      if (e.start.getTime() < now || linkedEventUidsGlobal.has(e.uid)) continue;
      if (companyMatchedUids.has(`event-${e.uid}`)) continue;
      upcomingFromContacts.push({
        key: `event-${e.uid}`,
        applicationId: contact.applicationId ?? null,
        contactId: contact.id,
        companyName: contact.company ?? contact.name,
        label: contact.name,
        date: e.start,
      });
    }
  }

  const upcomingAll = [...upcomingFromNotes, ...upcomingFromCalendar, ...upcomingFromContacts].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

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
    if (!item.applicationId) continue;
    if (!nextEventByApplication.has(item.applicationId)) nextEventByApplication.set(item.applicationId, item);
  }
  /**
   * A booked meeting counts, whatever the status says.
   *
   * Status alone was the whole test, and it missed one: a recruiter call
   * was in the diary for the next morning while the role sat on Applied,
   * because the invitation had been classified `recruiter_outreach` rather than
   * `interview_invite` - a fair reading of "Career Opportunity with <Employer>",
   * and enough to keep a live conversation off the page that exists to say what
   * is live.
   *
   * `advanceOnMeeting` now moves the status when a meeting is booked, so this
   * should rarely be the thing that catches it. It is kept as the backstop
   * because the two facts have different sources: the status is something the
   * app maintains, and the meeting is something that exists. Where they
   * disagree, the meeting is the one that is true.
   */
  const interviewStage = allApplications
    .filter(
      (a) =>
        a.status === "INTERVIEWING" ||
        a.status === "OFFER" ||
        // A meeting still on the books for a role that was rejected or passed
        // is a diary entry nobody cleared, not a live conversation.
        (nextEventByApplication.has(a.id) && a.status !== "CLOSED_REJECTED" && a.status !== "PASSED")
    )
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
  // Only where a verdict would still change a decision, which is the same
  // definition `/pipeline` filters on: status TARGET, LIVE_POSTING_FOUND or
  // VERIFY. Applied, interviewing and rejected roles are past the point where
  // an evaluation means anything.
  //
  // The row previously said "19 ready to evaluate" and linked to "/". Thirteen
  // of the nineteen were CLOSED_REJECTED and the remaining six were already
  // APPLIED, so the true count was zero: an entire row of the day's work that
  // was pure noise, on the page whose only job is saying what is worth doing.
  // Counting is easy to get wrong quietly, which is why the count and the page
  // it links to must share one definition.
  const statusById = new Map(allApplications.map((a) => [a.id, a.status]));
  const readyToEvaluate = appsWithJd.filter(
    (j) => !evaluatedIds.has(j.applicationId) && PRE_DECISION.includes(statusById.get(j.applicationId) ?? "")
  ).length;

  // Most of the pipeline is dormant (Verify) or finished, and it drowns the
  // handful of roles actually in play. Live groups stay open; the rest sit

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
    // A meeting with a person and no role opens the contact, where the notes
    // and the composer are. Prep is a role artifact, so it is not mentioned on
    // a conversation that has no role behind it.
    const isConversation = !item.applicationId && Boolean(item.contactId);
    queue.push({
      key: item.key,
      href: item.applicationId ? `/applications/${item.applicationId}` : `/contacts/${item.contactId}`,
      urgency: daysAway,
      label: item.companyName,
      detail: isConversation
        ? `${item.label} · conversation`
        : hasPrep.has(item.applicationId!)
          ? `${item.label} · prep ready`
          : `${item.label} · no prep yet`,
      tone: daysAway <= 3 ? "urgent" : "warn",
      when: formatDateTime(item.date),
    });
  }

  for (const app of interviewStage) {
    if (hasPrep.has(app.id) || nextEventByApplication.has(app.id)) continue;
    queue.push({
      key: `prep-${app.id}`,
      urgency: 20,
      // The row says prep is missing, so it opens the page that builds prep.
      href: `/applications/${app.id}/prep`,
      label: app.company.name,
      detail: "At interview stage with no prep built",
      tone: "warn",
    });
  }

  for (const draft of correspondenceDrafts.slice(0, 3)) {
    queue.push({
      key: `draft-${draft.id}`,
      urgency: 30,
      // Straight into the composer with the draft loaded. This used to prefer
      // the role page whenever the draft had one, so "draft to this person not
      // sent yet" landed on the role - the right company, and several clicks
      // from the sentence you were promised. A queue row names one specific
      // thing to do, so it has to arrive at that thing and not near it.
      href: draft.contactId
        ? `/contacts/${draft.contactId}?write=1&edit=${draft.id}`
        : draft.applicationId
          ? `/applications/${draft.applicationId}?tab=talk`
          : "/contacts",
      label: draft.application?.company.name ?? draft.recipientName,
      detail: `Draft to ${draft.recipientName} not sent yet`,
      tone: "warn",
    });
  }

  if (readyToEvaluate > 0) {
    queue.push({
      key: "evaluate",
      urgency: 40,
      // Was "/", which reloaded the page you were already standing on. The
      // pipeline already filters by this exact stage, so it needed a link
      // rather than a new page: `stageOf` returns "needs-verdict" for a role
      // with a job description and no evaluation, which is the same set this
      // row counts.
      href: "/pipeline?stage=needs-verdict",
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

  // A LEAD of two days. Anything further out does not "need you" today, and
  // the headline says exactly that word.
  //
  // This is what makes a snooze mean something. Deferring a role to next week
  // used to turn an urgent row into a calm row with a date on it, still
  // counted in "3 things need you" - so deciding to wait bought silence from
  // nobody. It comes back on its own two days before it is owed, and until
  // then it is on the role, on /follow-ups, and not in his face.
  const LEAD_DAYS = 2;
  for (const f of datedFollowUps) {
    const daysAway = ((f.dueDate as Date).getTime() - now) / DAY;
    if (daysAway > LEAD_DAYS) continue;
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
      // Was the first one's application, so a count of twenty-three took you
      // to one arbitrary role and hid the other twenty-two.
      href: "/follow-ups",
      label: `${undatedFollowUps.length} follow-${undatedFollowUps.length === 1 ? "up" : "ups"} with no date`,
      detail: undatedFollowUps
        .slice(0, 2)
        .map((f) => `${f.application.company.name}: ${f.note}`)
        .join(" · "),
      tone: "calm",
    });
  }

  // Where a role stands on following up, for every live role at once.
  //
  // This is the thing that had no home. The cadence existed only inside the
  // Ask prompt, so "should I chase the recruiter" had to be typed, one role at a
  // time, and the answer went stale as soon as the clock moved: one role was
  // six days quiet when Dan asked and seven the next morning, which is the
  // difference between waiting and checking in.
  //
  // Nothing here can double up with the dated follow-ups above. A dated
  // follow-up in the future IS the snooze, and a snoozed role is never `due`.
  const nowDate = new Date(now);
  for (const role of followUpRoles) {
    const state = followUpFor(role, own, nowDate);
    if (!state.due) continue;
    queue.push({
      key: `cadence-${role.id}`,
      // Owing someone an answer outranks chasing silence, and both outrank a
      // check-in that is merely permitted.
      urgency: state.verdict === "reply" ? 1.5 : state.verdict === "chase" ? 3 : 5,
      // Every cadence verdict resolves to writing to somebody, and the named
      // "Write to X" links live on Talk. Landing on Work means scrolling past
      // the evaluation and the documents to reach the point of the row.
      href: `/applications/${role.id}?tab=talk`,
      label: role.company.name,
      detail: `${role.roleTitle} - ${state.label}`,
      tone: state.tone,
      when: "",
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
    // Straight to the person, not to the directory: the row names someone and
    // the thing owed is a message to them.
    const where = c.application?.company.name ?? c.company ?? c.relationship?.replace("Warm thread - ", "") ?? "";
    queue.push({
      key: `thread-${c.id}`,
      urgency: 6,
      href: `/contacts/${c.id}`,
      label: where ? `${c.name} (${where})` : c.name,
      detail: c.nextAction ?? "",
      tone: "calm",
      when: "",
    });
  }

  queue.sort((a, b) => a.urgency - b.urgency);
  const urgentCount = queue.filter((q) => q.tone === "urgent").length;

  const applications = allApplications.filter((a) => {
    if (statusFilter && a.status !== statusFilter) return false;
    if (stageFilter && stageOf(a) !== stageFilter) return false;
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




  const activeCount = allApplications.filter((a) =>
    ["APPLIED", "INTERVIEWING", "OFFER", "LIVE_POSTING_FOUND"].includes(a.status)
  ).length;
  const initials = (name: string) =>
    (name || "?")
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?";

  return (
    <div className={PAGE_WIDE}>
      {/*
        One statement, set large, with nothing beside it.

        This used to be a headline with an Inbox button parked on the same row,
        which made the first thing on the page a layout rather than a sentence.
        The Apple habit worth borrowing is that the opening line is allowed to
        be the whole view: type carries the hierarchy, so the chrome around it
        can go. The Inbox count moved down into the queue, where it is one more
        thing asking for attention rather than a permanent fixture.
      */}
      <UpdateNotice />

      <section className={PAGE_HEADER_HERO}>
        <h1 className={PAGE_TITLE_HERO}>
          {interviewStage.length > 0 ? (
            <>
              {interviewStage.length} live conversation{interviewStage.length > 1 ? "s" : ""}.
              <br />
              <span className="text-[var(--tx-3)]">
                {queue.length} thing{queue.length === 1 ? "" : "s"} need{queue.length === 1 ? "s" : ""} you.
              </span>
            </>
          ) : queue.length > 0 ? (
            <>
              {queue.length} thing{queue.length === 1 ? "" : "s"} need{queue.length === 1 ? "s" : ""} you.
              <br />
              <span className="text-[var(--tx-3)]">{activeCount} applications in play.</span>
            </>
          ) : (
            <>
              Nothing needs you.
              <br />
              <span className="text-[var(--tx-3)]">{activeCount} applications in play.</span>
            </>
          )}
        </h1>
      </section>

      {/*
        The four the headline is talking about.

        The headline claimed "4 live conversations" and the page never said
        which four: the list was computed, counted, folded into the queue, and
        never rendered. A number with no referent is worse than no number.

        These are the most important rows in the whole search - an interview in
        flight outranks everything else - so they sit directly under the
        statement that counts them, as plain type with no panel around them.
      */}
      {interviewStage.length > 0 && (
        <section className="pb-10">
          <ul className="divide-y divide-[var(--line)] border-y border-line">
            {interviewStage.map((app) => {
              const next = nextEventByApplication.get(app.id);
              return (
                <li key={app.id}>
                  <Link
                    href={`/applications/${app.id}`}
                    className="group flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4 transition-opacity hover:opacity-60"
                  >
                    <span className="text-[19px] font-medium tracking-[-0.01em]">{app.company.name}</span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--tx-3)]">{app.roleTitle}</span>
                    {next ? (
                      <span className="shrink-0 text-[13px] text-[var(--amber)]">{formatDateTime(next.date)}</span>
                    ) : (
                      <span className="shrink-0 text-[13px] text-[var(--tx-3)]">
                        {app.status === "OFFER" ? "Offer" : "No date set"}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* The way roles enter the system, so it stays in reach at all times.
          One line rather than the block it used to be: the fault was never that
          it was present, it was that it pushed the day's work below the fold. */}
      {/*
        Both ways a role gets in, side by side.

        The split put the paste box here and left the search-the-boards path
        stranded on /pipeline, which is the reference page: the one place you
        are not adding anything. They are the same job - "track this role" -
        differing only in whether you happen to have a link, so the one without
        a link is a fallback under the one with it, not a feature on another
        page.
      */}
      {/*
        Same panel as Needs you and the Inbox below it.

        It was bare markup on the page background, which read as chrome rather
        than as one of the page's three things. Giving it the surface makes the
        home page three cards - what needs you, what comes in, and how a role
        gets in - instead of two cards and some loose controls.
      */}
      <section className="panel mb-3 p-5">
        <LinkedInImport compact />
        <details className="group mt-2">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]">
            <span className="transition-transform group-open:rotate-90">&#8250;</span>
            No link? Search the boards by company
          </summary>
          <div className="mt-3">
            <JobSearchBox />
          </div>
        </details>
      </section>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[13.5px] font-semibold">Needs you</h2>
            <span className="text-[11.5px] text-[var(--tx-3)]">
              <b className="font-medium text-[var(--tx-2)]">{queue.length}</b> open
              {urgentCount > 0 && <span className="ml-2 text-[var(--amber)]">{urgentCount} urgent</span>}
            </span>
          </div>
          {queue.length === 0 ? (
            <p className={EMPTY_BLOCK}>Nothing waiting on you.</p>
          ) : (
            <ul>
              {queue.slice(0, 7).map((item) => (
                <li key={item.key} className="border-b border-line last:border-b-0">
                  <Link
                    href={item.href}
                    className="flex items-center gap-3.5 px-5 py-3 transition-colors hover:bg-[var(--surface-2)]"
                  >
                    <span
                      aria-hidden
                      className={`grid h-[30px] w-[30px] flex-none place-items-center rounded-lg border text-[11px] font-semibold ${
                        item.tone === "urgent"
                          ? "border-amber-line bg-[var(--amber-dim)] text-[var(--amber)]"
                          : "border-line bg-[var(--surface-2)] text-[var(--tx-2)]"
                      }`}
                    >
                      {initials(item.label)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{item.label}</span>
                      <span className="block truncate text-[12px] text-[var(--tx-3)]">{item.detail}</span>
                    </span>
                    {item.when && (
                      <span
                        className={`flex-none whitespace-nowrap text-[11.5px] ${
                          item.tone === "urgent" ? "font-medium text-[var(--amber)]" : "text-[var(--tx-3)]"
                        }`}
                      >
                        {item.when}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
              {queue.length > 7 && (
                <li className="px-5 py-3 text-[12px] text-[var(--tx-3)]">{queue.length - 7} more below</li>
              )}
            </ul>
          )}
        </section>

        {/* Exception-based: loud only when job mail is genuinely unfiled. */}
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="text-[13.5px] font-semibold">Inbox</h2>
            <span className="text-[11.5px] text-[var(--tx-3)]">
              {mailToFile.length > 0 ? (
                <b className="font-medium text-[var(--amber)]">{mailToFile.length} to file</b>
              ) : (
                <b className="font-medium text-[var(--tx-2)]">clean</b>
              )}
            </span>
          </div>
          {mailToFile.length > 0 ? (
            <ul>
              {mailToFile.map((m) => (
                <li key={m.id} className="border-b border-line last:border-b-0">
                  <Link href="/inbox" className="flex items-center gap-3.5 px-5 py-3 transition-colors hover:bg-[var(--surface-2)]">
                    <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-lg border border-amber-line bg-[var(--amber-dim)] text-[11px] font-semibold text-[var(--amber)]">
                      {initials(m.fromName ?? m.fromEmail)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{m.subject}</span>
                      <span className="block truncate text-[12px] text-[var(--tx-3)]">
                        {m.fromName ?? m.fromEmail}
                        {m.detectedCompany ? ` · ${m.detectedCompany}` : ""}
                      </span>
                    </span>
                    <span className="flex-none text-[11.5px] font-medium text-[var(--amber)]">file</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <div className="border-b border-line px-5 py-5">
                <p className="flex items-center gap-2.5 text-[13px]">
                  <span
                    aria-hidden
                    className="grid h-[18px] w-[18px] place-items-center rounded-full border border-mint-line bg-[var(--mint-dim)] text-[10px] text-[var(--mint)]"
                  >
                    ✓
                  </span>
                  Nothing waiting to be filed
                </p>
                {noiseCount > 0 && (
                  <p className="mt-1.5 pl-[28px] text-[12px] text-[var(--tx-3)]">
                    {noiseCount} other message{noiseCount === 1 ? "" : "s"} classified as not job related.
                  </p>
                )}
              </div>
              <ul>
                {recentJobMail.map((m) => (
                  <li key={m.id} className="border-b border-line last:border-b-0">
                    <Link href="/inbox" className="flex items-center gap-3.5 px-5 py-3 transition-colors hover:bg-[var(--surface-2)]">
                      <span className="grid h-[30px] w-[30px] flex-none place-items-center rounded-lg border border-line bg-[var(--surface-2)] text-[11px] font-semibold text-[var(--tx-2)]">
                        {initials(m.fromName ?? m.fromEmail)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{m.subject}</span>
                        <span className="block truncate text-[12px] text-[var(--tx-3)]">{m.fromName ?? m.fromEmail}</span>
                      </span>
                      <span className="flex-none text-[11.5px] text-[var(--tx-3)]">filed</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

    </div>
  );
}
