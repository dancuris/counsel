import { prisma } from "@/lib/prisma";
import { TENANT_ID } from "@/lib/tenant";
import { ownerEmail } from "@/lib/owner";
import { sendMail } from "@/lib/google-mail";
import { recordFailure } from "@/lib/failures";
import { parseLabelled } from "@/lib/contact-block";

/**
 * Feature requests, travelling from somebody else's instance to the operator's.
 *
 * ## The one thing that crosses between instances
 *
 * Every other part of this app is built so that one person's job search cannot
 * reach another's. This deliberately punches one narrow hole in that, and the
 * shape of the hole is the whole design: **only the words somebody typed into a
 * form, plus the name of the instance they typed them on.** No pipeline, no
 * profile, no contacts, nothing derived. The page they send from says that in
 * plain language before they press anything, because a privacy promise that is
 * true in the code and unstated in the interface is not one somebody can rely on.
 *
 * The receiving end treats every field as untrusted text from the open web. The
 * endpoint is public by necessity - other instances have no credentials here -
 * so the instance name is a label, never an authorization, and nothing is acted
 * on automatically. The operator reads it and decides.
 */

export type RequestStatus = "new" | "queued" | "approved" | "declined" | "done";

export const REQUEST_STATUSES: RequestStatus[] = ["new", "queued", "approved", "declined", "done"];

/** What the backlog is: things said yes to, in the order they were asked. */
export const ACTIVE_STATUSES: RequestStatus[] = ["approved", "queued"];

export function isRequestStatus(value: string): value is RequestStatus {
  return (REQUEST_STATUSES as string[]).includes(value);
}

/** Longest a field may be. Generous for a person, mean for anybody abusing it. */
const LIMITS = { title: 200, body: 4000, requester: 200, instance: 100 };

export type IncomingRequest = { instance: string; requester: string | null; title: string; body: string };

/**
 * Reads a posted request, or says why it is not one.
 *
 * Validation lives here rather than in the route because this is the trust
 * boundary: everything past this point is treated as text somebody typed, and
 * the only place that can be true is where the parsing happens.
 */
export function readRequest(payload: unknown): { ok: true; value: IncomingRequest } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object") return { ok: false, error: "Expected an object." };
  const body = payload as Record<string, unknown>;

  const text = (key: keyof typeof LIMITS): string =>
    typeof body[key] === "string" ? (body[key] as string).trim().slice(0, LIMITS[key]) : "";

  const title = text("title");
  const detail = text("body");
  if (!title) return { ok: false, error: "A request needs a title." };
  if (!detail) return { ok: false, error: "A request needs some detail." };

  return {
    ok: true,
    value: {
      instance: text("instance") || "an unnamed instance",
      requester: text("requester") || null,
      title,
      body: detail,
    },
  };
}

/**
 * Where to tell the operator a request arrived.
 *
 * Derived, never hardcoded. Writing one person's address into this file would be
 * the same fault as the employer list that was a constant in the source: it
 * reads as correct forever on one deployment and is wrong on every other. The
 * order is explicit override, then whoever claimed the instance, then the
 * profile's own default address.
 */
export async function notifyAddress(): Promise<string | null> {
  const override = process.env.REQUEST_NOTIFY_EMAIL?.trim();
  if (override) return override;

  const claimed = await ownerEmail();
  if (claimed) return claimed;

  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: { contactEmails: true, defaultEmailLabel: true },
  });
  const emails = parseLabelled(profile?.contactEmails);
  if (emails.length === 0) return null;
  const preferred = emails.find((e) => e.label === profile?.defaultEmailLabel);
  return (preferred ?? emails[0]).value || null;
}

/**
 * Emails the operator that something came in.
 *
 * Never throws and never blocks the reply, for the same reason the Drive sync
 * and the activity log do not: a request that was stored successfully must not
 * report as failed because a mailbox was not connected. An instance with no
 * mail set up simply does not get told, which is a fair outcome for an optional
 * integration.
 */
export async function notifyOfRequest(request: { instance: string; requester: string | null; title: string; body: string }) {
  try {
    const to = await notifyAddress();
    if (!to) return;

    await sendMail({
      to,
      subject: `Feature request: ${request.title}`,
      body: [
        `${request.requester ?? "Somebody"} on ${request.instance} asked for this:`,
        "",
        request.title,
        "",
        request.body,
        "",
        "Approve, queue or decline it on your Requests page.",
      ].join("\n"),
    });
  } catch (error) {
    // Includes the demo-mode refusal, which is correct behavior rather than a
    // fault: a demo must not send mail from a real mailbox.
    await recordFailure("requests.notify", error, { instance: request.instance });
  }
}

/**
 * Sends a request upstream, from an instance that has somewhere to send it.
 *
 * `UPSTREAM_URL` is set automatically when an instance is provisioned, so
 * nobody configures this by hand. Unset means this instance answers to nobody,
 * which is the right default for one somebody deployed themselves: the page
 * does not appear at all rather than offering to send into a void.
 */
/**
 * Where this distribution reports to when nothing says otherwise.
 *
 * A fact about the project rather than about a person, which is why it is
 * allowed to be a constant: it is the address of the instance that publishes
 * the code. Without it, an instance somebody deploys from the public repository
 * has nowhere to send a request and simply hides the page, which means the only
 * feedback channel from the people most likely to hit a bug is closed.
 *
 * `UPSTREAM_URL=none` switches it off for anybody who would rather report
 * nowhere.
 */
const DEFAULT_UPSTREAM = "https://tracker.ecuris.com";

export function upstreamUrl(): string | null {
  const configured = process.env.UPSTREAM_URL?.trim();
  if (configured === "none") return null;
  const url = configured || DEFAULT_UPSTREAM;
  return url.replace(/\/+$/, "");
}

/** This instance's own name, for labeling what it sends. */
export function instanceName(): string {
  return (
    process.env.COUNSEL_INSTANCE_NAME?.trim() ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "an unnamed instance"
  );
}

export async function sendUpstream(title: string, body: string, requester: string | null): Promise<{ ok: boolean; error?: string }> {
  const upstream = upstreamUrl();
  if (!upstream) return { ok: false, error: "This instance has nowhere to send requests." };

  try {
    const res = await fetch(`${upstream}/api/requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ instance: instanceName(), requester, title, body }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, error: detail.slice(0, 200) || `The other end returned ${res.status}.` };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "Could not reach the instance this one reports to. Nothing was sent." };
  }
}
