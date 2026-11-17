import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { MAIL_CONNECTION_ID, DRIVE_CONNECTION_ID } from "@/lib/google-connections";
import { hasDriveScope, driveFolderUrl } from "@/lib/drive-links";
import { formatDateTime } from "@/lib/format";
import { MailboxSyncButton } from "@/components/MailboxSyncButton";
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@/lib/models";
import { SubmitButton } from "@/components/SubmitButton";
import { ModelConsole } from "@/components/ModelConsole";
import { saveDefaultModel, saveIntegrations, disconnectFastmailAction, saveSendMailVia } from "./actions";
import { getFastmailConnection } from "@/lib/fastmail";
import { FastmailConnect } from "@/components/FastmailConnect";
import { ConfirmButton } from "@/components/ConfirmButton";
import { buttonClass, inputClass } from "@/lib/button";
import { FailurePanel } from "@/components/FailurePanel";
import { PAGE_TITLE, PAGE_LEDE, PAGE_READING, SECTION_GAP, ERROR_BLOCK, PAGE_HEADER } from "@/lib/type";
import { TENANT_ID } from "@/lib/tenant";
import { ApiKeys } from "@/components/ApiKeys";
import { PasswordSection } from "@/components/PasswordSection";
import { ownerEmail } from "@/lib/owner";
import { PlatformKeys } from "@/components/PlatformKeys";

export const dynamic = "force-dynamic";

