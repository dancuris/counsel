import { prisma } from "@/lib/prisma";
import { DRIVE_SCOPE } from "@/lib/drive-links";
import { connectionIdFor, connectionLabel, type ConnectionTarget } from "@/lib/google-connections";
import { refuseInDemo } from "@/lib/demo";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// gmail.send is deliberately paired with a hard product rule: Counsel drafts,
// the user sends. Nothing is ever dispatched without an explicit press, because
// a mis-worded note to a retained recruiter is not a bug you can roll back.
// Notably absent: gmail.modify and gmail.compose, which would let this app
// alter or delete mail it has no reason to touch.
//
// Drive is the exception to that pattern, and it is a deliberate one. The
// narrow scope, drive.file, grants per-file access to files the app created
// and nothing else - which means it cannot *search*, so it could never find
// the existing Jobs/<Company> folders and would fork the structure by creating
// a second folder beside each one. Filing into a job-search tree that already
// exists needs full read/write, so that is what is asked for. Everything in
// this app writes under one root folder that the profile names; the scope is
// wide, the behaviour is not.
export const MAILBOX_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
].join(" ");

// The Drive account is a different Google account and asks for nothing else.
// It cannot read a message; the mailbox token cannot touch a file.
export const DRIVE_SCOPES = ["openid", "email", DRIVE_SCOPE].join(" ");

export function scopesFor(target: ConnectionTarget): string {
  return target === "drive" ? DRIVE_SCOPES : MAILBOX_SCOPES;
}

/**
 * OAuth client for a connection target, which is not always the same client.
 *
 * Google will not let an External app save a restricted scope without going
 * through verification, and full Drive is restricted. An **Internal** app in a
 * Workspace org has no such requirement, so Drive gets its own project inside
 * ecuris.com while mail stays on the original external client - which already
 * holds its restricted Gmail scopes and works.
 *
 * Falls back to the main client when the Drive-specific pair is unset, so a
 * single-project setup still works and nothing breaks before the second
 * project exists.
 */
