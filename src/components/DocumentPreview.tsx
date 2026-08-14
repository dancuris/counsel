"use client";

import { useEffect, useState } from "react";

/**
 * Shows what the document actually looks like, rather than its source text.
 *
 * Two tabs, because they answer different questions and only one of them would
 * have caught the bugs that shipped.
 *
 * - **PDF** renders through the app's own pdf path, so it is exactly the file
 *   that gets attached to an email. Instant, and independent of Drive.
 * - **Word** embeds Drive's render of the .docx. Every formatting fault found
 *   so far has been in the docx - a missing letterhead rule, wrong letterhead
 *   spacing, bullets flattened onto one line, a resume spilling to two pages -
 *   and a PDF preview shows none of them, because the two formats go through
 *   completely separate renderers that have drifted apart before.
 *
 * Office 365 was considered and rejected: embedding a Word-rendered document
 * requires the file to live in OneDrive or SharePoint, which would split the
 * archive across two clouds to gain a little fidelity over what Drive already
 * renders for free.
 */
export function DocumentPreview({
  documentId,
  driveFileIdDocx,
  hasContent,
}: {
  documentId: string;
  driveFileIdDocx?: string | null;
  hasContent: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Default to whichever tab can actually show something. A document adopted
  // from Drive has no stored content, so there is no PDF to render for it.
  const [tab, setTab] = useState<"pdf" | "word">(hasContent ? "pdf" : "word");
  // An iframe that never paints looks identical to a button that did nothing.
  // Safari, and iOS Safari in particular, routinely refuses to render a PDF
  // inside a frame and leaves it blank with no error, so the overlay opens onto
  // white and reads as broken. A spinner says the app heard the click, and the
  // escape hatch is always there rather than appearing only after a timeout.
  const [loaded, setLoaded] = useState(false);

  // Reset during render, not in an effect.
  //
  // Resetting the spinner in a useEffect makes React paint the previous
  // document's "loaded" state for a frame before clearing it, and the lint
  // flags it as a cascading render for exactly that reason. This is React's
  // documented shape for state that has to reset when a prop changes: compare
  // against the previous value and adjust on the spot, so nothing renders with
  // the stale value at all.
  const viewKey = `${open}:${tab}`;
  const [lastViewKey, setLastViewKey] = useState(viewKey);
  if (viewKey !== lastViewKey) {
    setLastViewKey(viewKey);
    setLoaded(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!hasContent && !driveFileIdDocx) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-2.5 py-1 text-xs font-medium text-[var(--tx-2)] transition hover:text-[var(--tx)]"
      >
        Preview file
      </button>
    );
  }

  const src =
    tab === "pdf"
      ? `/api/documents/${documentId}?format=pdf&inline=1`
      : driveFileIdDocx
        ? `https://drive.google.com/file/d/${driveFileIdDocx}/preview`
        : null;

  // A full overlay rather than a box inside the panel. A page of A4 squeezed
  // into a 560px sliver of a column is unreadable, which defeats the point of
  // previewing it at all: the whole question is whether the layout is right.
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && setOpen(false)}
    >
      <div className="flex h-full max-h-[94vh] w-full max-w-5xl flex-col panel p-3 shadow-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-lg border border-line bg-[var(--surface-2)] p-0.5 text-xs">
            {(["pdf", "word"] as const).map((t) => {
              const disabled = t === "pdf" ? !hasContent : !driveFileIdDocx;
              return (
                <button
                  key={t}
                  type="button"
                  disabled={disabled}
                  onClick={() => setTab(t)}
                  title={
                    disabled
                      ? t === "pdf"
                        ? "This document has no stored content - it lives in Drive"
                        : "Not filed to Drive yet"
                      : undefined
                  }
                  className={`rounded-md px-3 py-1 transition ${
                    tab === t ? "bg-accent text-white" : "text-[var(--tx-3)] hover:text-[var(--tx)]"
                  } disabled:opacity-40`}
                >
                  {t === "pdf" ? "PDF" : "Word"}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-3">
            <p className="hidden text-[11px] text-[var(--tx-3)] sm:block">
              {tab === "pdf"
                ? "The exact PDF that gets attached."
                : "Drive's render of the .docx, where formatting faults show up."}
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg border border-line px-2.5 py-1 text-xs text-[var(--tx-2)] transition hover:text-[var(--tx)]"
            >
              Close
            </button>
          </div>
        </div>

        {src ? (
          <div className="relative mt-2.5 flex min-h-0 flex-1 flex-col">
            {!loaded && (
              <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-[var(--surface)] text-[12.5px] text-[var(--tx-3)]">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-[var(--tx-3)]" />
                Rendering the {tab === "pdf" ? "PDF" : "Word"} file...
              </div>
            )}
            <iframe
              key={src}
              src={src}
              onLoad={() => setLoaded(true)}
              title={tab === "pdf" ? "PDF preview" : "Word preview"}
              className="min-h-0 w-full flex-1 rounded-lg border border-line bg-[var(--surface)]"
            />
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="mt-2 shrink-0 text-center text-[11.5px] text-[var(--tx-3)] underline transition-colors hover:text-[var(--tx)]"
            >
              Not showing? Open it in a new tab
            </a>
          </div>
        ) : (
          <p className="mt-2 text-xs text-[var(--tx-3)]">Nothing to show for this format.</p>
        )}
      </div>
    </div>
  );
}
