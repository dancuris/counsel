import { prisma } from "@/lib/prisma";
import {
  JOB_STATUS_LABELS,
  CORRESPONDENCE_TYPE_LABELS,
  type JobStatus,
  type CorrespondenceType,
  type DocumentType,
  DOCUMENT_FILENAME_LABELS,
} from "@/lib/constants";

/**
 * One timeline per application: everything that has happened to it, newest
 * first.
 *
 * Most of it is derived rather than logged. Documents, evaluations,
 * correspondence, interview notes and mail all already write a dated row, so
 * the history is sitting in the database and only needs assembling - which is
 * why this works retroactively over the whole search rather than starting from
 * the day it shipped. ActivityLog covers only what leaves no other trace: a
 * status transition, a title correction, a follow-up being closed.
 *
 * The assembly is a pure function over plain arrays so it can be tested
 * without a database; `getApplicationActivity` is the thin query around it.
 */

export type ActivityKind =
  | "created"
  | "status"
  | "document"
  | "evaluation"
  | "correspondence"
  | "mail"
  | "interview"
  | "followup"
  | "upload"
  | "jd"
  | "edit";

export type ActivityItem = {
  at: Date;
  kind: ActivityKind;
  title: string;
  /** Secondary line: the transition, the recipient, the word count. */
  detail?: string;
  /** Anchor on the application page, so an entry can be clicked back to its panel. */
  href?: string;
};

export type ActivityInput = {
  createdAt: Date;
  documents: { id: string; type: string; content: string; generatedAt: Date }[];
  evaluations: { recommendation: string; model: string; generatedAt: Date }[];
  correspondence: {
    type: string;
    direction: string;
    recipientName: string;
    subject: string | null;
    status: string;
    sentAt: Date | null;
    createdAt: Date;
  }[];
  mailMessages: { direction: string; fromEmail: string; subject: string; receivedAt: Date }[];
  interviewNotes: { roundName: string; createdAt: Date }[];
  followUps: { note: string; createdAt: Date }[];
  uploadedFiles: { fileName: string; uploadedAt: Date }[];
  jobDescriptions: { rawText: string; pastedAt: Date }[];
  activityLog: { action: string; summary: string; detail: string | null; createdAt: Date }[];
};

function typeLabel(type: string): string {
  return DOCUMENT_FILENAME_LABELS[type as DocumentType]
    ? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : type.replace(/_/g, " ");
}