function credentials(target: ConnectionTarget = "mailbox") {
  if (target === "drive" && process.env.GOOGLE_DRIVE_CLIENT_ID) {
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    if (!clientSecret) throw new Error("GOOGLE_DRIVE_CLIENT_ID is set but GOOGLE_DRIVE_CLIENT_SECRET is not.");
    return { clientId, clientSecret };
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set.");
  return { clientId, clientSecret };
}

/** The OAuth client id serving a target, for verifying that client's id_token. */
export function clientIdFor(target: ConnectionTarget): string {
  return credentials(target).clientId;
}

export function getMailboxAuthorizeUrl(
  redirectUri: string,
  state: string,
  target: ConnectionTarget = "mailbox"
): string {
  const { clientId } = credentials(target);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopesFor(target),
    state,
    // Both are required to be issued a refresh token: without offline access
    // there is no refresh token at all, and without consent Google will not
    // re-issue one on a repeat authorisation.
    access_type: "offline",
    prompt: "consent",
    // Deliberately not include_granted_scopes. These are two separate
    // accounts, and carrying one's grants into the other's consent screen is
    // how the Drive account would end up holding Gmail access it never needed.
    ...(target === "drive" ? {} : { include_granted_scopes: "true" }),
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  id_token?: string;
};

export async function exchangeMailboxCode(
  code: string,
  redirectUri: string,
  target: ConnectionTarget = "mailbox"
): Promise<TokenResponse> {
  const { clientId, clientSecret } = credentials(target);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

// Returns a valid access token, refreshing it first if it is close to expiry.
// Google only issues a refresh token on the initial consent, so the stored one
// is kept when a refresh response omits it.
export async function getAccessToken(
  target: ConnectionTarget = "mailbox"
): Promise<{ token: string; email: string }> {
  const label = connectionLabel(target);
  const conn = await prisma.googleConnection.findUnique({ where: { id: connectionIdFor(target) } });
  if (!conn) throw new Error(`No ${label} connected. Connect one from the Profile page.`);

  const stillValid = conn.expiresAt.getTime() - Date.now() > 60_000;
  if (stillValid) return { token: conn.accessToken, email: conn.email };

  const { clientId, clientSecret } = credentials(target);
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: conn.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    // In Google's "Testing" publishing status refresh tokens expire after 7
    // days, which surfaces here as invalid_grant. Say so plainly rather than
    // leaving a generic OAuth error.
    if (detail.includes("invalid_grant")) {
      throw new Error(`Authorisation for the ${label} expired. Reconnect it from the Profile page.`);
    }
    throw new Error(`Token refresh failed: ${res.status} ${detail}`);
  }

  const body = (await res.json()) as TokenResponse;
  const updated = await prisma.googleConnection.update({
    where: { id: connectionIdFor(target) },
    data: {
      accessToken: body.access_token,
      expiresAt: new Date(Date.now() + body.expires_in * 1000),
      ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
    },
  });
  return { token: updated.accessToken, email: updated.email };
}

export type MailAttachment = { filename: string; mimeType: string; data: Buffer };

// RFC 2822 message, base64url encoded, which is what Gmail's send endpoint
// takes. Headers are sanitised because a newline smuggled into a subject or
// recipient would let arbitrary headers (Bcc, Reply-To) be injected.
// Exported so the multipart assembly can be checked against a MIME parser
// without sending anything.
export function buildRawMessage(opts: {
  to: string;
  /** Comma-separated. Visible to everyone on the message. */
  cc?: string;
  /**
   * Comma-separated, hidden from the other recipients.
   *
   * Gmail's send endpoint honours a Bcc header in the raw message and strips
   * it before delivery, which is the only way to bcc through this API. Getting
   * this wrong exposes an address that was meant to be hidden, so it is
   * covered by a test on the assembled message rather than trusted.
   */
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  from: string;
  threadRef?: string;
  attachments?: MailAttachment[];
}): string {
  const clean = (v: string) => v.replace(/[\r\n]+/g, " ").trim();
  const headers = [
    `From: ${clean(opts.from)}`,
    `To: ${clean(opts.to)}`,
    ...(opts.cc?.trim() ? [`Cc: ${clean(opts.cc)}`] : []),
    ...(opts.bcc?.trim() ? [`Bcc: ${clean(opts.bcc)}`] : []),
    `Subject: ${clean(opts.subject)}`,
    ...(opts.threadRef ? [`In-Reply-To: ${clean(opts.threadRef)}`, `References: ${clean(opts.threadRef)}`] : []),
    "MIME-Version: 1.0",
  ];

  const attachments = opts.attachments ?? [];
  const newBoundary = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

  // A formatted message goes out as multipart/alternative: the plain text
  // first, the HTML second, and the client picks. Plain text is not a fallback
  // nobody sees - it is what a recruiter's phone or an ATS parser may well use,
  // which is why `content` stays the record and this is the alternative to it.
  const bodyParts = (boundary: string): string[] => {
    if (!opts.bodyHtml) {
      return [`--${boundary}`, 'Content-Type: text/plain; charset="UTF-8"', "", opts.body];
    }
    const alt = newBoundary();
    return [
      `--${boundary}`,
      `Content-Type: multipart/alternative; boundary="${alt}"`,
      "",
      `--${alt}`,
      'Content-Type: text/plain; charset="UTF-8"',
      "",
      opts.body,
      `--${alt}`,
      'Content-Type: text/html; charset="UTF-8"',
      "",
      opts.bodyHtml,
      `--${alt}--`,
    ];
  };

  if (attachments.length === 0 && !opts.bodyHtml) {
    const lines = [...headers, 'Content-Type: text/plain; charset="UTF-8"', "", opts.body];
    return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
  }

  // multipart/mixed: the body as the first part, each file after it.
  // The boundary is random so it cannot collide with anything in the body.
  const boundary = newBoundary();
  const parts = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...bodyParts(boundary),
  ];
  for (const file of attachments) {
    parts.push(
      `--${boundary}`,
      `Content-Type: ${clean(file.mimeType)}; name="${clean(file.filename)}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${clean(file.filename)}"`,
      "",
      // Base64 bodies must be wrapped; some servers reject very long lines.
      file.data.toString("base64").replace(/(.{76})/g, "$1\r\n")
    );
  }
  parts.push(`--${boundary}--`, "");
  return Buffer.from(parts.join("\r\n"), "utf8").toString("base64url");
}

