import { NextResponse } from "next/server";
import { todayLocalISO } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { forwardedSender, tidySenderName } from "@/lib/forwarded-mail";
import { MAIL_CONNECTION_ID } from "@/lib/google-connections";
import { statusFromMail } from "@/lib/mail-status";
import { fetchRecentMessages, type FetchedMessage } from "@/lib/google-mail";
import { fetchRecentFastmailMessages, getFastmailConnection, markFastmailSynced } from "@/lib/fastmail";
import { generateStructured } from "@/lib/ai";
import { recordFailure } from "@/lib/failures";
import { MAIL_CATEGORIES } from "@/lib/constants";
import { NOT_DELETED } from "@/lib/data/applications";
import { refreshCalendarCache } from "@/lib/calendar";
import { TENANT_ID } from "@/lib/tenant";

export const maxDuration = 300;

const CLASSIFY_TOOL = {
  name: "classify_messages",
  description: "Classify each inbound message and attribute it to a tracked application where possible.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            gmailId: { type: "string" },
            category: { type: "string", enum: [...MAIL_CATEGORIES] },
            summary: { type: "string", description: "One short sentence: what this message actually says." },
            applicationId: {
              type: "string",
              description:
                "The id of the tracked application this concerns, copied exactly from the list. Attribute ONLY when the employer AND the role both line up. If the employer matches but the role is a different job, return an empty string and put the details in detectedCompany/detectedRole instead - that case is an untracked opportunity, not a match.",
            },
            detectedCompany: {
              type: "string",
              description: "The hiring employer this message concerns, however it is identified. Empty string if none.",
            },
            detectedRole: {
              type: "string",
              description: "The specific role title this message concerns. Empty string if not stated.",
            },
            proposedStart: {
              type: "string",
              description:
                "ISO 8601 with offset (e.g. 2026-08-12T14:00:00-04:00) for a specific interview time the sender proposed. ONLY when a definite date AND time are stated. Empty string for a date with no time, a range, several options, or a request to pick a slot.",
            },
            proposedLabel: {
              type: "string",
              description: "The exact wording the time was read from, e.g. 'Thursday, August 12 at 2:00 PM ET'. Empty if none.",
            },
          },
          required: ["gmailId", "category", "summary", "applicationId", "detectedCompany", "detectedRole", "proposedStart", "proposedLabel"],
        },
      },
    },
    required: ["results"],
  },
};

type Classification = {
  gmailId: string;
  category: string;
  summary: string;
  applicationId: string;
  detectedCompany: string;
  detectedRole: string;
  proposedStart: string;
  proposedLabel: string;
};


// The real sender behind a self-forward. Kept out of the write so it can be
// called twice without parsing the body twice being surprising.
const forwardedCache = new WeakMap<object, ReturnType<typeof forwardedSender>>();
function forwarded(m: { body: string; fromEmail: string }) {
  if (!forwardedCache.has(m)) {
    const found = forwardedSender(m.body);
    forwardedCache.set(m, found && found.email !== m.fromEmail.trim().toLowerCase() ? found : null);
  }
  return forwardedCache.get(m) ?? null;
}

/**
 * Marks every mailbox that was actually read as synced.
 *
 * Only the ones that were read: a Fastmail failure alongside a working Gmail
 * must leave Fastmail's "last synced" where it was, or the page claims a fetch
 * that never happened.
 */
async function markSynced(read: { gmail: boolean; fastmail: boolean }) {
  if (read.gmail) {
    await prisma.googleConnection.update({ where: { id: MAIL_CONNECTION_ID }, data: { lastSyncedAt: new Date() } });
  }
  if (read.fastmail) await markFastmailSynced();
}

