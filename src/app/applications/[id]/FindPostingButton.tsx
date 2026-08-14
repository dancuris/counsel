"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/lib/button";
import { ERROR_TEXT } from "@/lib/type";

type Posting = { title: string; location: string; url: string; reqId?: string; postedOn?: string };

export function FindPostingButton({
  applicationId,
  postingLink,
  documents = [],
  status,
}: {
  applicationId: string;
  postingLink: string | null;
  /** Current resume and cover letter, for the download-on-apply step. */
  documents?: { id: string; type: string }[];
  /**
   * Where the application actually is. Without it this button offered
   * "Apply" on roles Dan was already interviewing for, because it only ever
   * checked whether a posting link existed.
   */
  status: string;
}) {
  const router = useRouter();
  /**
   * Applying is only the next step before an application exists.
   *
   * After that the posting is reference: useful to reread before an interview,
   * but "Apply" on a role you are interviewing for reads as though the app has
   * lost track of where you are. The pre-application statuses are the same set
   * the pipeline calls PRE_DECISION.
   */
  const applyIsTheNextStep = ["TARGET", "LIVE_POSTING_FOUND", "VERIFY"].includes(status);
  const [postings, setPostings] = useState<Posting[] | null>(null);
  const [board, setBoard] = useState<{ provider: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [careersUrl, setCareersUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [saving, startSave] = useTransition();

  function find() {
    setError(null);
    setMessage(null);
    setPostings(null);
    setCareersUrl(null);
    startSearch(async () => {
      const res = await fetch("/api/find-posting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't search.");
        return;
      }
      setBoard(data.board);
      setPostings(data.postings ?? []);
      setMessage(data.message ?? null);
      setCareersUrl(data.careersUrl ?? null);
    });
  }

  function use(url: string) {
    startSave(async () => {
      const res = await fetch("/api/find-posting", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, url }),
      });
      if (!res.ok) {
        setError("Could not save that posting link.");
        return;
      }
      setPostings(null);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {postingLink && (
          <a
            href={postingLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              // Only when applying. Opening the posting to reread it before an
              // interview should not dump two files into Downloads.
              if (!applyIsTheNextStep) return;
              // Put the documents on the machine at the moment they are needed.
              //
              // An application form's file picker reads the local disk, so a
              // Drive link is no use to it, and the real files sit four folders
              // deep under Jobs. Downloaded now they are the newest thing in
              // Downloads, which is where every file picker opens and sorts to
              // the top - the first row rather than a hunt.
              //
              // A hidden iframe per file rather than a click on an anchor:
              // several programmatic downloads in a row get treated as a popup
              // burst and silently blocked.
              const wanted = ["resume", "cover_letter"]
                .map((t) => documents.find((d) => d.type === t))
                .filter((d): d is { id: string; type: string } => Boolean(d));

              if (wanted.length === 0) {
                setMessage("No resume or cover letter yet - generate them before you submit.");
                return;
              }
              for (const [i, doc] of wanted.entries()) {
                setTimeout(() => {
                  const frame = document.createElement("iframe");
                  frame.style.display = "none";
                  frame.src = `/api/documents/${doc.id}?format=pdf`;
                  document.body.appendChild(frame);
                  setTimeout(() => frame.remove(), 60_000);
                }, i * 400);
              }
              setMessage(
                wanted.length === 2
                  ? "Resume and cover letter downloading - they will be at the top of your Downloads folder."
                  : "Downloading what exists. The other document has not been generated yet."
              );
            }}
            className="rounded-lg bg-[var(--amber)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
          >
            {applyIsTheNextStep ? "Apply →" : "Open the posting →"}
          </a>
        )}
        <button
          type="button"
          onClick={find}
          disabled={searching}
          className={buttonClass("outline", "sm")}
        >
          {searching ? "Searching boards..." : postingLink ? "Re-check the posting" : "Find the posting"}
        </button>
      </div>

      {message && (
        <p className="text-xs text-[var(--tx-3)]">
          {message}
          {careersUrl && (
            <>
              {" "}
              <a href={careersUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--tx)]">
                Open careers site →
              </a>
            </>
          )}
        </p>
      )}
      {error && <p className={ERROR_TEXT}>{error}</p>}

      {postings && postings.length > 0 && (
        <div className="rounded-xl border border-line bg-[var(--surface-2)] p-2">
          <p className="px-1 pb-1.5 text-[11px] text-[var(--tx-3)]">
            From {board?.provider}. Pick the match to set it as this role&apos;s posting link.
          </p>
          <ul className="flex flex-col gap-1">
            {postings.map((p) => (
              <li
                key={p.url}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-[var(--surface)] px-2.5 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-medium">{p.title}</span>
                  <span className="block truncate text-[11px] text-[var(--tx-3)]">
                    {p.location}
                    {p.reqId ? ` · ${p.reqId}` : ""}
                    {p.postedOn ? ` · ${p.postedOn}` : ""}
                  </span>
                </span>
                <span className="flex flex-none gap-1.5">
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded border border-line-2 px-2 py-1 text-[11px] transition-colors hover:bg-[var(--surface-2)]"
                  >
                    Open
                  </a>
                  <button
                    type="button"
                    onClick={() => use(p.url)}
                    disabled={saving}
                    className="rounded bg-[var(--tx)] px-2 py-1 text-[11px] font-medium text-[var(--bg)] disabled:opacity-40"
                  >
                    Use this
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