export async function sendMail(opts: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  bodyHtml?: string;
  threadId?: string | null;
  threadRef?: string | null;
  attachments?: MailAttachment[];
}): Promise<{ id: string; threadId: string }> {
  // Guarded here rather than in the send route so any future caller inherits
  // it. A demo that can email a stranger from Dan's Gmail is the failure this
  // whole mode exists to prevent.
  refuseInDemo("sending mail");
  const { token, email } = await getAccessToken();
  const raw = buildRawMessage({
    to: opts.to,
    cc: opts.cc,
    bcc: opts.bcc,
    subject: opts.subject,
    body: opts.body,
    bodyHtml: opts.bodyHtml,
    from: email,
    threadRef: opts.threadRef ?? undefined,
    attachments: opts.attachments,
  });

  const res = await fetch(`${GMAIL_API}/messages/send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw, ...(opts.threadId ? { threadId: opts.threadId } : {}) }),
  });
  if (!res.ok) {
    const detail = await res.text();
    if (detail.includes("insufficient") || res.status === 403) {
      throw new Error("The mailbox is connected without send permission. Reconnect it from the Profile page.");
    }
    throw new Error(`Gmail send failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as { id: string; threadId: string };
}

export type GmailHeader = { name: string; value: string };

type GmailPart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
};

// Gmail returns the body as base64url, nested in a part tree whose shape
// depends on whether the message is plain, HTML, or has attachments. Prefer
// text/plain and fall back to stripped HTML.
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) return "";
  const decode = (d?: string) => (d ? Buffer.from(d, "base64url").toString("utf8") : "");

  const walk = (part: GmailPart, wanted: string): string => {
    if (part.mimeType === wanted && part.body?.data) return decode(part.body.data);
    for (const child of part.parts ?? []) {
      const found = walk(child, wanted);
      if (found) return found;
    }
    return "";
  };

  const plain = walk(payload, "text/plain");
  if (plain) return plain;

  const html = walk(payload, "text/html");
  if (html) {
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
  }
  return decode(payload.body?.data);
}

export type FetchedMessage = {
  direction: "received" | "sent";
  gmailId: string;
  threadId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: Date;
};

async function gmail<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GMAIL_API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Gmail ${path} failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

function parseFrom(raw: string): { email: string; name: string | null } {
  const match = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1].replace(/^"|"$/g, "") || null, email: match[2].toLowerCase() };
  return { name: null, email: raw.trim().toLowerCase() };
}

// Pulls recent messages from the primary inbox. Deliberately query-based rather
// than history-based for the first pass: history ids expire, and a date-bounded
// query is simpler to reason about and recovers on its own after a long gap.
/**
 * Pulls both directions. The inbox alone left a hole: a thank-you note written
 * by hand in Gmail never reached Counsel, so the record of a conversation had
 * one side of it missing.
 */
export async function fetchRecentMessages(maxResults = 25, newerThanDays = 14): Promise<FetchedMessage[]> {
  // Reading is not destructive, but it is Dan's actual mail, and a demo that
  // pulls it in would put real recruiter names on a screen he is showing to
  // other people.
  refuseInDemo("syncing a mailbox");
  // No category exclusions.
  //
  // This used to exclude promotions and social to cut noise, which handed
  // Gmail's tab heuristic the decision "is this about a job" - and Gmail is
  // bad at it for exactly the mail that matters. An AT&T interview invitation
  // from the recruiter, inviting Dan to a one-hour conversation, landed in
  // Promotions and the sync never saw it. He found it by opening Gmail; the
  // app reported "nothing found" twice.
  //
  // Anything sent through an ATS carries tracking and marketing headers, which
  // is precisely what Gmail sorts on, so the misfiling is systematic rather
  // than bad luck. Meanwhile this app already has a classifier whose whole job
  // is that decision, and the Inbox already hides whatever it marks
  // not_job_related. Filtering first was doing the same work twice, worse, and
  // silently.
  const received = await fetchByQuery(
    `in:inbox newer_than:${newerThanDays}d`,
    maxResults,
    "received"
  );
  // Fewer, because sent mail is lower volume and mostly already known: the
  // point is catching what was written outside the app.
  const sent = await fetchByQuery(`in:sent newer_than:${newerThanDays}d`, Math.ceil(maxResults / 2), "sent");
  return [...received, ...sent];
}

