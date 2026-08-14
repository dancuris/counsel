"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RichTextEditor, htmlToPlainText, plainTextToHtml } from "@/components/RichTextEditor";
import { buildSignatureLines, type SignatureOptions } from "@/lib/signature-format";
import { buttonClass } from "@/lib/button";
import { CORRESPONDENCE_TYPES, CORRESPONDENCE_TYPE_LABELS, type CorrespondenceType } from "@/lib/constants";
import { ERROR_BLOCK } from "@/lib/type";

type Entry = { id: string; name: string; mimeType: string; isFolder: boolean };
type Picked = { driveFileId: string; name: string };
/** The master resume and introduction letter, offered as one click. */
export type SendAnywhere = { id: string; label: string; docx: string | null; pdf: string | null };

/**
 * A proper writing surface, not a box in a sidebar.
 *
 * Three things live here that used not to. Claude drafts into the editor
 * rather than into a separate panel, so a draft is something to edit rather
 * than something to copy. Files from Drive attach by reference, resolved to
 * bytes only at send time. And the textarea grows with the message, because a
 * note you cannot see all of is a note you cannot judge.
 *
 * Save and send stay separate, as everywhere else here: saving writes a draft,
 * and only `POST /api/correspondence/send` may mark anything sent, after Gmail
 * returns an id.
 */

/**
 * The signature as a marked block, always last in the message.
 *
 * It used to be appended at save and never shown, which made the checkbox a
 * promise rather than a fact - and the promise was broken: a forwarded draft
 * turned the signature off, on the reasoning that a draft being edited already
 * has one, which a forward does not. Dan's thank-you to Ted went out unsigned.
 *
 * In the editor it cannot lie. The marker is what keeps toggling safe: strip
 * from the marker to the end, so turning it off cannot leave half a signature
 * and turning it on twice cannot produce two.
 */
const SIGNATURE_MARK = '<div data-signature="1">';

function stripSignature(html: string): string {
  // From the marker to the end: the block contains nested divs, so matching a
  // closing tag would stop at the first one and leave the rest behind.
  return html.replace(/<div data-signature="1">[\s\S]*$/i, "").replace(/(\s|<div><br><\/div>)+$/i, "");
}

function withSignature(html: string, lines: string[]): string {
  const base = stripSignature(html);
  if (!lines.length) return base;
  return `${base}${SIGNATURE_MARK}<div><br></div>${lines.map((l) => `<div>${l}</div>`).join("")}</div>`;
}

