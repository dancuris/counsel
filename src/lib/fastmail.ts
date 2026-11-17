import { prisma } from "@/lib/prisma";
import { seal, unseal, hintOf } from "@/lib/secrets";
import { refuseInDemo } from "@/lib/demo";
import { buildRawMessage, type FetchedMessage, type MailAttachment } from "@/lib/google-mail";

/**
 * Fastmail, as a second mailbox beside Gmail.
 *
 * Dan moved his ecuris.com mail off Proton to Fastmail. Proton had no API, which
 * is why ecuris threads used to reach Counsel only as forwards into Gmail and
 * replies had to be pasted back by hand ("sent_externally"). Fastmail speaks
 * JMAP (RFC 8620/8621), so the mailbox can be read and sent from directly.
 *
 * **Auth is an API token, not OAuth.** Fastmail's OAuth needs a registered
 * client, which a one-deployment-per-person app cannot assume. A token is
 * created in Fastmail under Settings > Privacy & Security > API tokens, with the
 * Email (read) and Email submission scopes, pasted once into Settings, and
 * stored sealed exactly like a model key. It never leaves the server and is
 * never shown back.
 *
 * **Ids are prefixed.** Mail lives in `MailMessage.gmailId` and sent
 * correspondence in `gmailMessageId` / `gmailThreadId`. Those columns predate a
 * second provider and renaming them would touch every reader, so a Fastmail id
 * is stored as `fastmail:<jmap id>`. Gmail ids are bare hex and can never start
 * with that prefix, so the provider of any stored id is decidable from the id
 * alone, which is what lets a reply go back out through the mailbox the thread
 * came from.
 */

export const FASTMAIL_PREFIX = "fastmail:";
const SESSION_URL = "https://api.fastmail.com/jmap/session";

const CORE = "urn:ietf:params:jmap:core";
const MAIL = "urn:ietf:params:jmap:mail";
const SUBMISSION = "urn:ietf:params:jmap:submission";

export function isFastmailId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.startsWith(FASTMAIL_PREFIX);
}

const wrap = (id: string) => `${FASTMAIL_PREFIX}${id}`;
const unwrap = (id: string) => (id.startsWith(FASTMAIL_PREFIX) ? id.slice(FASTMAIL_PREFIX.length) : id);

// ---------------------------------------------------------------------------
// Connection storage
// ---------------------------------------------------------------------------

export const FASTMAIL_CONNECTION_ID = "singleton";

export async function getFastmailConnection() {
  try {
    return await prisma.fastmailConnection.findUnique({ where: { id: FASTMAIL_CONNECTION_ID } });
  } catch {
    // An un-migrated deployment has no table yet. That is "not connected", not
    // a reason to take the Inbox down.
    return null;
  }
}

async function storedToken(): Promise<string> {
  const conn = await getFastmailConnection();
  if (!conn) throw new Error("No Fastmail account connected. Connect one from Settings.");
  const token = unseal(conn.sealedToken);
  if (!token) {
    throw new Error("The stored Fastmail token can no longer be read (the session secret changed). Paste it again in Settings.");
  }
  return token;
}

/**
 * Verifies a token against Fastmail before anything is stored, so a typo or a
 * token missing the send scope is reported on the Settings page rather than on
 * the first sync or, worse, the first send.
 */
export async function connectFastmail(token: string): Promise<{ email: string; canSend: boolean }> {
  refuseInDemo("connecting a mailbox");
  const trimmed = token.trim();
  if (!trimmed) throw new Error("Paste a Fastmail API token. Nothing was changed.");

  const session = await fetchSession(trimmed);
  if (!session.primaryAccounts[MAIL]) {
    throw new Error("That token does not grant mail access. Create one with the Email scope. Nothing was changed.");
  }
  const canSend = Boolean(session.primaryAccounts[SUBMISSION]);
  const email = session.username.toLowerCase();

  await prisma.fastmailConnection.upsert({
    where: { id: FASTMAIL_CONNECTION_ID },
    create: { id: FASTMAIL_CONNECTION_ID, email, sealedToken: seal(trimmed), hint: hintOf(trimmed), canSend },
    update: { email, sealedToken: seal(trimmed), hint: hintOf(trimmed), canSend },
  });
  return { email, canSend };
}

export async function disconnectFastmail(): Promise<void> {
  await prisma.fastmailConnection.deleteMany({ where: { id: FASTMAIL_CONNECTION_ID } });
}

