import { prisma } from "@/lib/prisma";
import { newestPart } from "@/lib/mail-thread";
import { FOLLOW_UP_STATUSES } from "@/lib/constants";
import { NOT_DELETED } from "@/lib/data/applications";

/**
 * The whole search, small enough to hand a model in one go.
 *
 * The existing assistant is scoped to a single application, which cannot answer
 * the question Dan actually asks out loud: "should I chase the recruiter about
 * that role, it has been over a week." That needs the role, its status, when
 * anything last happened on it, who the contact is, and whether something is
 * already owed - across everything, not one page.
 *
 * A tool loop would be the general answer and is more machinery than this
 * needs. Sixty roles compress to a couple of hundred lines, so the snapshot is
 * simply assembled and sent. **Silence is the point of most of these
 * questions**, so every row carries days-since-last-contact computed here
 * rather than left for the model to work out from dates.
 */
const DAY = 86_400_000;

/** Dates are useless to a model without a "how long ago" beside them. */
function daysSince(d: Date | null | undefined, now: number): number | null {
  return d ? Math.floor((now - d.getTime()) / DAY) : null;
}

export async function buildSearchSnapshot(): Promise<string> {
  const now = Date.now();

  const [apps, contacts] = await Promise.all([
    prisma.jobApplication.findMany({
      where: NOT_DELETED,
      include: {
        company: { select: { name: true } },
        evaluations: { orderBy: { generatedAt: "desc" }, take: 1, select: { recommendation: true } },
        followUps: { where: { completed: false }, select: { note: true, dueDate: true } },
        interviewNotes: { orderBy: { date: "desc" }, take: 1, select: { roundName: true, date: true } },
        correspondence: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, sentAt: true, createdAt: true, recipientName: true } },
        mailMessages: { orderBy: { receivedAt: "desc" }, take: 1, select: { receivedAt: true, fromEmail: true, forwardedFromEmail: true, direction: true, subject: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.contact.findMany({
      select: { name: true, role: true, company: true, email: true, nextAction: true, application: { select: { roleTitle: true, company: { select: { name: true } } } } },
    }),
  ]);

  // Only what is still in motion carries detail. A closed role is one line, so
  // sixty of them cannot crowd out the six that matter.
  const LIVE = new Set<string>(FOLLOW_UP_STATUSES);
  const live = apps.filter((a) => LIVE.has(a.status));
  const closed = apps.filter((a) => !LIVE.has(a.status));

  const lines: string[] = [];
  lines.push(`TODAY: ${new Date(now).toISOString().slice(0, 10)}`);
  lines.push("");
  lines.push(`LIVE ROLES (${live.length}). "quiet Nd" is days since the last thing that happened either way.`);

  for (const a of live) {
    const lastMail = a.mailMessages[0]?.receivedAt ?? null;
    const lastNote = a.correspondence[0]?.sentAt ?? a.correspondence[0]?.createdAt ?? null;
    const lastAny = [lastMail, lastNote, a.lastCheckedAt].filter(Boolean).sort((x, y) => y!.getTime() - x!.getTime())[0] ?? null;

    const people = contacts.filter(
      (c) => c.application?.company.name === a.company.name && c.application?.roleTitle === a.roleTitle
    );

    const bits = [
      `- ${a.company.name} | ${a.roleTitle} | ${a.status}`,
      a.evaluations[0] ? `verdict=${a.evaluations[0].recommendation}` : null,
      `quiet ${daysSince(lastAny, now) ?? "?"}d`,
      lastMail ? `last mail ${daysSince(lastMail, now)}d ago (${a.mailMessages[0].direction})` : "no mail",
      a.correspondence[0]
        ? `last note to ${a.correspondence[0].recipientName} ${daysSince(lastNote, now)}d ago (${a.correspondence[0].status})`
        : "never written to them",
      a.interviewNotes[0]?.date
        ? `${a.interviewNotes[0].roundName} ${a.interviewNotes[0].date > new Date(now) ? "upcoming" : `${daysSince(a.interviewNotes[0].date, now)}d ago`}`
        : null,
      a.followUps.length ? `OWED: ${a.followUps.map((f) => f.note).join("; ")}` : null,
      people.length ? `contacts: ${people.map((p) => `${p.name}${p.company ? ` (${p.company})` : ""}`).join(", ")}` : "no contact known",
    ].filter(Boolean);

    lines.push(bits.join(" | "));
  }

  lines.push("");
  lines.push(`CLOSED OR PASSED (${closed.length}): ${closed.map((a) => a.company.name).join(", ")}`);

  const owed = contacts.filter((c) => c.nextAction?.trim());
  if (owed.length) {
    lines.push("");
    lines.push("PEOPLE YOU OWE SOMETHING:");
    for (const c of owed) lines.push(`- ${c.name}${c.company ? ` (${c.company})` : ""}: ${c.nextAction}`);
  }

  return lines.join("\n");
}

/** Kept exported so the route can quote a specific thread when asked about one. */
export async function recentThreadFor(companyFragment: string): Promise<string> {
  const app = await prisma.jobApplication.findFirst({
    where: { deletedAt: null, company: { name: { contains: companyFragment, mode: "insensitive" } } },
    include: { mailMessages: { orderBy: { receivedAt: "desc" }, take: 4 }, company: true },
  });
  if (!app) return "";
  return app.mailMessages
    .map((m) => `[${m.receivedAt.toISOString().slice(0, 10)}] ${m.forwardedFromEmail ?? m.fromEmail}: ${newestPart(m.body).slice(0, 400)}`)
    .join("\n\n");
}