export function ContactComposer({
  contactId,
  name,
  action,
  signature,
  seed,
  openInitially,
  initialInstruction,
  addressBook = [],
  sendAnywhere = [],
}: {
  /** Contacts and his own addresses, for the Cc and Bcc pickers. */
  addressBook?: { label: string; value: string }[];
  /** Documents that belong to no role, for a networking note. */
  sendAnywhere?: SendAnywhere[];
  contactId: string;
  name: string;
  action: (formData: FormData) => Promise<void>;
  signature: SignatureOptions | null;
  seed?: { subject: string; html: string; nonce: number; replace?: boolean; correspondenceId?: string; instructions?: string[] } | null;
  openInitially?: boolean;
  initialInstruction?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(Boolean(openInitially));
  /**
   * On by default and remembered. A signature is the normal case, and re-ticking
   * it on every note is the kind of friction that ends with one going out
   * unsigned - which is exactly what happened to the note thanking Ted.
   *
   * It has to be state, and it has to be declared above `html`, for two
   * reasons that both bit:
   *
   * - `html` reads it in its own initialiser. As a `const` declared further
   *   down it was in the temporal dead zone, so the composer threw
   *   "Cannot access 'signaturePreference' before initialization" on every
   *   render and the contact page would not load at all.
   * - Reading `localStorage` during render disagrees with the server, which
   *   has no storage and must assume the default. Both renders start from
   *   `true` now and the stored preference is applied on mount, so the markup
   *   matches and the signature is still there from the first paint.
   */
  // Always on when the composer opens. Deliberately NOT remembered.
  //
  // Dan asked for it to be "checked off by default and preserve the state",
  // and preserving it is what went wrong. Unticking once - while we were
  // building this, on a note that did not need it - wrote "0" to localStorage
  // and silently unsigned every note afterwards. Two went out that way in one
  // day, the second to a recruiter.
  //
  // The state worth keeping was ON. Off is a decision about one message, so it
  // now lasts exactly as long as that message. There is no failure mode where
  // the app quietly stops signing his mail and waits for him to notice.
  const signaturePreference = true;
  const defaultSignatureLines = () =>
    signature
      ? buildSignatureLines(signature, {
          emailLabel: signature.defaultEmailLabel ?? signature.emails[0]?.label ?? "",
          addressLabel: signature.defaultAddressLabel ?? "",
          includeLinks: true,
        })
      : [];

  // Present from the first paint, the way a mail client shows it, so the
  // checkbox describes something visible rather than something promised.
  const [html, setHtml] = useState(() =>
    signaturePreference && signature ? withSignature("", defaultSignatureLines()) : ""
  );
  const [includeSignature, setIncludeSignature] = useState(true);
  const [subject, setSubject] = useState("");
  const [emailLabel, setEmailLabel] = useState(signature?.defaultEmailLabel ?? signature?.emails[0]?.label ?? "");
  const [addressLabel, setAddressLabel] = useState(signature?.defaultAddressLabel ?? "");

  /**
   * Replaces the whole body, keeping the signature if the box is ticked.
   *
   * Every wholesale replacement has to go through this. Claude's draft used a
   * bare `setHtml`, so it discarded the signature block and left the checkbox
   * saying it was on - the third time this feature has lied about itself, and
   * the second in a different place. Dan had to untick and retick to get it
   * back, which is a workaround for a control that was already correct.
   *
   * An append (the forward path) is not a replacement and does not use this.
   */
  function replaceBody(next: string) {
    setHtml(
      includeSignature && signature
        ? withSignature(next, buildSignatureLines(signature, { emailLabel, addressLabel, includeLinks: true }))
        : next
    );
  }

  /**
   * Rewrites the message so the signature matches the controls.
   *
   * Every control that can change it goes through here - the checkbox and both
   * label pickers - because the signature is now real text in the editor and
   * three places building it independently is how two of them drift.
   */
  function syncSignature(next: { include?: boolean; email?: string; address?: string } = {}) {
    const include = next.include ?? includeSignature;
    const email = next.email ?? emailLabel;
    const address = next.address ?? addressLabel;
    const lines =
      include && signature ? buildSignatureLines(signature, { emailLabel: email, addressLabel: address, includeLinks: true }) : [];
    setHtml((current) => withSignature(current, lines));
  }
  // Set when editing an existing draft, so Save rewrites that row rather than
  // leaving a second copy of the same message in the thread.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Claude
  const [instruction, setInstruction] = useState(initialInstruction ?? "");
  const [drafting, setDrafting] = useState(false);

  // Drive
  const [attached, setAttached] = useState<Picked[]>([]);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  // Hidden until wanted: most notes have neither, and two empty boxes above
  // every message is the clutter this app keeps having to undo.
  const [showCopies, setShowCopies] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [trail, setTrail] = useState<{ id: string | null; label: string }[]>([{ id: null, label: "Jobs" }]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [query, setQuery] = useState("");
  const [loadingDrive, setLoadingDrive] = useState(false);

  // Reply hands a quoted block down from the conversation. Keyed on the nonce
  // so replying twice to the same message re-seeds rather than doing nothing.
  //
  // Applied during render rather than in an effect. As an effect it painted
  // the empty composer for a frame before the quoted text arrived, and the
  // lint flags the cascading render. `undefined` rather than `seed?.nonce` is
  // the important part of the initial value: seeded on first mount is the
  // normal case here - /contacts/<id>?write=1 opens with the composer already
  // filled - and starting from the current nonce would skip it.
  // Everything Dan has asked for while writing this note. Seeded from the
  // draft when one is reopened, so the conversation survives a page load.
  const [askedSoFar, setAskedSoFar] = useState<string[]>([]);

  const [lastNonce, setLastNonce] = useState<number | undefined>(undefined);
  if (seed && seed.nonce !== lastNonce) {
    setLastNonce(seed.nonce);
    setOpen(true);
    setEditingId(seed.correspondenceId ?? null);
    if (seed.replace) {
      // Editing: the draft replaces whatever is in the box rather than being
      // appended to it.
      //
      // Whether it is already signed is now a question with an answer, because
      // the block carries a marker. This used to assume yes and switch the
      // signature off, which is right for a draft Dan wrote and wrong for a
      // forward - a forwarded draft carries a signature inside the QUOTE and
      // none of its own, so the thank-you to Ted went out unsigned.
      setSubject(seed.subject);
      // The note carries what has already been asked for, so reopening it
      // continues the conversation instead of restarting it.
      setAskedSoFar(seed.instructions ?? []);
      const alreadySigned = seed.html.includes('data-signature="1"');
      setIncludeSignature(alreadySigned || signaturePreference);
      setHtml(
        alreadySigned || !signaturePreference || !signature
          ? seed.html
          : withSignature(seed.html, buildSignatureLines(signature, { emailLabel, addressLabel, includeLinks: true }))
      );
    } else {
      setSubject((current) => current || seed.subject);
      setHtml((current) => `${current}${seed.html}`);
    }
  }

  async function loadDrive(folderId: string | null, q?: string) {
    setLoadingDrive(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q?.trim()) params.set("q", q.trim());
      else if (folderId) params.set("folderId", folderId);
      const res = await fetch(`/api/drive/browse?${params}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Drive returned ${res.status}.`);
      setEntries(data.entries ?? []);
    } catch (e) {
      setError((e as Error).message);
      setEntries([]);
    } finally {
      setLoadingDrive(false);
    }
  }

  // What Dan has asked for while writing this one message. Cleared when the
  // composer resets after a save, since the next note is a new conversation.
  // "General" is right for most notes from a contact page. The others change
  // the register rather than the content.
  const [noteType, setNoteType] = useState<CorrespondenceType>("general");

  async function draftWithClaude() {
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch(`/api/contacts/${contactId}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The current text goes up so Claude works from what is there rather
        // than throwing away a half-written note.
        body: JSON.stringify({
          instruction,
          type: noteType,
          existing: htmlToPlainText(html),
          // Everything asked for so far, because each instruction used to
          // arrive alone and the previous one was simply forgotten.
          priorInstructions: askedSoFar,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Draft failed with ${res.status}.`);
      replaceBody(plainTextToHtml(data.content));
      // Fill an empty box, or overwrite when the subject is what he asked to
      // change. The plain `!subject` guard meant "give it a different subject"
      // silently did nothing: the box already had one, so the new subject was
      // fetched, returned, and dropped on the floor.
      if (data.subject && (!subject || data.replaceSubject)) setSubject(data.subject);
      // Recorded only once the call succeeded, so a failed attempt does not
      // put an instruction into the standing set that never took effect.
      if (instruction.trim()) setAskedSoFar((prior) => [...prior, instruction.trim()]);
      setInstruction("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-xl border border-dashed border-line-2 px-4 py-3 text-left text-[13px] text-[var(--tx-3)] transition hover:border-line hover:text-[var(--tx)]"
      >
        Write to {name.split(" ")[0]}...
      </button>
    );
  }

  return (
    <section className="panel mt-4 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-semibold">{editingId ? "Edit draft to" : "Write to"} {name}</h2>
        <button type="button" onClick={() => setOpen(false)} className="text-[11.5px] text-[var(--tx-3)] hover:text-[var(--tx)]">
          Cancel
        </button>
      </div>

      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        className="mt-2.5 w-full rounded-lg border border-line bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--tx)]"
      />
      <RichTextEditor html={html} onChange={setHtml} placeholder="Write the note, or tell Claude below what it should say." />

      {signature && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
          <span className="text-[var(--tx-3)]">Sign off with</span>
          <select
            value={emailLabel}
            onChange={(e) => {
              setEmailLabel(e.target.value);
              syncSignature({ email: e.target.value });
            }}
            className="rounded-md border border-line bg-[var(--surface-2)] px-1.5 py-1 text-[11.5px] text-[var(--tx-2)]"
          >
            {signature.emails.map((e) => (
              <option key={e.label} value={e.label}>
                {e.label}: {e.value}
              </option>
            ))}
          </select>
          <select
            value={addressLabel}
            onChange={(e) => {
              setAddressLabel(e.target.value);
              syncSignature({ address: e.target.value });
            }}
            className="rounded-md border border-line bg-[var(--surface-2)] px-1.5 py-1 text-[11.5px] text-[var(--tx-2)]"
          >
            <option value="">No address</option>
            {signature.addresses.map((a) => (
              <option key={a.label} value={a.label}>
                {a.label}: {a.value}
              </option>
            ))}
          </select>
          <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-[var(--tx-2)]">
            <input
              type="checkbox"
              checked={includeSignature}
              onChange={(e) => {
                setIncludeSignature(e.target.checked);
                syncSignature({ include: e.target.checked });
                // Remembered, so the choice survives the next note.
                try {
                } catch {
                  /* private mode; the default still applies */
                }
              }}
              className="h-3.5 w-3.5 accent-[var(--amber)]"
            />
            Include signature
          </label>
          <span className="text-[11px] text-[var(--tx-3)]">
            {includeSignature
              ? buildSignatureLines(signature, { emailLabel, addressLabel, includeLinks: true }).join("  ·  ")
              : "nothing appended"}
          </span>
        </div>
      )}

      {/*
        What kind of note this is.
        
        The types and their prompts existed before this control did, reachable
        only from the role page - so a new "applying, letting them know" type
        was added and the contact page, where you would actually write one,
        looked exactly as it had. A prompt nobody can select is not a feature.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-[var(--surface-2)] p-2">
        <select
          value={noteType}
          onChange={(e) => setNoteType(e.target.value as CorrespondenceType)}
          title="Changes how Claude writes it"
          className="rounded-md border border-line bg-[var(--surface)] px-1.5 py-1 text-[11.5px] text-[var(--tx-2)]"
        >
          {CORRESPONDENCE_TYPES.map((t) => (
            <option key={t} value={t}>
              {CORRESPONDENCE_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !drafting) {
              e.preventDefault();
              void draftWithClaude();
            }
          }}
          placeholder={html ? "Tell Claude how to change it..." : "Tell Claude what this should say (or leave blank)..."}
          className="min-w-0 flex-1 bg-transparent px-1 text-[12.5px] text-[var(--tx)] outline-none"
        />
        <button
          type="button"
          disabled={drafting}
          onClick={() => void draftWithClaude()}
          className={buttonClass("primary", "sm", "shrink-0")}
        >
          {drafting ? "Writing..." : html ? "Revise" : "Draft it"}
        </button>
      </div>
      <p className="mt-1 px-1 text-[11px] text-[var(--tx-3)]">
        Claude sees this conversation, the role if there is one, and your profile. It never sends anything.
      </p>

      {showCopies ? (
        <div className="mt-2 space-y-1.5">
          {([["Cc", cc, setCc], ["Bcc", bcc, setBcc]] as const).map(([label, value, set]) => (
            <label key={label} className="flex items-center gap-2">
              <span className="w-8 shrink-0 text-[11px] text-[var(--tx-3)]">{label}</span>
              <input
                list="composer-addresses"
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={label === "Bcc" ? "hidden from the others" : "comma separated"}
                className="flex-1 rounded border border-line-2 bg-[var(--surface-2)] px-2 py-1 text-[12.5px]"
              />
            </label>
          ))}
          {/* Contacts and his own addresses, so the common cases are a pick
              rather than a retype, while an assistant who will never be a
              contact can still just be typed. */}
          <datalist id="composer-addresses">
            {addressBook.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </datalist>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowCopies(true)}
          className="mt-1.5 text-[11px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
        >
          Cc / Bcc
        </button>
      )}

      {/* One click, because this is the whole point of a networking note and
          the alternative is hunting for two files in a Drive picker. Attached
          as PDF: it is what a stranger opens without thinking, and the Word
          copy is for Dan to edit rather than to send. */}
      {sendAnywhere.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-[var(--tx-3)]">Attach:</span>
          {sendAnywhere.map((d) => {
            const fileId = d.pdf ?? d.docx;
            if (!fileId) return null;
            const name = `${d.label}.${d.pdf ? "pdf" : "docx"}`;
            const already = attached.some((a) => a.driveFileId === fileId);
            return (
              <button
                key={d.id}
                type="button"
                disabled={already}
                onClick={() => setAttached((xs) => [...xs, { driveFileId: fileId, name }])}
                className="rounded-lg border border-line px-2 py-1 text-[11.5px] text-[var(--tx-2)] transition hover:text-[var(--tx)] disabled:opacity-40"
              >
                {already ? `${d.label} attached` : d.label}
              </button>
            );
          })}
        </div>
      )}

      {attached.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {attached.map((a) => (
            <li key={a.driveFileId} className="flex items-center gap-1.5 rounded-lg border border-line bg-[var(--surface-2)] px-2 py-1 text-[11.5px]">
              <span className="max-w-56 truncate text-[var(--tx-2)]">{a.name}</span>
              <button
                type="button"
                onClick={() => setAttached((xs) => xs.filter((x) => x.driveFileId !== a.driveFileId))}
                className="text-[var(--tx-3)] hover:text-[var(--tx)]"
                aria-label={`Remove ${a.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {browsing && (
        <div className="mt-2 rounded-lg border border-line bg-[var(--surface-2)] p-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void loadDrive(null, query);
                }
              }}
              placeholder="Search Drive, or browse below"
              className="min-w-0 flex-1 rounded-md border border-line bg-[var(--bg)] px-2 py-1 text-[12px]"
            />
            <button type="button" onClick={() => setBrowsing(false)} className="text-[11.5px] text-[var(--tx-3)] hover:text-[var(--tx)]">
              Close
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px] text-[var(--tx-3)]">
            {trail.map((t, i) => (
              <button
                key={`${t.id}-${i}`}
                type="button"
                onClick={() => {
                  setTrail(trail.slice(0, i + 1));
                  setQuery("");
                  void loadDrive(t.id);
                }}
                className="hover:text-[var(--tx)]"
              >
                {t.label}
                {i < trail.length - 1 && <span className="ml-1">/</span>}
              </button>
            ))}
          </div>
          <ul className="mt-1.5 max-h-56 overflow-y-auto">
            {loadingDrive && <li className="px-1 py-2 text-[12px] text-[var(--tx-3)]">Loading...</li>}
            {!loadingDrive && entries.length === 0 && <li className="px-1 py-2 text-[12px] text-[var(--tx-3)]">Nothing here.</li>}
            {entries.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (e.isFolder) {
                      setTrail((t) => [...t, { id: e.id, label: e.name }]);
                      setQuery("");
                      void loadDrive(e.id);
                    } else {
                      setAttached((xs) =>
                        xs.some((x) => x.driveFileId === e.id) ? xs : [...xs, { driveFileId: e.id, name: e.name }]
                      );
                      setBrowsing(false);
                    }
                  }}
                  className="flex w-full items-baseline gap-2 rounded-md px-1 py-1.5 text-left text-[12.5px] transition hover:bg-[var(--bg)]"
                >
                  <span className="text-[var(--tx-3)]">{e.isFolder ? "▸" : "·"}</span>
                  <span className="min-w-0 truncate text-[var(--tx)]">{e.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className={ERROR_BLOCK}>{error}</p>}

      {/*
        Said out loud, next to the button that acts.
        
        An unticked checkbox in a panel above is not a warning: two notes went
        out unsigned in one day and the box was sitting there both times. This
        is not a second control, it is the same fact where the decision is.
      */}
      {!includeSignature && (
        <p className="mt-2.5 text-[12.5px] text-[var(--amber)]">
          This note has no signature on it.
        </p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!htmlToPlainText(html).trim() || saving}
          onClick={() =>
            startSave(async () => {
              setError(null);
              // What is in the editor is what gets sent. The signature used to
              // be appended here and never shown, which made the checkbox a
              // claim rather than a fact - and it was wrong at least once, on
              // a forwarded note that went out unsigned.
              const signedHtml = html;

              const fd = new FormData();
              fd.set("subject", subject);
              fd.set("content", htmlToPlainText(signedHtml));
              fd.set("contentHtml", signedHtml);
              if (editingId) fd.set("correspondenceId", editingId);
              fd.set("attachments", JSON.stringify(attached.map((a) => ({ ...a, kind: "drive" }))));
              fd.set("instructions", JSON.stringify(askedSoFar));
              fd.set("cc", cc);
              fd.set("bcc", bcc);
              try {
                await action(fd);
                setSubject("");
                setAskedSoFar([]);
                setAttached([]);
                setCc("");
                setBcc("");
                setShowCopies(false);
                setEditingId(null);
                setIncludeSignature(signaturePreference);
                setHtml(
                  signaturePreference && signature
                    ? withSignature("", buildSignatureLines(signature, { emailLabel, addressLabel, includeLinks: true }))
                    : ""
                );
                setOpen(false);
                router.refresh();
              } catch {
                setError("Could not save that draft.");
              }
            })
          }
          className={buttonClass("primary", "md")}
        >
          {saving ? "Saving..." : editingId ? "Update draft" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !browsing;
            setBrowsing(next);
            if (next && entries.length === 0) void loadDrive(null);
          }}
          className="rounded-lg border border-line px-3 py-2 text-[12.5px] text-[var(--tx-2)] transition hover:text-[var(--tx)]"
        >
          Attach from Drive
        </button>
        <span className="text-[11.5px] text-[var(--tx-3)]">Send it from the conversation below when it reads right.</span>
      </div>
    </section>
  );
}
