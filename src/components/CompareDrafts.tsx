"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewerFor, modelLabel } from "@/lib/reviewer";
import { updateDocumentContent } from "@/app/applications/[id]/document-actions";
import { buttonClass } from "@/lib/button";
import { ERROR_TEXT } from "@/lib/type";

/**
 * Two drafts of the same role, from two providers.
 *
 * The comparison deliberately is not "which of these is better". Asked that,
 * a model returns a confident answer with nothing underneath it, and it picks
 * its own draft more often than not. So both drafts are run through the same
 * review the editor uses, and what is shown is **what each one gets wrong**:
 * two blocking findings against none is a reason to pick a version. A
 * paragraph of praise is not.
 *
 * The alternative is generated in preview mode and never written to the
 * database until Dan keeps it, so the document he has been working on stays
 * current, the Drive link keeps pointing at it, and an unwanted comparison
 * costs nothing to walk away from.
 */

type Side = { label: string; model: string | null; resume: string; coverLetter: string };

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function CompareDrafts({
  applicationId,
  resumeDocId,
  coverLetterDocId,
  currentResume,
  currentCoverLetter,
  currentModel,
}: {
  applicationId: string;
  resumeDocId: string;
  coverLetterDocId: string;
  currentResume: string;
  currentCoverLetter: string;
  currentModel: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [alt, setAlt] = useState<Side | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDrafting, startDraft] = useTransition();
  const [isKeeping, startKeep] = useTransition();

  const otherModel = reviewerFor(currentModel);

  function draftAlternative() {
    setError(null);
    startDraft(async () => {
      const res = await fetch("/api/generate-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, model: otherModel, preview: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not draft the alternative.");
        return;
      }
      setAlt({
        label: modelLabel(data.model ?? otherModel),
        model: data.model ?? otherModel,
        resume: data.resume ?? "",
        coverLetter: data.coverLetter ?? "",
      });
    });
  }

  function keepAlternative() {
    if (!alt) return;
    setError(null);
    startKeep(async () => {
      // Saved through the ordinary edit path, once per document type, so both
      // land in the same append-only history and both reach Drive.
      for (const [id, content] of [
        [resumeDocId, alt.resume],
        [coverLetterDocId, alt.coverLetter],
      ] as const) {
        if (!content.trim()) continue;
        const fd = new FormData();
        fd.set("content", content);
        fd.set("model", alt.model ?? "");
        await updateDocumentContent(id, applicationId, fd);
      }
      setAlt(null);
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-[var(--tx-2)] transition hover:text-[var(--tx)]"
      >
        Compare with {modelLabel(otherModel)}
      </button>
    );
  }

  return (
    <div className="mt-3 w-full rounded-lg border border-line bg-[var(--surface-2)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px] text-[var(--tx-2)]">
          Drafts the whole set again with {modelLabel(otherModel)}. Nothing is saved until you keep one.
        </p>
        {/* Written before the content, per the rule this app keeps relearning:
            a panel that opens must be closable from the moment it opens.
            Nothing here is ever unsaved now, so Close costs nothing: the
            alternative is a preview until it is kept. */}
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setAlt(null);
            setError(null);
          }}
          className="text-xs text-[var(--tx-3)] transition hover:text-[var(--tx)]"
          aria-label="Close the comparison"
        >
          Close
        </button>
      </div>

      {!alt && (
        <button
          type="button"
          onClick={draftAlternative}
          disabled={isDrafting}
          className={buttonClass("primary", "sm", "mt-2")}
        >
          {isDrafting ? `${modelLabel(otherModel)} is drafting...` : `Draft it with ${modelLabel(otherModel)}`}
        </button>
      )}

      {alt && (
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {(
            [
              { id: "current" as const, title: `Current${currentModel ? ` (${modelLabel(currentModel)})` : ""}`, text: currentResume },
              { id: "alt" as const, title: `${alt.label} draft`, text: alt.resume },
            ] as const
          ).map((side) => (
            <div key={side.id} className="rounded-lg border border-line bg-[var(--surface)] p-2.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[12.5px] font-medium text-[var(--tx)]">{side.title}</p>
                <span className="text-[11px] text-[var(--tx-3)]">{countWords(side.text).toLocaleString()} words</span>
              </div>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-line bg-[var(--surface-2)] p-2 font-mono text-[10.5px] leading-relaxed text-[var(--tx-2)]">
                {side.text}
              </pre>
              {side.id === "alt" && (
                <>
                  <button
                    type="button"
                    onClick={keepAlternative}
                    disabled={isKeeping}
                    className={buttonClass("primary", "sm", "mt-2 w-full")}
                  >
                    {isKeeping ? "Saving..." : "Keep this one"}
                  </button>
                  {/* Only resumes are shown, but keeping writes the cover
                      letter drafted in the same pass. Replacing a document Dan
                      has not seen must not happen quietly. */}
                  <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--tx-3)]">
                    Also replaces the cover letter, drafted in the same pass and not shown here:{" "}
                    {countWords(currentCoverLetter).toLocaleString()} words now,{" "}
                    {countWords(alt.coverLetter).toLocaleString()} in this draft.
                  </p>
                </>
              )}
              {side.id === "current" && (
                <p className="mt-2 text-[10.5px] leading-relaxed text-[var(--tx-3)]">
                  Keeping this one needs no action. Close and it stays as it is.
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* No checking here on purpose. This panel answers one question - which
          of two drafts do you want - and checking a draft belongs with the
          fixing, which is in the document itself. Two surfaces that both said
          "review" and only one of which could act on what it found is what
          made this confusing in the first place. */}
      {alt && (
        <p className="mt-2.5 text-[11px] text-[var(--tx-3)]">
          Keep one, then use Check it on the document to see what is wrong with it and fix it there.
        </p>
      )}

      {error && <p className={ERROR_TEXT}>{error}</p>}
    </div>
  );
}
