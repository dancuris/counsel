import { prisma } from "@/lib/prisma";
import { TENANT_ID } from "@/lib/tenant";
import { credentialStatuses } from "@/lib/credentials";
import { DRIVE_CONNECTION_ID } from "@/lib/google-connections";
import { connectedMailboxes } from "@/lib/mail-provider";
import { hasDriveScope } from "@/lib/drive-links";
import { NOT_DELETED } from "@/lib/data/applications";

/**
 * What is connected, worked out from the data rather than from a stored flag.
 *
 * Two decisions shape this, and the second is the important one.
 *
 * **State is derived.** A checklist with its own `completedSteps` column starts
 * lying the moment somebody disconnects an account or clears a field: it
 * records that a thing was once done, which is a different claim from the thing
 * being true now. Every step here asks the question the feature itself asks, so
 * a step that stops being satisfied simply reappears.
 *
 * **Nothing is required.** This is not a wizard with a finish line, and the app
 * is not broken until every box is ticked. Counsel is useful as a plain tracker
 * on day one: paste roles, keep contacts, record what happened. A model key
 * adds judgement. A mailbox adds mail that files itself. Drive adds documents
 * that land in folders you already have. Each is a capability you switch on
 * when it is worth it to you, and each one being absent is an ordinary state
 * rather than an error.
 *
 * So the wording is `unlocks`, never `blocks`. A setup screen that tells
 * somebody what is broken about their half-configured app teaches them the app
 * is fragile; one that tells them what the next step buys lets them decide.
 */

export type SetupStep = {
  id: string;
  title: string;
  /** Why somebody would want this, in one sentence. */
  why: string;
  connected: boolean;
  /** What turns on when this is connected. */
  unlocks: string;
  href: string;
  action: string;
  /** What was found, when it is connected. */
  detail?: string;
};

export async function setupSteps(): Promise<SetupStep[]> {
  const [profile, credentials, mailboxes, drive, applications, variants] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: TENANT_ID },
      select: { contactName: true, masterResume: true, icsCalendarUrl: true },
    }),
    credentialStatuses(),
    connectedMailboxes(),
    prisma.googleConnection.findUnique({ where: { id: DRIVE_CONNECTION_ID }, select: { email: true, scopes: true } }),
    prisma.jobApplication.count({ where: NOT_DELETED }),
    prisma.resumeVariant.count(),
  ]);

  const provider = credentials.find((c) => c.configured);
  const mailEmails = mailboxes.map((b) => b.email).join(", ");
  const hasContact = Boolean(profile?.contactName?.trim());
  const hasResume = variants > 0 || Boolean(profile?.masterResume?.trim());

  return [
    {
      id: "first-role",
      title: "Track a role",
      why: "Paste a job link. This works immediately, with nothing else set up.",
      connected: applications > 0,
      unlocks: "The pipeline, statuses, contacts and notes. This is the app as a tracker.",
      href: "/",
      action: applications > 0 ? "Open the pipeline" : "Paste a link",
      detail: applications > 0 ? `${applications} tracked` : undefined,
    },
    {
      id: "model",
      title: "Add a model key",
      why: "Your own Anthropic or Gemini key. Calls are billed to you and to nobody else.",
      connected: Boolean(provider),
      unlocks: "Honest fit judgements on a posting, drafting notes, and interview prep.",
      href: "/settings",
      action: provider ? "Manage keys" : "Add a key",
      detail: provider
        ? `${provider.label} ${provider.hint ?? ""}${provider.source === "environment" ? " (from the environment)" : ""}`
        : undefined,
    },
    {
      id: "identity",
      title: "Say who you are",
      why: "Name, email and phone. The app writes these onto documents itself, never a model, so they cannot come out as placeholders.",
      connected: hasContact,
      unlocks: "A real header and letterhead on anything generated.",
      href: "/profile",
      action: hasContact ? "Review" : "Fill this in",
      detail: hasContact ? (profile?.contactName ?? undefined) : undefined,
    },
    {
      id: "resume",
      title: "Give it your career",
      why: "Tailored documents are cut from a base resume rather than invented, which is what stops a model manufacturing a job you never had.",
      connected: hasResume,
      unlocks: "Tailored resumes and cover letters per role, and evaluations that weigh your actual background.",
      href: "/profile",
      action: hasResume ? "Review" : "Paste your resume",
      detail: hasResume ? `${variants} resume variant${variants === 1 ? "" : "s"}` : undefined,
    },
    {
      id: "mailbox",
      title: "Connect a job-search mailbox",
      why: "Gmail or Fastmail. Best pointed at a dedicated address rather than your personal one.",
      connected: mailboxes.length > 0,
      unlocks: "Recruiter mail filed against the right role, rejections and invitations moving the pipeline by themselves, and follow-up timing that knows when anyone last wrote.",
      href: "/settings",
      action: mailboxes.length ? "Connected" : "Connect",
      detail: mailEmails || undefined,
    },
    {
      id: "calendar",
      title: "Subscribe to your calendar",
      why: "A read-only feed URL from Google, Fastmail, Proton or anything else that publishes one.",
      connected: Boolean(profile?.icsCalendarUrl?.trim()),
      unlocks: "Meetings booked elsewhere appearing on Today, and a warning when a proposed interview time clashes.",
      href: "/settings",
      action: profile?.icsCalendarUrl ? "Change" : "Add the feed URL",
    },
    {
      id: "drive",
      title: "Connect Google Drive",
      why: "Optional even among the optional ones. Documents are generated, stored and downloadable without it.",
      connected: Boolean(drive?.email) && hasDriveScope(drive?.scopes),
      unlocks: "Every document filed into your own folders, so the link you open on a phone is always the current version.",
      href: "/settings",
      action: drive?.email ? "Connected" : "Connect",
      detail: drive?.email ?? undefined,
    },
  ];
}
