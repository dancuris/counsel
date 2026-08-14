"use client";

import { useState } from "react";
import { ContactComposer, type SendAnywhere } from "@/components/ContactComposer";
import { ThreadMessage, type ThreadEntry } from "@/components/ThreadMessage";
import { plainTextToHtml } from "@/components/RichTextEditor";
import type { SignatureOptions } from "@/lib/signature-format";
import { EMPTY_BLOCK } from "@/lib/type";

/**
 * Holds the composer and the conversation together, because Reply crosses
 * between them.
 *
 * They were separate server-rendered blocks, which is why the thread was inert:
 * a draft had no way to be sent and an inbound message had no way to be
 * answered. One client boundary around both is the smallest thing that makes
 * Reply seed the editor instead of leaving Dan to retype the quote.
 */
export function ContactConversation({
  contactId,
  name,
  signature,
  thread,
  save,
  discard,
  markSentElsewhere,
  openComposer,
  initialInstruction,
  initialEdit,
  addressBook,
  ownAddresses,
  forwardTargets,
  companyNames,
  onForward,
  sendAnywhere,
}: {
  /** Contacts and his own addresses, for Cc and Bcc. */
  addressBook?: { label: string; value: string }[];
  /** His own addresses only - a test copy may go nowhere else. */
  ownAddresses?: { label: string; value: string }[];
  /** Other contacts a sent message can be forwarded to. */
  forwardTargets?: { id: string; label: string }[];
  /** Existing employers, for a new contact created while forwarding. */
  companyNames?: string[];
  onForward?: (sourceId: string, formData: FormData) => Promise<void>;
  /** Master resume and introduction letter, for a networking note. */
  sendAnywhere?: SendAnywhere[];
  contactId: string;
  name: string;
  signature: SignatureOptions | null;
  thread: ThreadEntry[];
  save: (formData: FormData) => Promise<void>;
  discard: (correspondenceId: string) => Promise<void>;
  markSentElsewhere: (correspondenceId: string) => Promise<void>;
  openComposer?: boolean;
  initialInstruction?: string;
  /** A draft to open for editing on arrival, e.g. after a forward. */
  initialEdit?: { id: string; subject: string; html: string; instructions?: string[] } | null;
}) {
  // Seeded straight from the prop rather than in an effect: arriving from a
  // forward, the composer should already hold the draft on first paint, and an
  // effect would render the empty box for a frame first.
  const [seed, setSeed] = useState<
    { subject: string; html: string; nonce: number; replace?: boolean; correspondenceId?: string; instructions?: string[] } | null
  >(
    initialEdit
      ? {
          subject: initialEdit.subject,
          html: initialEdit.html,
          nonce: 0,
          replace: true,
          correspondenceId: initialEdit.id,
          // Carried through so reopening a draft resumes the conversation with
          // Claude rather than starting it again.
          instructions: initialEdit.instructions,
        }
      : null
  );

  // Editing loads the draft back into the composer, which is where the rich
  // editor, Claude and the Drive picker already are. Saving updates that row
  // rather than leaving a second copy behind.
  function editDraft(entry: ThreadEntry) {
    setSeed({
      subject: entry.subject ?? "",
      html: entry.html ?? plainTextToHtml(entry.body),
      nonce: Date.now(),
      replace: true,
      correspondenceId: entry.key,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function replyTo(entry: ThreadEntry) {
    const quoted = entry.body
      .split("\n")
      .map((l) => `&gt; ${l}`)
      .join("<br>");
    setSeed({
      // "Re: Re: Re:" is how a thread subject rots, so it is only added once.
      subject: entry.subject ? (/^re:/i.test(entry.subject) ? entry.subject : `Re: ${entry.subject}`) : "",
      html: `<div><br></div><div><br></div><div style="color:#888">On ${entry.at}, ${entry.who} wrote:</div><div style="color:#888">${quoted}</div>`,
      // Replying to the same message twice in a row has to re-seed, and
      // identical state would not trigger the effect.
      nonce: Date.now(),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      <ContactComposer
        addressBook={addressBook}
        sendAnywhere={sendAnywhere}
        contactId={contactId}
        name={name}
        action={save}
        signature={signature}
        seed={seed}
        openInitially={openComposer}
        initialInstruction={initialInstruction}
      />

      <section className="panel mt-4 overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h2 className="text-[13px] font-semibold">
            Conversation <span className="font-normal text-[var(--tx-3)]">{thread.length}</span>
          </h2>
        </div>
        {thread.length === 0 ? (
          <p className={EMPTY_BLOCK}>Nothing yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {thread.map((m) => (
              <ThreadMessage
                addressBook={addressBook}
                ownAddresses={ownAddresses}
                forwardTargets={forwardTargets}
                companyNames={companyNames}
                onForward={onForward}
                key={m.key}
                entry={m}
                contactId={contactId}
                onReply={replyTo}
                onEdit={editDraft}
                discard={discard}
                markSentElsewhere={markSentElsewhere}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
