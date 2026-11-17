import { prisma } from "@/lib/prisma";
import { MAIL_CONNECTION_ID } from "@/lib/google-connections";
import { latestMessageRef, sendMail as sendGmail, type MailAttachment } from "@/lib/google-mail";
import { getFastmailConnection, isFastmailId, latestFastmailMessageRef, sendFastmail } from "@/lib/fastmail";
import { TENANT_ID } from "@/lib/tenant";

/**
 * Which mailbox a message goes out through, decided in one place.
 *
 * With two providers, "send" has to answer a question it never had to before,
 * and the answer must not be duplicated into each caller: the send route, the
 * test send, invitations and request notices would each grow their own rule
 * and disagree. Everything that sends calls `sendViaMailbox`.
 *
 * The order:
 *
 * 1. **A reply goes back the way the thread came.** A Fastmail thread id can
 *    only be continued from Fastmail, and a Gmail one only from Gmail, or the
 *    recipient sees the reply arrive from a different address.
 * 2. **A new message uses the default chosen in Settings**, if that mailbox is
 *    connected.
 * 3. **Otherwise whichever is connected**, Gmail first, because that is what
 *    every existing deployment already sends from.
 */

export type MailProvider = "gmail" | "fastmail";
export const MAIL_PROVIDERS: MailProvider[] = ["gmail", "fastmail"];
export const PROVIDER_LABEL: Record<MailProvider, string> = { gmail: "Gmail", fastmail: "Fastmail" };

export function isMailProvider(v: unknown): v is MailProvider {
  return v === "gmail" || v === "fastmail";
}

export type MailboxSummary = { provider: MailProvider; email: string; lastSyncedAt: Date | null; canSend: boolean };

/** Every connected mailbox, Gmail first. Empty when none is connected. */
export async function connectedMailboxes(): Promise<MailboxSummary[]> {
  const [gmail, fastmail] = await Promise.all([
    prisma.googleConnection.findUnique({
      where: { id: MAIL_CONNECTION_ID },
      select: { email: true, lastSyncedAt: true },
    }),
    getFastmailConnection(),
  ]);
  const out: MailboxSummary[] = [];
  if (gmail) out.push({ provider: "gmail", email: gmail.email, lastSyncedAt: gmail.lastSyncedAt, canSend: true });
  if (fastmail) {
    out.push({ provider: "fastmail", email: fastmail.email, lastSyncedAt: fastmail.lastSyncedAt, canSend: fastmail.canSend });
  }
  return out;
}

/** The oldest last-sync across connected mailboxes: the honest "synced" time. */
export function oldestSync(boxes: MailboxSummary[]): Date | null {
  if (boxes.some((b) => !b.lastSyncedAt)) return null;
  const times = boxes.map((b) => b.lastSyncedAt!.getTime());
  return times.length ? new Date(Math.min(...times)) : null;
}

export async function chooseProvider(threadId?: string | null): Promise<MailProvider> {
  const boxes = await connectedMailboxes();
  const has = (p: MailProvider) => boxes.some((b) => b.provider === p);

  if (threadId) {
    const p: MailProvider = isFastmailId(threadId) ? "fastmail" : "gmail";
    if (!has(p)) {
      throw new Error(
        `This thread came from ${PROVIDER_LABEL[p]}, which is not connected, so a reply would arrive from a different address. Reconnect it from Settings. Nothing was sent.`
      );
    }
    return p;
  }

  const profile = await prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { sendMailVia: true } });
  const preferred = isMailProvider(profile?.sendMailVia) ? profile.sendMailVia : null;
  if (preferred && has(preferred)) return preferred;
  if (has("gmail")) return "gmail";
  if (has("fastmail")) return "fastmail";
  throw new Error("No mailbox connected. Connect Gmail or Fastmail from Settings.");
}

export async function sendViaMailbox(opts: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  threadId?: string | null;
  attachments?: MailAttachment[];
}): Promise<{ id: string; threadId: string; provider: MailProvider }> {
  const provider = await chooseProvider(opts.threadId);
  if (provider === "fastmail") {
    const threadRef = await latestFastmailMessageRef(opts.threadId);
    const sent = await sendFastmail({ ...opts, threadRef });
    return { ...sent, provider };
  }
  const threadRef = opts.threadId ? await latestMessageRef(opts.threadId) : null;
  const sent = await sendGmail({ ...opts, threadRef });
  return { ...sent, provider };
}