export function buildActivity(input: ActivityInput): ActivityItem[] {
  const items: ActivityItem[] = [];

  items.push({ at: input.createdAt, kind: "created", title: "Added to the pipeline" });

  // Documents are append-only, so each row IS a version. Numbering runs oldest
  // first within a type, which is the opposite of how they are listed on the
  // page and the only way v1 means the first one.
  const byType = new Map<string, typeof input.documents>();
  for (const doc of input.documents) {
    byType.set(doc.type, [...(byType.get(doc.type) ?? []), doc]);
  }
  for (const [type, docs] of byType) {
    const ordered = [...docs].sort((a, b) => a.generatedAt.getTime() - b.generatedAt.getTime());
    ordered.forEach((doc, i) => {
      const words = doc.content.trim() ? doc.content.trim().split(/\s+/).length : 0;
      items.push({
        at: doc.generatedAt,
        kind: "document",
        title: `${typeLabel(type)} v${i + 1}${i === ordered.length - 1 ? " (current)" : ""}`,
        detail: `${words.toLocaleString()} words`,
        href: "#section-documents",
      });
    });
  }

  for (const evaluation of input.evaluations) {
    items.push({
      at: evaluation.generatedAt,
      kind: "evaluation",
      title: `Evaluated: ${evaluation.recommendation}`,
      detail: evaluation.model,
      href: "#section-evaluation",
    });
  }

  for (const item of input.correspondence) {
    const label = CORRESPONDENCE_TYPE_LABELS[item.type as CorrespondenceType] ?? item.type;
    // A sent message is dated by when it left, a draft by when it was written,
    // so a reply sits beside the message it answers.
    // `sent_externally` is Dan's own claim that he replied from another mail
    // client - true for the ecuris threads, which Workspace hands to Proton.
    // The timeline must date it as sent or a message that went out reads as an
    // unsent draft forever.
    const sent = (item.status === "sent" || item.status === "sent_externally") && item.sentAt;
    items.push({
      at: sent ? (item.sentAt as Date) : item.createdAt,
      kind: "correspondence",
      title: sent
        ? `${item.status === "sent_externally" ? "Sent (from another client)" : "Sent"} ${label.toLowerCase()} to ${item.recipientName}`
        : `Drafted ${label.toLowerCase()} to ${item.recipientName}`,
      detail: item.subject ?? undefined,
      href: "#section-messages",
    });
  }

  for (const mail of input.mailMessages) {
    items.push({
      at: mail.receivedAt,
      kind: "mail",
      title: mail.direction === "sent" ? `Mail sent to ${mail.fromEmail}` : `Mail from ${mail.fromEmail}`,
      detail: mail.subject,
      href: "#section-messages",
    });
  }

  for (const note of input.interviewNotes) {
    items.push({ at: note.createdAt, kind: "interview", title: `Interview note: ${note.roundName}`, href: "#section-notes" });
  }

  for (const followUp of input.followUps) {
    items.push({ at: followUp.createdAt, kind: "followup", title: "Follow-up added", detail: followUp.note, href: "#section-followups" });
  }

  for (const file of input.uploadedFiles) {
    items.push({ at: file.uploadedAt, kind: "upload", title: `File uploaded: ${file.fileName}`, href: "#section-files" });
  }

  for (const jd of input.jobDescriptions) {
    const words = jd.rawText.trim() ? jd.rawText.trim().split(/\s+/).length : 0;
    items.push({
      at: jd.pastedAt,
      kind: "jd",
      title: "Job description saved",
      detail: `${words.toLocaleString()} words`,
      href: "#section-jd",
    });
  }

  for (const entry of input.activityLog) {
    items.push({
      at: entry.createdAt,
      kind: entry.action === "status_changed" ? "status" : "edit",
      title: entry.summary,
      detail: parseTransition(entry.detail),
    });
  }

  // Newest first, and ties broken so the same second reads in a stable order
  // rather than shuffling between renders.
  return items.sort((a, b) => b.at.getTime() - a.at.getTime() || a.title.localeCompare(b.title));
}

/** `{ from, to }` rendered as "Applied -> Interviewing", using the status labels where they apply. */
export function parseTransition(detail: string | null): string | undefined {
  if (!detail) return undefined;
  try {
    const parsed = JSON.parse(detail) as { from?: unknown; to?: unknown };
    const label = (v: unknown) =>
      typeof v === "string" ? JOB_STATUS_LABELS[v as JobStatus] ?? v : String(v ?? "");
    if (parsed.from === undefined && parsed.to === undefined) return undefined;
    return `${label(parsed.from) || "(empty)"} -> ${label(parsed.to) || "(empty)"}`;
  } catch {
    return undefined;
  }
}

export async function getApplicationActivity(applicationId: string): Promise<ActivityItem[]> {
  // Deliberately its own query rather than reusing the page's includes: those
  // cap evaluations and job descriptions to the most recent few, which is right
  // for the panels and wrong for a history. Selects are narrow - no document
  // content beyond what the word count needs.
  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    select: {
      createdAt: true,
      documents: { select: { id: true, type: true, content: true, generatedAt: true } },
      evaluations: { select: { recommendation: true, model: true, generatedAt: true } },
      correspondence: {
        select: {
          type: true,
          direction: true,
          recipientName: true,
          subject: true,
          status: true,
          sentAt: true,
          createdAt: true,
        },
      },
      mailMessages: { select: { direction: true, fromEmail: true, subject: true, receivedAt: true } },
      interviewNotes: { select: { roundName: true, createdAt: true } },
      followUps: { select: { note: true, createdAt: true } },
      uploadedFiles: { select: { fileName: true, uploadedAt: true } },
      jobDescriptions: { select: { rawText: true, pastedAt: true } },
      activityLog: { select: { action: true, summary: true, detail: true, createdAt: true } },
    },
  });
  if (!application) return [];
  return buildActivity(application);
}
