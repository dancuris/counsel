"use client";

import { SubmitButton } from "@/components/SubmitButton";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass } from "@/lib/button";
import { ERROR_BLOCK } from "@/lib/type";

export type ThreadEntry = {
  key: string;
  from: "you" | "them";
  who: string;
  at: string;
  subject: string | null;
  body: string;
  html: string | null;
  status: string;
  attachments: { label: string; id: string }[];
  recipientEmail: string | null;
  /** Extra recipients saved on the draft, comma separated. */
  cc?: string | null;
  bcc?: string | null;
  gmailId: string | null;
};

/**
 * One message in the conversation, and the things you can do to it.
 *
 * The list used to be inert. A draft written in the composer could not be sent
 * from anywhere, even though the composer said "send it from the conversation
 * below" - so saving a draft was a dead end. Inbound mail showed only the
 * Gmail snippet, truncated mid-sentence with no way to read the rest.
 *
 * Sending goes through `POST /api/correspondence/send` rather than a server
 * action, because that route is the only thing in the app permitted to mark
 * anything sent, and only after Gmail returns an id.
 */
const COLLAPSE_AT = 420;

export function ThreadMessage({
  entry,
  // Kept on the props so callers do not have to change when this needs it
  // again; prefixed so the linter knows it is deliberate.
  contactId: _contactId,
  onReply,
  onEdit,
  discard,
  markSentElsewhere,
  addressBook = [],
  forwardTargets = [],
  companyNames = [],
  onForward,
  ownAddresses = [],
}: {
  /** Contacts and his own addresses, for the Cc and Bcc pickers. */
  addressBook?: { label: string; value: string }[];
  /** Other contacts this can be forwarded to. */
  forwardTargets?: { id: string; label: string }[];
  /** Existing employers, so a new contact joins one that exists. */
  companyNames?: string[];
  onForward?: (sourceId: string, formData: FormData) => Promise<void>;
  /** His own addresses only - a test may go nowhere else. */
  ownAddresses?: { label: string; value: string }[];
  entry: ThreadEntry;
  contactId: string;
  onReply: (entry: ThreadEntry) => void;
  onEdit: (entry: ThreadEntry) => void;
  discard: (correspondenceId: string) => Promise<void>;
  markSentElsewhere: (correspondenceId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  // A native window.confirm is the most dated thing an interface can do, and it
  // is worst here: it renders outside the page, cannot show the address it is
  // asking about in context, and on iOS it steals the whole screen. These are
  // the two paths that send real mail and delete real drafts, so the
  // confirmation stays - it just happens in place.
  const [confirming, setConfirming] = useState<null | "send" | "discard">(null);
  const [copied, setCopied] = useState(false);
  const [marking, startMark] = useTransition();
  const [sending, setSending] = useState(false);
  const [cc, setCc] = useState(entry.cc ?? "");
  const [bcc, setBcc] = useState(entry.bcc ?? "");
  const [showCopies, setShowCopies] = useState(Boolean(entry.cc || entry.bcc));
  const [tested, setTested] = useState<string | null>(null);
  const [forwarding, setForwarding] = useState(false);
  const [forwardTo, setForwardTo] = useState("");
  const testTo = ownAddresses[0]?.value ?? "";
  const [error, setError] = useState<string | null>(null);
  const [discarding, startDiscard] = useTransition();

  const isDraft = entry.status === "draft";
  // Dan's own claim that he sent it from another client, kept distinct from
  // "sent", which means Gmail returned an id.
  const sentElsewhere = entry.status === "sent_externally";
  const long = entry.body.length > COLLAPSE_AT;
  const shown = !long || expanded ? entry.body : `${entry.body.slice(0, COLLAPSE_AT).trimEnd()}...`;

  /**
   * `test` sends the assembled message to Dan instead of the recipient.
   *
   * The confirm step exists so the address is visible while he decides; this
   * is the same idea one step earlier - see the actual message, with its
   * formatting and attachments, before a stranger does. The route enforces
   * that a test can only reach one of his own addresses, so this cannot
   * misfire into the real recipient.
   */
  async function send(opts: { test?: boolean } = {}) {
    if (!entry.recipientEmail) {
      setError("No email address for this contact. Add one under Edit details.");
      return;
    }
    if (opts.test && !testTo) {
      setError("No address of your own on file. Add one on Profile under contact emails.");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/correspondence/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: entry.key,
          cc,
          bcc,
          ...(opts.test ? { test: true, testTo } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Send failed with ${res.status}.`);
      if (opts.test) {
        // Deliberately not a refresh: the draft has not changed, and clearing
        // the row would look like it had been sent.
        setTested(`Copy sent to ${testTo}. The draft is untouched.`);
        return;
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[12.5px] font-medium text-[var(--tx)]">
          {entry.who}
          {entry.subject ? <span className="font-normal text-[var(--tx-2)]"> · {entry.subject}</span> : null}
        </span>
        <span className="shrink-0 text-[11px] text-[var(--tx-3)]">
          {isDraft && <span className="mr-2 text-[var(--amber)]">draft</span>}
          {sentElsewhere && <span className="mr-2 text-[var(--tx-3)]">sent from another client</span>}
          {entry.at}
        </span>
      </div>

      {entry.html ? (
        // Written in this app's own composer, so it renders as it was written.
        // Synced mail never carries HTML here.
        <div
          className="mt-1 max-h-96 overflow-y-auto text-[12.5px] leading-relaxed text-[var(--tx-2)] [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc"
          dangerouslySetInnerHTML={{ __html: entry.html }}
        />
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--tx-2)]">{shown}</p>
      )}

      {long && !entry.html && (
        <button
          type="button"
          onClick={() => setExpanded((x) => !x)}
          className="mt-1 text-[11.5px] text-[var(--tx-3)] underline hover:text-[var(--tx)]"
        >
          {expanded ? "Show less" : "Read the whole message"}
        </button>
      )}

      {entry.attachments.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {entry.attachments.map((a) => (
            <li key={a.id} className="max-w-64 truncate rounded-md border border-line px-1.5 py-0.5 text-[11px] text-[var(--tx-3)]">
              {a.label}
            </li>
          ))}
        </ul>
      )}

      {tested && <p className="mt-2 text-[11.5px] text-[var(--mint)]">{tested}</p>}
      {error && <p className={ERROR_BLOCK}>{error}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {/* Forward, on a message that actually went out. Opens as a draft on
            the other person so the note on top can be written - the note is
            the point, and it is the only part addressed to them. */}
        {!isDraft && entry.from === "you" && forwardTargets.length > 0 && (
          forwarding ? (
            <form
              action={async (fd) => {
                await onForward?.(entry.key, fd);
                setForwarding(false);
                setForwardTo("");
              }}
              className="flex flex-wrap items-center gap-2 text-[12px]"
            >
              <span className="text-[var(--tx-2)]">Forward to</span>
              <select
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
                className="rounded border border-line-2 bg-[var(--surface-2)] px-2 py-1 text-[12px]"
              >
                <option value="" disabled>
                  Choose someone
                </option>
                {forwardTargets.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
                {/* With an introduction this is the normal case: the person
                    being thanked is often newer than the person written to. */}
                <option value="__new">Someone new...</option>
              </select>
              <input type="hidden" name="toContactId" value={forwardTo === "__new" ? "" : forwardTo} />
              {forwardTo === "__new" && (
                <span className="flex w-full flex-wrap items-center gap-1.5">
                  <input
                    name="newContactName"
                    required
                    autoFocus
                    placeholder="Name"
                    className={`w-36 ${inputClass("sm")}`}
                  />
                  <input
                    name="newContactEmail"
                    type="email"
                    required
                    placeholder="Email"
                    className={`w-52 ${inputClass("sm")}`}
                  />
                  <input
                    name="newContactCompany"
                    list={`forward-companies-${entry.key}`}
                    placeholder="Company"
                    className={`w-40 ${inputClass("sm")}`}
                  />
                  <datalist id={`forward-companies-${entry.key}`}>
                    {companyNames.map((n) => (
                      <option key={n} value={n} />
                    ))}
                  </datalist>
                </span>
              )}
              <SubmitButton
                className={buttonClass("primary", "sm")}
                pendingLabel="Drafting..."
              >
                Draft it
              </SubmitButton>
              <button
                type="button"
                onClick={() => setForwarding(false)}
                className="text-[var(--tx-3)] hover:text-[var(--tx)]"
              >
                Cancel
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setForwarding(true)}
              className="text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
            >
              Forward
            </button>
          )
        )}

        {isDraft && (
          <>
            {showCopies && (
              <span className="mb-1 flex w-full flex-col gap-1">
                {([["Cc", cc, setCc], ["Bcc", bcc, setBcc]] as const).map(([label, value, set]) => (
                  <label key={label} className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-[11px] text-[var(--tx-3)]">{label}</span>
                    <input
                      list={`thread-addresses-${entry.key}`}
                      value={value}
                      onChange={(e) => set(e.target.value)}
                      placeholder={label === "Bcc" ? "hidden from the others" : "comma separated"}
                      className="flex-1 rounded border border-line-2 bg-[var(--surface-2)] px-2 py-1 text-[12px]"
                    />
                  </label>
                ))}
                <datalist id={`thread-addresses-${entry.key}`}>
                  {addressBook.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </datalist>
              </span>
            )}

            {confirming === "send" ? (
              <span className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-[var(--tx-2)]">
                  Send to {entry.recipientEmail}
                  {cc.trim() ? `, cc ${cc.trim()}` : ""}
                  {bcc.trim() ? `, bcc ${bcc.trim()}` : ""}?
                </span>
                <button
                  type="button"
                  disabled={sending}
                  onClick={() => void send()}
                  className={buttonClass("primary", "sm")}
                >
                  {sending ? "Sending..." : "Yes, send"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="text-[11.5px] text-[var(--tx-3)] transition hover:text-[var(--tx)]"
                >
                  Cancel
                </button>
              </span>
            ) : confirming === "discard" ? (
              <span className="flex flex-wrap items-center gap-2 text-[12px]">
                <span className="text-[var(--tx-2)]">Discard this draft? It has not been sent.</span>
                <button
                  type="button"
                  disabled={discarding}
                  onClick={() =>
                    startDiscard(async () => {
                      await discard(entry.key);
                      router.refresh();
                    })
                  }
                  className={buttonClass("danger", "sm")}
                >
                  {discarding ? "Discarding..." : "Yes, discard"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(null)}
                  className="text-[11.5px] text-[var(--tx-3)] transition hover:text-[var(--tx)]"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => onEdit(entry)}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-[var(--tx-2)] transition hover:text-[var(--tx)]"
                >
                  Edit
                </button>
                {!showCopies && (
                  <button
                    type="button"
                    onClick={() => setShowCopies(true)}
                    className="text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
                  >
                    Cc / Bcc
                  </button>
                )}
                {testTo && (
                  <button
                    type="button"
                    disabled={sending}
                    onClick={() => void send({ test: true })}
                    title={`Send this exact message to ${testTo} and leave the draft alone`}
                    className="text-[var(--tx-3)] transition-colors hover:text-[var(--tx)] disabled:opacity-40"
                  >
                    {sending ? "Sending..." : "Send me a copy"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setConfirming("send")}
                  className={buttonClass("primary", "sm")}
                >
                  {entry.recipientEmail ? `Send to ${entry.recipientEmail}` : "Send"}
                </button>
                {/* For threads that live in another mailbox: take the text
                    out, answer there, then say so here. Subject included,
                    because the subject is half of what gets pasted. */}
                <button
                  type="button"
                  onClick={async () => {
                    const text = entry.subject ? `Subject: ${entry.subject}\n\n${entry.body}` : entry.body;
                    try {
                      await navigator.clipboard.writeText(text);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      setError("Could not reach the clipboard. Select the text above and copy it.");
                    }
                  }}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] text-[var(--tx-2)] transition hover:text-[var(--tx)]"
                >
                  {copied ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  disabled={marking}
                  onClick={() =>
                    startMark(async () => {
                      await markSentElsewhere(entry.key);
                      router.refresh();
                    })
                  }
                  title="Record that you sent this from another mail client"
                  className="text-[11.5px] text-[var(--tx-3)] transition hover:text-[var(--tx)]"
                >
                  {marking ? "Recording..." : "I sent this myself"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming("discard")}
                  className="text-[11.5px] text-[var(--tx-3)] transition hover:text-red-600"
                >
                  Discard
                </button>
              </>
            )}
          </>
        )}

        {!isDraft && (
          <button
            type="button"
            onClick={() => onReply(entry)}
            className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-[var(--tx-2)] transition hover:text-[var(--tx)]"
          >
            Reply
          </button>
        )}

        {/* Gmail ids only. A Fastmail message is stored as "fastmail:<id>", and
            pointing that at Gmail would open a search that finds nothing. */}
        {entry.gmailId && !entry.gmailId.startsWith("fastmail:") && (
          <a
            href={`https://mail.google.com/mail/u/0/#all/${entry.gmailId}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11.5px] text-[var(--tx-3)] underline transition hover:text-[var(--tx)]"
          >
            Open in Gmail
          </a>
        )}
      </div>
    </li>
  );
}