/**
 * How the app behaves, as opposed to what it knows about Dan.
 *
 * The split is deliberate and worth keeping: `/profile` holds the *content*
 * that grounds every model call - positioning, career narrative, resume
 * variants, standing preferences. Settings holds the machinery. The default
 * model was on Profile and moved here rather than being copied, because two
 * editors over one field is how a stale form silently reverts it.
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ mailbox?: string; drive?: string }>;
}) {
  // The OAuth callback returns here now, so the outcome banners live here too.
  const { mailbox, drive } = await searchParams;
  // Null on an instance that signs in with Google, which is what hides the
  // password form there.
  const owner = await ownerEmail();
  const [profile, recentApp, recentContact, connection, driveConnection, mailCount, fastmail] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: TENANT_ID },
      select: { preferredModel: true, icsCalendarUrl: true, driveRootFolderId: true, sendMailVia: true },
    }),
    prisma.jobApplication.findFirst({
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, roleTitle: true, company: { select: { name: true } } },
    }),
    prisma.contact.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.googleConnection.findUnique({ where: { id: MAIL_CONNECTION_ID } }),
    prisma.googleConnection.findUnique({ where: { id: DRIVE_CONNECTION_ID } }),
    prisma.mailMessage.count(),
    getFastmailConnection(),
  ]);
  const driveAuthorised = hasDriveScope(driveConnection?.scopes);

  // Real paths, so the console's page picker offers somewhere worth looking
  // rather than making him remember route names. The detail pages need a real
  // id, which is the whole reason this is computed server-side.
  const pagePaths = [
    "/",
    "/pipeline",
    "/inbox",
    "/contacts",
    "/follow-ups",
    "/retrospective",
    "/profile",
    "/settings",
    ...(recentApp ? [`/applications/${recentApp.id}?tab=work`, `/applications/${recentApp.id}?tab=talk`] : []),
    ...(recentContact ? [`/contacts/${recentContact.id}`] : []),
  ];

  return (
    <div className={PAGE_READING}>
      <header className={PAGE_HEADER}>
        <h1 className={PAGE_TITLE}>Settings</h1>
        <p className={PAGE_LEDE}>
          How the app behaves. What it knows about you is on{" "}
          <Link href="/profile" className="text-accent hover:underline">
            Profile
          </Link>
          .
        </p>
      </header>

      {/*
        Under Settings rather than Profile: it describes how the app behaves,
        which is the sentence at the top of this page, where Profile is the
        career record.
      */}
      <Link
        href="/setup"
        className="mt-7 flex items-center justify-between gap-4 rounded-lg border border-line bg-[var(--surface-2)] px-4 py-3 transition-colors hover:bg-[var(--surface)]"
      >
        <span>
          <span className="block text-[13px] font-medium text-[var(--tx)]">Getting started</span>
          <span className="block text-[12.5px] text-[var(--tx-3)]">
            What is connected and what each thing turns on. Nothing is required.
          </span>
        </span>
        <span className="text-[var(--tx-3)]">&#8250;</span>
      </Link>

      <Link
        href="/settings/style"
        className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-line bg-[var(--surface-2)] px-4 py-3 transition-colors hover:bg-[var(--surface)]"
      >
        <span>
          <span className="block text-[13px] font-medium text-[var(--tx)]">Style guide</span>
          <span className="block text-[12.5px] text-[var(--tx-3)]">
            The writing and interface rules, with every example produced by the code that enforces them.
          </span>
        </span>
        <span className="text-[var(--tx-3)]">&#8250;</span>
      </Link>

      {/*
        Under Settings and not on Today, deliberately. These are not things to
        act on this morning; they are what you look at when something feels off,
        which is the difference between a diagnostic and a task.
      */}
      <section className={`${SECTION_GAP} border-t border-line pt-8`}>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">
          Quiet failures
        </h2>
        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
          Background work is deliberately allowed to fail without interrupting you: a Drive upload must not make
          a saved document report as lost. This is where those go, so a capability that has quietly stopped
          working is findable instead of merely absent.
        </p>
        <div className="mt-4 rounded-xl border border-line p-4">
          <FailurePanel />
        </div>
      </section>

      <section className={`${SECTION_GAP}`}>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">Ask a model about the app</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--tx-2)]">
          Everything else here is grounded and narrow: the assistant sees one role, Ask sees the search, the review
          sees a document. None of them can see the app. This one can, and it will tell you when you are wrong.
        </p>
        <div className="mt-4">
          <ModelConsole pagePaths={pagePaths} defaultModel={profile?.preferredModel || DEFAULT_MODEL} />
        </div>
      </section>

      <section className={`${SECTION_GAP} border-t border-line pt-8`}>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">Model providers</h2>
        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
          Your own keys, on your own instance. Counsel runs one deployment per person with its own database, so the
          only account paying for these calls is yours and the only job search in here is yours.
        </p>
        <div className="mt-4 rounded-xl border border-line p-4">
          <ApiKeys />
        </div>
      </section>

      <section className={`${SECTION_GAP} border-t border-line pt-8`}>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">
          Handing out instances
        </h2>
        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
          With a Vercel token and a Neon API key, Counsel can create a whole instance for somebody else: their own
          database, their own keys, nothing shared with yours. Both are encrypted before they are stored.
        </p>
        <div className="mt-4 rounded-xl border border-line p-4">
          <PlatformKeys />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/instances" className={buttonClass("outline", "sm")}>
            Manage instances
          </Link>
          <Link href="/requests" className={buttonClass("outline", "sm")}>
            Requests
          </Link>
        </div>
      </section>

      {/* Only where a password is actually in use: an instance signing in with
          Google has nothing here to change. */}
      {owner && <PasswordSection email={owner} />}

      <section className={`${SECTION_GAP} border-t border-line pt-8`}>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">Accounts</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--tx-2)]">
          The search runs from a dedicated mailbox, Gmail, Fastmail or both, and the document archive already lives in
          the Drive with the storage.
        </p>
      <section className="mt-3 panel p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-[var(--tx)]">Job-search mailbox</h2>
        <p className="mt-0.5 text-xs text-[var(--tx-2)]">
          Connect the dedicated address you use for applications. Counsel reads it to log recruiter mail, rejections
          and interview invites against the right role. Read-only, and message text is sent to Claude to classify it, so
          connect a job-search account rather than a personal one.
        </p>

        {mailbox === "connected" && (
          <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">Mailbox connected.</p>
        )}
        {mailbox && mailbox !== "connected" && (
          <p className={ERROR_BLOCK}>
            Couldn&apos;t connect: {mailbox.replace(/_/g, " ")}.
          </p>
        )}

        {connection ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[var(--tx)]">{connection.email}</span>
              <span className="block text-xs text-[var(--tx-3)]">
                {mailCount} {mailCount === 1 ? "message" : "messages"} pulled ·{" "}
                {connection.lastSyncedAt ? `last synced ${formatDateTime(connection.lastSyncedAt)}` : "never synced"}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <MailboxSyncButton />
              <a href="/api/google/mailbox" className="text-xs text-[var(--tx-3)] hover:text-accent hover:underline">
                Reconnect
              </a>
            </span>
          </div>
        ) : (
          <a
            href="/api/google/mailbox"
            className={buttonClass("primary", "md", "mt-3 inline-block")}
          >
            Connect a mailbox
          </a>
        )}
      </section>

      <section className="mt-3 panel p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-[var(--tx)]">Fastmail</h2>
        <p className="mt-0.5 text-xs text-[var(--tx-2)]">
          A second mailbox, alongside Gmail or instead of it. Sync reads both, and a reply goes back out through the
          mailbox its thread came from. Create a token in Fastmail under Settings, Privacy &amp; Security, API tokens,
          with the Email scope to read and Email submission to send. Message text is sent to Claude to classify it, the
          same as Gmail.
        </p>

        {fastmail ? (
          <>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-[var(--tx)]">{fastmail.email}</span>
                <span className="block text-xs text-[var(--tx-3)]">
                  token {fastmail.hint} · {fastmail.canSend ? "reads and sends" : "read only, cannot send"} ·{" "}
                  {fastmail.lastSyncedAt ? `last synced ${formatDateTime(fastmail.lastSyncedAt)}` : "never synced"}
                </span>
              </span>
              <span className="flex items-center gap-3">
                {!connection && <MailboxSyncButton />}
                <ConfirmButton
                  label="Disconnect"
                  question={`Disconnect ${fastmail.email}? Mail already pulled stays; nothing new arrives from it.`}
                  confirmLabel="Disconnect it"
                  action={disconnectFastmailAction}
                  pendingLabel="Disconnecting..."
                />
              </span>
            </div>
            <FastmailConnect replacing />
          </>
        ) : (
          <FastmailConnect replacing={false} />
        )}

        {/* Only a real choice when both can send. With one mailbox there is
            nothing to pick, and a select with one option is a control that can
            do nothing. */}
        {connection && fastmail?.canSend && (
          <form action={saveSendMailVia} className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <label htmlFor="sendMailVia" className="text-[13px] text-[var(--tx-2)]">
              Send new messages from
            </label>
            <select
              id="sendMailVia"
              name="sendMailVia"
              key={profile?.sendMailVia ?? "gmail"}
              defaultValue={profile?.sendMailVia ?? "gmail"}
              className={inputClass("sm")}
            >
              <option value="gmail">{connection.email} (Gmail)</option>
              <option value="fastmail">{fastmail.email} (Fastmail)</option>
            </select>
            <SubmitButton className={buttonClass("outline", "sm")} pendingLabel="Saving...">
              Save
            </SubmitButton>
            <span className="basis-full text-[11.5px] text-[var(--tx-3)]">
              Replies always go out from the mailbox the thread came from.
            </span>
          </form>
        )}
      </section>

      <section className="mt-3 panel p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-[var(--tx)]">Google Drive</h2>
        <p className="mt-0.5 text-xs text-[var(--tx-2)]">
          A separate account, deliberately. The job search runs from the mailbox above, but the document archive
          already lives in the Drive with the storage. Counsel files every generated resume and cover letter under the
          folder named below, and nothing outside it.
        </p>

        {drive === "connected" && (
          <p className="mt-3 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">Drive account connected.</p>
        )}
        {drive && drive !== "connected" && (
          <p className={ERROR_BLOCK}>
            Couldn&apos;t connect: {drive.replace(/_/g, " ")}.
          </p>
        )}

        {/* Granting a scope is not retroactive: a connection made before the
            scope existed carries a token Drive will refuse. Say so here rather
            than letting the first document save fail with a 403 nobody sees. */}
        {driveConnection && !driveAuthorised && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            This connection is missing Drive permission, so generated documents aren&apos;t being filed. Reconnect to
            grant it.
          </p>
        )}

        {/* The tree has to be named before anything is written. Left unset, the
            first save creates a fresh folder at the Drive root and forks the
            archive it was supposed to file into. */}
        {driveAuthorised && !profile?.driveRootFolderId && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            No folder set yet. Paste the folder&apos;s URL into &ldquo;Google Drive folder ID&rdquo; below before
            generating anything, or Counsel will start a new tree instead of using the existing one.
          </p>
        )}

        {driveConnection ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-[var(--tx)]">{driveConnection.email}</span>
              <span className="block text-xs text-[var(--tx-3)]">
                {driveAuthorised ? "Drive connected" : "no Drive access"} ·{" "}
                {profile?.driveRootFolderId ? "folder set" : "no folder set"}
              </span>
            </span>
            <a
              href="/api/google/mailbox?target=drive"
              className="text-xs text-[var(--tx-3)] hover:text-accent hover:underline"
            >
              Reconnect
            </a>
          </div>
        ) : (
          <a
            href="/api/google/mailbox?target=drive"
            className={buttonClass("primary", "md", "mt-3 inline-block")}
          >
            Connect Google Drive
          </a>
        )}
      </section>

      </section>

      <section className={`${SECTION_GAP} border-t border-line pt-8`}>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">Connections</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--tx-2)]">
          Where the app reads your calendar and files your documents. Both moved off Profile, which holds what the
          app knows about you rather than how it is wired.
        </p>
        <form
          key={`${profile?.icsCalendarUrl ?? ""}:${profile?.driveRootFolderId ?? ""}`}
          action={saveIntegrations}
          className="mt-3 space-y-4"
        >
          <div>
            <label className="text-xs font-medium text-[var(--tx-2)]">Calendar (ICS subscription URL)</label>
            <input
              name="icsCalendarUrl"
              type="url"
              defaultValue={profile?.icsCalendarUrl ?? ""}
              placeholder="https://www.fastmail.com/... or any read-only .ics feed"
              className={`mt-1 ${inputClass("md")}`}
            />
            <p className="mt-1 text-xs text-[var(--tx-3)]">
              Read only. Used to warn you if a new interview time overlaps something already on your calendar.
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-[var(--tx-2)]">Google Drive folder</label>
            <input
              name="driveRootFolderId"
              defaultValue={profile?.driveRootFolderId ?? ""}
              placeholder="1AbC... or paste the folder URL"
              className={`mt-1 w-full font-mono ${inputClass("sm")}`}
            />
            {profile?.driveRootFolderId && (
              <p className="mt-1.5 text-xs">
                <a
                  href={driveFolderUrl(profile.driveRootFolderId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  Open this folder in Drive
                </a>
                {driveConnection?.email && (
                  <span className="text-[var(--tx-3)]">
                    {" "}
                    - signed in as {driveConnection.email}. It is a different account from the mailbox, so the folder
                    is invisible from your other Google login.
                  </span>
                )}
              </p>
            )}
            <p className="mt-1 text-xs text-[var(--tx-3)]">
              Where generated documents get filed, as company / role subfolders. Pointed at your existing Jobs folder,
              Counsel files into the company folders already there rather than making its own. A paste that does not
              parse is rejected rather than clearing this, since a silently emptied folder id sends every later
              document somewhere new.
            </p>
          </div>
          <SubmitButton>Save connections</SubmitButton>
        </form>
      </section>

      <section className={`${SECTION_GAP} border-t border-line pt-8`}>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">Default model</h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--tx-2)]">
          Used by every evaluation, draft and review that is not given a model of its own. Second opinions and document
          reviews deliberately run on the other provider regardless of what is set here.
        </p>
        {/* Keyed on the stored value so it repaints if something else writes
            the field, rather than showing a value the database no longer holds. */}
        <form key={profile?.preferredModel ?? "default"} action={saveDefaultModel} className="mt-3 flex flex-wrap items-center gap-2">
          <select
            name="preferredModel"
            defaultValue={profile?.preferredModel ?? ""}
            className={inputClass("md")}
          >
            <option value="">Default ({process.env.CLAUDE_MODEL || DEFAULT_MODEL})</option>
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <SubmitButton>Save</SubmitButton>
        </form>
      </section>
    </div>
  );
}