export async function markFastmailSynced(): Promise<void> {
  await prisma.fastmailConnection.updateMany({
    where: { id: FASTMAIL_CONNECTION_ID },
    data: { lastSyncedAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// JMAP plumbing
// ---------------------------------------------------------------------------

type Session = {
  apiUrl: string;
  uploadUrl: string;
  username: string;
  primaryAccounts: Record<string, string>;
};

async function fetchSession(token: string): Promise<Session> {
  let res: Response;
  try {
    res = await fetch(SESSION_URL, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(`Could not reach Fastmail: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("Fastmail rejected the API token. It may have been revoked; create a new one and paste it in Settings.");
  }
  if (!res.ok) throw new Error(`Fastmail session failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as Partial<Session>;
  // Model output is not the only untrusted input: check the shape of anything
  // read off the wire before relying on it.
  if (typeof body.apiUrl !== "string" || typeof body.username !== "string" || !body.primaryAccounts) {
    throw new Error("Fastmail returned a session without the fields Counsel needs.");
  }
  return {
    apiUrl: body.apiUrl,
    uploadUrl: typeof body.uploadUrl === "string" ? body.uploadUrl : "",
    username: body.username,
    primaryAccounts: body.primaryAccounts,
  };
}

type Ctx = { token: string; session: Session; accountId: string };

async function context(): Promise<Ctx> {
  const token = await storedToken();
  const session = await fetchSession(token);
  const accountId = session.primaryAccounts[MAIL];
  if (!accountId) throw new Error("The Fastmail token no longer grants mail access. Paste a new one in Settings.");
  return { token, session, accountId };
}

type Invocation = [string, Record<string, unknown>, string];

async function jmap(ctx: Ctx, using: string[], calls: Invocation[]): Promise<Map<string, Record<string, unknown>>> {
  const res = await fetch(ctx.session.apiUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ using, methodCalls: calls }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`Fastmail request failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { methodResponses?: unknown };
  if (!Array.isArray(body.methodResponses)) throw new Error("Fastmail returned a response Counsel could not read.");

  const out = new Map<string, Record<string, unknown>>();
  for (const entry of body.methodResponses) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const [name, args, tag] = entry as [string, Record<string, unknown>, string];
    // A method-level error arrives as a normal 200 with name "error". Treating
    // it as data is how an empty sync gets reported as a clean one.
    if (name === "error") {
      throw new Error(`Fastmail ${tag} failed: ${String(args.type ?? "unknown")}${args.description ? ` (${String(args.description)})` : ""}`);
    }
    out.set(tag, args);
  }
  return out;
}

type MailboxRow = { id: string; role: string | null };

async function mailboxIds(ctx: Ctx): Promise<Record<"inbox" | "sent" | "drafts", string | null>> {
  const res = await jmap(ctx, [CORE, MAIL], [
    ["Mailbox/get", { accountId: ctx.accountId, ids: null, properties: ["id", "role"] }, "mb"],
  ]);
  const list = res.get("mb")?.list;
  const rows: MailboxRow[] = Array.isArray(list) ? (list as MailboxRow[]) : [];
  const find = (role: string) => rows.find((r) => r.role === role)?.id ?? null;
  return { inbox: find("inbox"), sent: find("sent"), drafts: find("drafts") };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type JmapAddress = { name?: string | null; email?: string | null };
type JmapPart = { partId?: string; type?: string };
type JmapEmail = {
  id: string;
  threadId?: string;
  from?: JmapAddress[] | null;
  subject?: string | null;
  preview?: string;
  receivedAt?: string;
  textBody?: JmapPart[];
  bodyValues?: Record<string, { value?: string }>;
};

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * JMAP's `textBody` is the list of parts a plain-text reader should show. When
 * a message has no text/plain alternative it lists the HTML part instead, so
 * each part is checked and stripped rather than trusted to be plain.
 */
export function bodyOf(email: Pick<JmapEmail, "textBody" | "bodyValues">): string {
  const parts = Array.isArray(email.textBody) ? email.textBody : [];
  const values = email.bodyValues ?? {};
  return parts
    .map((p) => {
      const raw = p.partId ? values[p.partId]?.value ?? "" : "";
      return p.type === "text/html" ? stripHtml(raw) : raw;
    })
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function toFetched(email: JmapEmail, direction: "received" | "sent"): FetchedMessage {
  const from = Array.isArray(email.from) ? email.from[0] : undefined;
  const received = email.receivedAt ? new Date(email.receivedAt) : new Date();
  return {
    direction,
    gmailId: wrap(email.id),
    threadId: email.threadId ? wrap(email.threadId) : null,
    fromEmail: (from?.email ?? "").trim().toLowerCase(),
    fromName: from?.name?.trim() || null,
    subject: email.subject?.trim() || "(no subject)",
    snippet: email.preview ?? "",
    body: bodyOf(email).slice(0, 20_000),
    receivedAt: Number.isNaN(received.getTime()) ? new Date() : received,
  };
}

async function fetchFolder(
  ctx: Ctx,
  mailboxId: string,
  limit: number,
  newerThanDays: number,
  direction: "received" | "sent"
): Promise<FetchedMessage[]> {
  const after = new Date(Date.now() - newerThanDays * 24 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const res = await jmap(ctx, [CORE, MAIL], [
    [
      "Email/query",
      {
        accountId: ctx.accountId,
        filter: { inMailbox: mailboxId, after },
        sort: [{ property: "receivedAt", isAscending: false }],
        limit,
      },
      "q",
    ],
    [
      "Email/get",
      {
        accountId: ctx.accountId,
        "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
        properties: ["id", "threadId", "from", "subject", "preview", "receivedAt", "textBody", "bodyValues"],
        fetchTextBodyValues: true,
        maxBodyValueBytes: 20_000,
      },
      "g",
    ],
  ]);
  const list = res.get("g")?.list;
  if (!Array.isArray(list)) return [];
  return (list as JmapEmail[]).filter((e) => typeof e?.id === "string").map((e) => toFetched(e, direction));
}

/**
 * Same contract as the Gmail fetch: both directions, newest first, bounded by
 * age so a long gap recovers on its own. Inbox only, no folder filtering, for
 * the reason given in google-mail.ts: the classifier decides what is about a
 * job, not a mail client's sorting rules.
 */
export async function fetchRecentFastmailMessages(maxResults = 25, newerThanDays = 14): Promise<FetchedMessage[]> {
  refuseInDemo("syncing a mailbox");
  const ctx = await context();
  const boxes = await mailboxIds(ctx);
  const out: FetchedMessage[] = [];
  if (boxes.inbox) out.push(...(await fetchFolder(ctx, boxes.inbox, maxResults, newerThanDays, "received")));
  if (boxes.sent) out.push(...(await fetchFolder(ctx, boxes.sent, Math.ceil(maxResults / 2), newerThanDays, "sent")));
  return out;
}

/**
 * The RFC Message-ID of the newest message in a Fastmail thread, for
 * In-Reply-To/References. Same purpose as the Gmail version: the recipient's
 * client threads on these headers, not on anybody's internal thread id.
 */
export async function latestFastmailMessageRef(threadId: string | null | undefined): Promise<string | null> {
  if (!isFastmailId(threadId)) return null;
  try {
    const ctx = await context();
    const res = await jmap(ctx, [CORE, MAIL], [
      [
        "Email/query",
        {
          accountId: ctx.accountId,
          filter: { inThread: unwrap(threadId as string) },
          sort: [{ property: "receivedAt", isAscending: false }],
          limit: 1,
        },
        "q",
      ],
      [
        "Email/get",
        {
          accountId: ctx.accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: ["messageId"],
        },
        "g",
      ],
    ]);
    const list = res.get("g")?.list;
    const first = Array.isArray(list) ? (list[0] as { messageId?: unknown } | undefined) : undefined;
    const ids = Array.isArray(first?.messageId) ? (first.messageId as unknown[]) : [];
    const id = typeof ids[0] === "string" ? ids[0] : null;
    return id ? `<${id.replace(/^<|>$/g, "")}>` : null;
  } catch {
    // Threading headers are an improvement, not a precondition. A message that
    // goes out unthreaded beats one that does not go out.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const ADDRESS = /[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]+/g;
const addresses = (raw?: string) => (raw ?? "").match(ADDRESS)?.map((a) => a.toLowerCase()) ?? [];

/**
 * Sends through Fastmail with the same signature as the Gmail send.
 *
 * The message is assembled by the same `buildRawMessage` the Gmail path uses,
 * so formatting, attachments and header sanitising are one implementation, not
 * two that drift. It is uploaded as a blob, imported into Drafts, submitted,
 * and moved to Sent on success, so it appears in Fastmail exactly where a
 * message written there would.
 *
 * Bcc is never written into the message. The envelope carries every recipient
 * explicitly instead, which is the only way to be certain a hidden address
 * cannot surface in the stored copy or the delivered headers.
 */
export async function sendFastmail(opts: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  threadRef?: string | null;
  attachments?: MailAttachment[];
}): Promise<{ id: string; threadId: string }> {
  refuseInDemo("sending mail");
  const ctx = await context();
  if (!ctx.session.primaryAccounts[SUBMISSION]) {
    throw new Error("The Fastmail token can read mail but not send it. Create one with the Email submission scope and paste it in Settings.");
  }

  const boxes = await mailboxIds(ctx);
  if (!boxes.drafts || !boxes.sent) throw new Error("Fastmail has no Drafts or Sent folder to send through.");

  const idRes = await jmap(ctx, [CORE, SUBMISSION], [
    ["Identity/get", { accountId: ctx.session.primaryAccounts[SUBMISSION], ids: null }, "id"],
  ]);
  const identities = idRes.get("id")?.list;
  const list = Array.isArray(identities) ? (identities as { id: string; email: string; name?: string }[]) : [];
  const login = ctx.session.username.toLowerCase();
  const identity = list.find((i) => i.email?.toLowerCase() === login) ?? list[0];
  if (!identity) throw new Error("Fastmail has no sending identity for this account.");

  const from = identity.name ? `"${identity.name.replace(/"/g, "")}" <${identity.email}>` : identity.email;
  const raw = buildRawMessage({
    to: opts.to,
    cc: opts.cc,
    // Deliberately omitted: see the envelope below.
    subject: opts.subject,
    body: opts.body,
    bodyHtml: opts.bodyHtml,
    from,
    threadRef: opts.threadRef ?? undefined,
    attachments: opts.attachments,
  });
  // Gmail stamps Date and Message-ID on the way out; an imported message is
  // stored as given, so they are added here.
  const domain = identity.email.split("@")[1] ?? "fastmail.com";
  const messageId = `<${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 12)}@${domain}>`;
  const message = Buffer.concat([
    Buffer.from(`Date: ${new Date().toUTCString().replace("GMT", "+0000")}\r\nMessage-ID: ${messageId}\r\n`, "utf8"),
    Buffer.from(raw, "base64url"),
  ]);

  const uploadUrl = ctx.session.uploadUrl.replace("{accountId}", ctx.accountId);
  if (!uploadUrl) throw new Error("Fastmail did not provide an upload URL.");
  const upload = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.token}`, "Content-Type": "message/rfc822" },
    body: message,
    signal: AbortSignal.timeout(60_000),
  });
  if (!upload.ok) throw new Error(`Fastmail upload failed: ${upload.status} ${await upload.text()}`);
  const { blobId } = (await upload.json()) as { blobId?: string };
  if (!blobId) throw new Error("Fastmail upload returned no blob id.");

  const rcpt = [...new Set([...addresses(opts.to), ...addresses(opts.cc), ...addresses(opts.bcc)])];
  if (rcpt.length === 0) throw new Error("No valid recipient address. Nothing was sent.");

  const res = await jmap(ctx, [CORE, MAIL, SUBMISSION], [
    [
      "Email/import",
      {
        accountId: ctx.accountId,
        emails: { m: { blobId, mailboxIds: { [boxes.drafts]: true }, keywords: { $draft: true, $seen: true } } },
      },
      "imp",
    ],
    [
      "EmailSubmission/set",
      {
        accountId: ctx.accountId,
        create: {
          s: {
            emailId: "#m",
            identityId: identity.id,
            envelope: { mailFrom: { email: identity.email }, rcptTo: rcpt.map((email) => ({ email })) },
          },
        },
        onSuccessUpdateEmail: {
          "#s": {
            [`mailboxIds/${boxes.drafts}`]: null,
            [`mailboxIds/${boxes.sent}`]: true,
            "keywords/$draft": null,
          },
        },
      },
      "sub",
    ],
  ]);

  const imported = (res.get("imp")?.created as Record<string, { id?: string; threadId?: string }> | undefined)?.m;
  const notImported = res.get("imp")?.notCreated as Record<string, { type?: string; description?: string }> | undefined;
  if (!imported?.id) {
    const why = notImported?.m;
    throw new Error(`Fastmail would not store the message${why ? `: ${why.type ?? ""} ${why.description ?? ""}`.trimEnd() : "."} Nothing was sent.`);
  }
  const submitted = (res.get("sub")?.created as Record<string, { id?: string }> | undefined)?.s;
  if (!submitted?.id) {
    const why = (res.get("sub")?.notCreated as Record<string, { type?: string; description?: string }> | undefined)?.s;
    // The draft exists in Fastmail but was not submitted. Say so plainly: the
    // app must not report a send that did not happen.
    throw new Error(
      `Fastmail did not send it${why ? ` (${why.type ?? ""}${why.description ? `: ${why.description}` : ""})` : ""}. A copy was left in Fastmail Drafts.`
    );
  }

  return { id: wrap(imported.id), threadId: wrap(imported.threadId ?? imported.id) };
}