async function fetchByQuery(q: string, maxResults: number, direction: "received" | "sent"): Promise<FetchedMessage[]> {
  const { token } = await getAccessToken();
  const query = encodeURIComponent(q);
  const list = await gmail<{ messages?: { id: string }[] }>(
    `/messages?maxResults=${maxResults}&q=${query}`,
    token
  );

  const out: FetchedMessage[] = [];
  for (const { id } of list.messages ?? []) {
    const msg = await gmail<{
      id: string;
      threadId?: string;
      snippet?: string;
      internalDate?: string;
      payload?: GmailPart & { headers?: GmailHeader[] };
    }>(`/messages/${id}?format=full`, token);

    const headers = msg.payload?.headers ?? [];
    const header = (n: string) => headers.find((h) => h.name.toLowerCase() === n)?.value ?? "";
    const { email, name } = parseFrom(header("from"));

    out.push({
      gmailId: msg.id,
      threadId: msg.threadId ?? null,
      fromEmail: email,
      fromName: name,
      subject: header("subject") || "(no subject)",
      snippet: msg.snippet ?? "",
      body: extractBody(msg.payload).slice(0, 20_000),
      receivedAt: msg.internalDate ? new Date(Number(msg.internalDate)) : new Date(),
      direction,
    });
  }
  return out;
}

const CALENDAR_API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

// Writing to the user's own calendar is low-stakes compared with sending mail,
// so this happens directly rather than behind an approval step.
export async function createCalendarEvent(opts: {
  summary: string;
  description?: string;
  start: Date;
  durationMinutes?: number;
  location?: string;
}): Promise<{ id: string; htmlLink: string }> {
  const { token } = await getAccessToken();
  const end = new Date(opts.start.getTime() + (opts.durationMinutes ?? 60) * 60_000);

  const res = await fetch(CALENDAR_API, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: opts.summary,
      description: opts.description,
      location: opts.location,
      start: { dateTime: opts.start.toISOString() },
      end: { dateTime: end.toISOString() },
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 403) {
      throw new Error("The mailbox is connected without calendar write permission. Reconnect it from the Profile page.");
    }
    throw new Error(`Calendar insert failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as { id: string; htmlLink: string };
}

/**
 * The RFC `Message-ID` of the newest message in a Gmail thread.
 *
 * Gmail's own `threadId` keeps a reply in the right conversation **in Dan's
 * mailbox** and does nothing for the recipient's. Every other mail client, and
 * every ATS, threads on `In-Reply-To` and `References`, which carry this
 * header. Without it a reply to a recruiter arrives as a brand new message: no
 * quoted history, no association with the requisition it answers.
 *
 * Read at send time rather than stored, so it is always the newest message in
 * the thread even when several arrived after the draft was written. That also
 * avoids a migration for a value Gmail already holds.
 *
 * Never throws. Threading is a nicety and sending is not, so a failure here
 * must not stop the mail going out.
 */
export async function latestMessageRef(threadId: string | null | undefined): Promise<string | null> {
  if (!threadId) return null;
  try {
    const { token } = await getAccessToken();
    const thread = await gmail<{ messages?: { payload?: { headers?: GmailHeader[] } }[] }>(
      `/threads/${threadId}?format=metadata&metadataHeaders=Message-ID`,
      token
    );
    const messages = thread.messages ?? [];
    const newest = messages[messages.length - 1];
    const header = newest?.payload?.headers?.find((h) => h.name.toLowerCase() === "message-id");
    return header?.value ?? null;
  } catch {
    return null;
  }
}