export async function POST() {
  const [connection, fastmail] = await Promise.all([
    prisma.googleConnection.findUnique({ where: { id: MAIL_CONNECTION_ID } }),
    getFastmailConnection(),
  ]);
  if (!connection && !fastmail) {
    return NextResponse.json({ error: "No mailbox connected. Connect Gmail or Fastmail from Settings." }, { status: 400 });
  }

  /**
   * Each mailbox is fetched on its own. One failing must not hide the other's
   * mail, but it must not pass silently either: the failure is recorded and
   * returned, and only when every connected mailbox failed is the sync a 502.
   */
  const fetched: FetchedMessage[] = [];
  const read = { gmail: false, fastmail: false };
  const errors: string[] = [];
  if (connection) {
    try {
      fetched.push(...(await fetchRecentMessages()));
      read.gmail = true;
    } catch (e) {
      errors.push(`Gmail: ${(e as Error).message}`);
      await recordFailure("mailbox/sync gmail", e);
    }
  }
  if (fastmail) {
    try {
      fetched.push(...(await fetchRecentFastmailMessages()));
      read.fastmail = true;
    } catch (e) {
      errors.push(`Fastmail: ${(e as Error).message}`);
      await recordFailure("mailbox/sync fastmail", e);
    }
  }
  if (!read.gmail && !read.fastmail) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 502 });
  }

  // Dedup against what has already been pulled, so re-syncing is cheap and safe.
  const seen = new Set(
    (
      await prisma.mailMessage.findMany({
        where: { gmailId: { in: fetched.map((m) => m.gmailId) } },
        select: { gmailId: true },
      })
    ).map((m) => m.gmailId)
  );
  const fresh = fetched.filter((m) => !seen.has(m.gmailId));

  /**
   * Messages a previous sync stored but could not classify.
   *
   * The Inbox deliberately hides `category: null`, so an unclassified message
   * is invisible rather than merely unsorted. That is the right default when
   * the classifier has simply not reached something yet, and it makes silent
   * degradation dangerous without this: mail pulled while the model was
   * unavailable would sit in the database reachable from nowhere.
   *
   * Re-offering them on the next sync is what makes the degradation safe. Two
   * hundred is a ceiling on one prompt, not a limit on the backlog: it clears
   * over successive syncs.
   */
  const unclassified = await prisma.mailMessage.findMany({
    where: { category: null },
    orderBy: { receivedAt: "desc" },
    take: 200,
    select: { gmailId: true, threadId: true, direction: true, fromName: true, fromEmail: true, subject: true, body: true },
  });

  if (fresh.length === 0 && unclassified.length === 0) {
    /**
   * Refresh the calendar here too.
   *
   * This is the app's existing background job: it already runs when a page
   * opens and when Sync is pressed. Piggybacking keeps the ICS download out of
   * every page render, which is where it was costing 1.75 seconds a load.
   *
   * Best-effort, and after the mail is committed: a calendar feed that is slow
   * or down must not make a successful mail sync report as failed.
   */
  try {
    const profile = await prisma.profile.findUnique({
      where: { id: TENANT_ID },
      select: { icsCalendarUrl: true },
    });
    await refreshCalendarCache(profile?.icsCalendarUrl);
  } catch (error) {
    await recordFailure("refreshCalendarCache", error);
  }

  await markSynced(read);
    return NextResponse.json({ fetched: fetched.length, new: 0, matched: 0, errors });
  }

  const applications = await prisma.jobApplication.findMany({
    where: NOT_DELETED,
    include: { company: true },
    orderBy: { updatedAt: "desc" },
  });
  const validIds = new Set(applications.map((a) => a.id));

  let classifications: Classification[] = [];
  let classifierDown = false;
  try {
    const result = await generateStructured<{ results?: unknown }>({
      maxTokens: 4000,
      toolName: "classify_messages",
      schema: CLASSIFY_TOOL.input_schema as unknown as Record<string, unknown>,
      system:
        `You are triaging the user's job-search mail, which may come from more than one mailbox. For each message decide what it is, identify the employer and role it concerns, and attribute it to a tracked application only when both line up.

Rules:
- Attribute ONLY when the employer and the role both match a tracked application. Same employer but a different job is NOT a match: return an empty applicationId and fill detectedCompany and detectedRole. That case usually means an opportunity that is not being tracked yet, which is more valuable to surface than to bury under a sibling role.
- Automated mail from an applicant tracking system (Workday, Greenhouse, Lever, iCIMS, SmartRecruiters) names the employer in the subject or body. Use the employer, never the ATS vendor.
- FORWARDED MAIL: if the subject starts with "Fwd:"/"FW:" or the body contains a forwarded-message header, the real sender and employer are inside the quoted text, not in the From line. The From will be the user forwarding it to himself. Read through to the original message and classify that.
- A message marked SENT BY THE USER is his own outbound mail. Classify what it is about and attribute it to the application, but never treat his wording as the employer's decision: his own note is not a rejection or an offer.
- Marketing, newsletters, account notifications and job-board digests are not_job_related, even when they mention jobs. Only mail about a specific application, candidacy or approach counts.
- TIMES: today is ${todayLocalISO()}, and the user is in US Eastern. Fill proposedStart ONLY when the sender names one definite date and time. A relative date ("this Thursday") is fine to resolve; a date with no time, a range, a list of options, or "let me know what works" is NOT - leave it empty. A guessed time ends up on a real calendar, so an empty field is always the safer answer.`,
      user: [
            "Tracked applications (id — company — role):",
            applications.map((a) => `${a.id} — ${a.company.name} — ${a.roleTitle}`).join("\n"),
            "\nMessages to classify:",
            [...fresh, ...unclassified]
              .map((m) =>
                [
                  `gmailId: ${m.gmailId}`,
                  `direction: ${m.direction === "sent" ? "SENT BY THE USER" : "received"}`,
                  `from: ${m.fromName ?? ""} <${m.fromEmail}>`,
                  `subject: ${m.subject}`,
                  `body: ${m.body.slice(0, 1500)}`,
                ].join("\n")
              )
              .join("\n---\n"),
      ].join("\n"),
    });
    const raw = result.data.results;
    classifications = Array.isArray(raw) ? (raw as Classification[]) : [];
  } catch (e) {
    /**
     * Pull the mail anyway.
     *
     * Classification is an enhancement; fetching is the point. This used to
     * return 502 and abandon everything, so a dry Anthropic balance meant no
     * mail at all rather than unsorted mail - which is how "sync inbox" came
     * to fail with a billing error that made no sense from the Inbox page.
     *
     * Safe to degrade only because the next sync re-classifies whatever is
     * still uncategorised, so nothing is stranded invisible: the Inbox hides
     * `category: null` on purpose, and without the backfill below these
     * messages would be stored and unreachable.
     */
    classifierDown = true;
    await recordFailure("mailbox/sync classify", e, { messages: fresh.length });
  }

  const byId = new Map(classifications.map((c) => [c.gmailId, c]));
  let matched = 0;
  const statusChanges: { company: string; role: string; from: string; to: string }[] = [];

  for (const m of fresh) {
    const c = byId.get(m.gmailId);
    // Only trust an application id that actually exists; a hallucinated one
    // would silently attach a rejection to the wrong role.
    const applicationId = c?.applicationId && validIds.has(c.applicationId) ? c.applicationId : null;
    if (applicationId) matched += 1;

    // Upsert rather than create. The dedup read above happens *before* a Claude
    // classification call that takes several seconds, so two overlapping syncs
    // (the auto-sync on page open plus a manual "Sync now") both see the same
    // messages as new. The second one used to hit the gmailId unique constraint,
    // fail the whole request as "Sync failed", and abandon every message left in
    // the loop. Writing on conflict is idempotent, so the race is now harmless.
    //
    // On conflict the existing row wins for anything a human may have changed:
    // re-running a sync must never silently re-file a message Dan moved by hand,
    // or resurrect one he dismissed.
    const data = {
      threadId: m.threadId,
      fromEmail: m.fromEmail,
      fromName: m.fromName,
      // Recovered at sync time so it is stored once. Only kept when it is
      // someone other than Dan: a forward of his own reply names him, and
      // crediting him twice is no better than crediting him once.
      forwardedFromEmail: forwarded(m)?.email ?? null,
      forwardedFromName: tidySenderName(forwarded(m)?.name ?? null),
      subject: m.subject,
      snippet: m.snippet,
      body: m.body,
      receivedAt: m.receivedAt,
      direction: m.direction,
      category: c?.category ?? null,
      summary: c?.summary ?? null,
      proposedStart: parseProposed(c?.proposedStart),
      proposedLabel: c?.proposedLabel?.trim() || null,
      detectedCompany: c?.detectedCompany?.trim() || null,
      detectedRole: c?.detectedRole?.trim() || null,
      processedAt: c ? new Date() : null,
    };
    await prisma.mailMessage.upsert({
      where: { gmailId: m.gmailId },
      create: { gmailId: m.gmailId, applicationId, ...data },
      update: {},
    });

    // A message that states the stage outright moves the application with it.
    // Without this a rejection could arrive, be classified correctly, be filed
    // against the right role, and leave the pipeline still showing it as live.
    if (applicationId) {
      const app = applications.find((a) => a.id === applicationId);
      // Only mail that arrived can advance the stage. A note Dan sent is not
      // evidence about what the employer decided, and misreading his own
      // wording as a rejection would close a live application.
      const move = app && m.direction === "received" ? statusFromMail(c?.category, app.status) : null;
      if (app && move) {
        const stamp = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        await prisma.jobApplication.update({
          where: { id: applicationId },
          data: {
            status: move.next,
            notes: `${app.notes ? `${app.notes}\n\n` : ""}${stamp}: moved to ${move.next} automatically because ${move.reason} (${m.subject}).`,
          },
        });
        statusChanges.push({ company: app.company.name, role: app.roleTitle, from: app.status, to: move.next });
      }
    }
  }

  await markSynced(read);

  /**
   * Write the classifications for messages a previous sync could not sort.
   *
   * The loop above only walks `fresh`, so without this the backfill would
   * compute a category for every stranded message and then throw it away, and
   * they would stay invisible forever. Narrow on purpose: only the classifier
   * fields, and only where the row is still uncategorised, so this can never
   * overwrite something filed by hand between the read and the write.
   */
  let healed = 0;
  for (const m of unclassified) {
    const c = byId.get(m.gmailId);
    if (!c?.category) continue;
    const { count } = await prisma.mailMessage.updateMany({
      where: { gmailId: m.gmailId, category: null },
      data: {
        category: c.category,
        summary: c.summary ?? null,
        proposedStart: parseProposed(c.proposedStart),
        proposedLabel: c.proposedLabel?.trim() || null,
        detectedCompany: c.detectedCompany?.trim() || null,
        detectedRole: c.detectedRole?.trim() || null,
        processedAt: new Date(),
      },
    });
    healed += count;
  }

  // Job-related mail that matched no tracked application is the point of this
  // whole feature: it is usually an opportunity that is not being tracked.
  const leads = fresh.filter((m) => {
    const c = byId.get(m.gmailId);
    return c && c.category !== "not_job_related" && !(c.applicationId && validIds.has(c.applicationId));
  }).length;

  return NextResponse.json({
    fetched: fetched.length,
    new: fresh.length,
    matched,
    leads,
    statusChanges,
    // The UI says so rather than reporting a clean sync that sorted nothing.
    classifierDown,
    reclassified: healed,
    // A mailbox that failed while another worked. Empty on a clean sync.
    errors,
  });
}


/**
 * A proposed time is only kept when it parses and lands in the future. A model
 * resolving "Thursday" against the wrong week produces a plausible-looking date
 * in the past, which would be offered as a slot to confirm.
 */
function parseProposed(raw: string | undefined): Date | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (d.getTime() < Date.now() - 3_600_000) return null;
  // A year out is not an interview slot, it is a parsing accident.
  if (d.getTime() > Date.now() + 365 * 24 * 3_600_000) return null;
  return d;
}
