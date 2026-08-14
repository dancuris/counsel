"use client";

import { ConfirmButton } from "@/components/ConfirmButton";

import { useState, useTransition, useMemo, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { parseDocLines } from "@/lib/document-format";
import { driveFileUrl, driveDocEditUrl } from "@/lib/drive-links";
import { importDriveDocument } from "@/app/applications/[id]/drive-actions";
import { DocumentPreview } from "@/components/DocumentPreview";
import { ModelSelect } from "@/components/ModelSelect";
import { reviewerFor, modelLabel } from "@/lib/reviewer";
import { updateDocumentContent, deleteDocument } from "@/app/applications/[id]/document-actions";
import { buttonClass } from "@/lib/button";
import { EMPTY_INLINE, ERROR_TEXT } from "@/lib/type";

type Finding = {
  severity: "blocking" | "worth_fixing" | "minor";
  kind: string;
  what: string;
  fix: string;
  /** Needs a fact only Dan has, so it is never included in "Fix N". */
  needsHim: boolean;
  question: string;
};
type Review = { verdict: string; summary: string; findings: Finding[]; reviewedBy: string };

const SEVERITY_LABEL: Record<string, string> = {
  blocking: "Blocking",
  worth_fixing: "Worth fixing",
  minor: "Minor",
};

// Arial 11pt, single spaced, 1in margins fits roughly this many words per
// page. It is an estimate, always shown with a "~", but it is the difference
// between writing to a page target and guessing at one.
const WORDS_PER_PAGE = 475;

function countWords(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

export function DocumentEditor({
  documentId,
  applicationId,
  initialContent,
  driveFileIdDocx,
  driveFileIdPdf,
  writtenBy,
  autoReview,
}: {
  documentId: string;
  applicationId: string;
  initialContent: string;
  driveFileIdDocx?: string | null;
  driveFileIdPdf?: string | null;
  /** Which model wrote this version. Null before the column existed. */
  writtenBy?: string | null;
  /** Arrived from "Review the resume" in the top row: start the review. */
  autoReview?: boolean;
}) {
  const router = useRouter();
  const [content, setContent] = useState(initialContent);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [instruction, setInstruction] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Who rewrote the text sitting in the box, so saving records the right
  // writer and the next review still comes from the other provider.
  const [refinedBy, setRefinedBy] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  // A refine has happened since the last review, so what is on screen has not
  // been checked. Distinct from "never reviewed": this one needs a re-read.
  const [staleAfterRefine, setStaleAfterRefine] = useState(false);
  // At least one fix has been applied since the last check, so the findings
  // still listed describe text that has moved underneath them.
  const [unverified, setUnverified] = useState(false);
  // WHICH control is running, not merely that one is.
  //
  // Every per-finding button read the shared `isRefining` flag, so clicking one
  // "Fix this" turned all of them into "Fixing..." at once and it looked like
  // the whole list had been kicked off. Only the clicked one ever ran. The
  // others still disable, because two refines racing on the same text would
  // overwrite each other, but they say nothing about running.
  const [running, setRunning] = useState<string | null>(null);
  // Occasional controls, collapsed by default.
  const [showMore, setShowMore] = useState(false);
  // Answers to the questions only Dan can settle, and the questions he has
  // said he cannot answer - kept so the same one stops being asked all session.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [isReviewing, startReview] = useTransition();
  const [isRefining, startRefine] = useTransition();
  const [isSaving, startSave] = useTransition();
  const [isSavingToDrive, startDrive] = useTransition();
  const [isImporting, startImport] = useTransition();
  // Links come from the server on load and are replaced in place after a manual
  // save, so the buttons appear without a round trip through the page.
  const [drive, setDrive] = useState<{ docx: string | null; pdf: string | null }>({
    docx: driveFileIdDocx ? driveFileUrl(driveFileIdDocx) : null,
    pdf: driveFileIdPdf ? driveFileUrl(driveFileIdPdf) : null,
  });

  const words = useMemo(() => countWords(content), [content]);
  const pages = useMemo(() => Math.max(1, Math.round((words / WORDS_PER_PAGE) * 10) / 10), [words]);
  const dirty = content !== initialContent;
  const lines = useMemo(() => parseDocLines(content), [content]);

  function save() {
    setError(null);
    startSave(async () => {
      const fd = new FormData();
      fd.set("content", content);
      if (refinedBy) fd.set("model", refinedBy);
      await updateDocumentContent(documentId, applicationId, fd);
      router.refresh();
    });
  }

  function saveToDrive() {
    setError(null);
    startDrive(async () => {
      const res = await fetch(`/api/documents/${documentId}/drive`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Saving to Drive failed.");
        return;
      }
      setDrive({ docx: data.links?.docx ?? null, pdf: data.links?.pdf ?? null });
    });
  }

  /**
   * `explicit` is for applying findings in one click.
   *
   * It cannot read `instruction` from state in that case: setInstruction is
   * asynchronous, so a handler that sets it and then calls refine sends
   * whatever was in the box before, which is usually nothing.
   */
  function refine(explicit?: string, tag = "box", applied?: Finding) {
    const using = explicit ?? instruction;
    setError(null);
    setRunning(tag);
    startRefine(async () => {
      const res = await fetch("/api/documents/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId, content, instruction: using, model: model || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Refine failed.");
        setRunning(null);
        return;
      }
      setRunning(null);
      setContent(data.content);
      setInstruction("");
      setRefinedBy(data.model ?? model ?? null);
      // The findings described the text that was just replaced. Keeping them
      // on screen would have him fixing things that are already gone, or
      // trusting a clean bill of health for a document nobody checked.
      // Fixing ONE finding keeps the others.
      //
      // Clearing the whole list after every fix meant working through three
      // findings cost three checks, at about twenty-five seconds each, and the
      // list vanished under you between them. A single targeted fix rarely
      // invalidates the other findings, so they stay and the one just applied
      // drops off. A bulk rewrite is different: everything moved, so the list
      // goes and the panel says it has not been re-checked.
      if (applied) {
        setReview((r) => (r ? { ...r, findings: r.findings.filter((f) => f !== applied) } : r));
        setUnverified(true);
      } else {
        setReview(null);
        // A refine does NOT reliably apply what it was asked to: the same
        // letter with the same three blocking findings, run twice, removed the
        // "Atlanta is home for me" line once and left it the other time. The
        // rewrite is a proposal, and the only way to know is to look again.
        setStaleAfterRefine(true);
      }
    });
  }

  // Once per arrival, never on a re-render. A review is a paid model call and
  // an effect that re-fires would spend money quietly; the ref is what makes
  // "run this on arrival" different from "run this whenever React feels like
  // it". Deliberately not gated on `content` either, or editing the box would
  // queue another one.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!autoReview || autoRan.current) return;
    autoRan.current = true;
    runReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoReview]);

  function runReview() {
    setError(null);
    setReview(null);
    setStaleAfterRefine(false);
    setUnverified(false);
    startReview(async () => {
      const res = await fetch("/api/documents/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Sends what is on screen, not what is stored: reviewing the saved
        // copy would report problems he has already typed over.
        body: JSON.stringify({ documentId, content }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Review failed.");
        return;
      }
      setReview(data as Review);
    });
  }

  // A document adopted from Drive has no stored text - the file in Drive is the
  // record. It used to carry a placeholder sentence instead, which rendered as
  // the document body and, worse, was what a download actually contained. Now
  // it says where the document is and offers to open it, rather than presenting
  // an empty editor over a resume that exists somewhere else.
  if (!initialContent.trim() && (drive.docx || drive.pdf)) {
    return (
      <div className="mt-3 border-t border-line pt-3">
        <p className="text-[13px] text-[var(--tx-2)]">
          Written before Counsel existed, so the Drive file is the only copy there is. Editing it in Google Docs
          changes that file directly; nothing is stored here to edit instead.
        </p>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {driveFileIdDocx && (
            <a
              href={driveDocEditUrl(driveFileIdDocx)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass("primary", "sm")}
            >
              Edit Word doc
            </a>
          )}
          {drive.pdf && (
            <a
              href={drive.pdf}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-[var(--tx-2)] transition hover:text-[var(--tx)]"
            >
              View PDF
            </a>
          )}
          {/* Pulling the text in inverts which copy is authoritative, so it is
              an explicit choice rather than something attaching does for you:
              once there is stored content, Counsel maintains the Drive file and
              the next save overwrites it. */}
          {driveFileIdDocx && (
            <button
              type="button"
              disabled={isImporting}
              onClick={() =>
                startImport(async () => {
                  await importDriveDocument(documentId, applicationId);
                  router.refresh();
                })
              }
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-[var(--tx-2)] transition hover:text-[var(--tx)] disabled:opacity-50"
              title="Copy the text into Counsel so it can be edited and refined here"
            >
              {isImporting ? "Importing..." : "Import to edit here"}
            </button>
          )}
        </div>
        <DocumentPreview documentId={documentId} driveFileIdDocx={driveFileIdDocx} hasContent={false} />
      </div>
    );
  }

  // What state this document is in, as one sentence.
  //
  // The panel used to show two dozen coequal, always-enabled controls and no
  // indication of where the document stood. "Has this been checked, were the
  // fixes applied, is it saved, does Drive match" are four independent facts
  // and none of them were on screen, which is why "does it add in what is
  // missing" could not be answered by looking.
  const needsHim = review?.findings.filter((f) => f.needsHim) ?? [];
  const fixable = review?.findings.filter((f) => !f.needsHim) ?? [];
  const status = !review
    ? staleAfterRefine
      ? { text: "Rewritten, not checked since", tone: "warn" as const }
      : { text: writtenBy ? `Drafted by ${modelLabel(writtenBy)}, not checked` : "Not checked", tone: "idle" as const }
    : review.findings.length === 0
      ? { text: "Checked, nothing found", tone: "good" as const }
      : {
          text: [
            fixable.length ? `${fixable.length} to fix` : null,
            needsHim.length ? `${needsHim.length} need${needsHim.length === 1 ? "s" : ""} you` : null,
          ]
            .filter(Boolean)
            .join(", "),
          tone: "warn" as const,
        };

  return (
    <div className="mt-3 border-t border-line pt-3">
      {/* One line, then one action. Everything occasional is behind More. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <p className="flex items-center gap-2 text-[13px]">
          <span
            aria-hidden
            className={`inline-block h-1.5 w-1.5 rounded-full ${
              status.tone === "good"
                ? "bg-[var(--mint)]"
                : status.tone === "warn"
                  ? "bg-[var(--amber)]"
                  : "bg-[var(--tx-3)]"
            }`}
          />
          <span className="text-[var(--tx)]">{status.text}</span>
          <span className="text-[var(--tx-3)]">
            · {words.toLocaleString()} words · ~{pages} {pages === 1 ? "page" : "pages"}
            {dirty ? " · unsaved" : ""}
          </span>
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {/* Check stays reachable whenever the document has not been checked,
              even while something else is the primary action.
              Making the three mutually exclusive meant that straight after a
              fix the status read "Rewritten, not checked since" while the only
              button was Save changes - the line told Dan to do a thing the
              screen had just removed. A status that names an action has to
              leave that action on screen. */}
          {!review && dirty && (
            <button
              type="button"
              onClick={runReview}
              disabled={isReviewing || !content.trim()}
              className={buttonClass("outline", "sm")}
            >
              {isReviewing ? "Reading..." : "Check it"}
            </button>
          )}

          {/* The primary action is whatever comes next. Saving outranks
              checking: unsaved text is the state most likely to be lost. */}
          {dirty ? (
            <button
              type="button"
              onClick={save}
              disabled={isSaving}
              className={buttonClass("primary", "sm")}
            >
              {isSaving ? "Saving..." : "Save changes"}
            </button>
          ) : review && fixable.length > 0 ? (
            <button
              type="button"
              onClick={() => refine(fixable.map((f, i) => `${i + 1}. ${f.fix}`).join("\n"), "all")}
              disabled={isRefining}
              className={buttonClass("primary", "sm")}
            >
              {running === "all" ? "Rewriting..." : `Fix ${fixable.length}`}
            </button>
          ) : (
            <button
              type="button"
              onClick={runReview}
              disabled={isReviewing || !content.trim()}
              className={buttonClass("primary", "sm")}
            >
              {isReviewing ? `${modelLabel(reviewerFor(writtenBy))} is reading...` : review ? "Check again" : "Check it"}
            </button>
          )}

          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-[var(--tx-2)] transition hover:text-[var(--tx)]"
            aria-expanded={showMore}
          >
            {showMore ? "Less" : "More"}
          </button>
        </div>
      </div>

      {review && review.findings.length > 0 && (
        <div className="mt-3 space-y-3">
          {unverified && (
            <p className="text-[11px] leading-relaxed text-[var(--tx-3)]">
              A fix has been applied since this list was made, so these describe text that has moved. Still worth
              working through; check again when you are done.
            </p>
          )}
          {fixable.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">
                Can be fixed from what you already have
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {fixable.map((f, i) => (
                  <li key={i} className="rounded border border-line bg-[var(--surface)] p-2">
                    <p className="text-xs leading-relaxed text-[var(--tx-2)]">
                      <span
                        className={`mr-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                          f.severity === "blocking" ? "text-[var(--amber)]" : "text-[var(--tx-3)]"
                        }`}
                      >
                        {SEVERITY_LABEL[f.severity] ?? f.severity}
                      </span>
                      {f.what}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={isRefining}
                        onClick={() => refine(f.fix, `f${i}`, f)}
                        className="rounded border border-accent px-2 py-0.5 text-[11px] text-accent hover:bg-accent-light disabled:opacity-40"
                      >
                        {running === `f${i}` ? "Fixing..." : "Fix this one"}
                      </button>
                      <span className="flex-1 text-[11px] italic leading-relaxed text-[var(--tx-3)]">{f.fix}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* The half that must never be automated.
              A fix that needs a figure Dan does not have is the exact point
              where a rewriter would invent one, and he has said plainly that
              he has no numbers beyond his verified list. So these are kept out
              of "Fix N" structurally, not by asking the model nicely. */}
          {needsHim.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">
                Needs something only you know
              </p>
              <ul className="mt-1.5 space-y-1.5">
                {needsHim.map((f, i) => {
                  const key = `q${i}`;
                  if (dismissed.includes(f.question)) return null;
                  return (
                    <li key={i} className="rounded border border-amber-line bg-[var(--amber-dim)] p-2">
                      <p className="text-xs leading-relaxed text-[var(--tx-2)]">{f.what}</p>
                      <p className="mt-1 text-xs font-medium leading-relaxed text-[var(--tx)]">{f.question}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <input
                          value={answers[key] ?? ""}
                          onChange={(e) => setAnswers((a) => ({ ...a, [key]: e.target.value }))}
                          placeholder="Answer, and it goes in"
                          className="min-w-[14rem] flex-1 rounded border border-line-2 bg-[var(--surface)] px-2 py-1 text-[11.5px]"
                        />
                        <button
                          type="button"
                          disabled={isRefining || !(answers[key] ?? "").trim()}
                          onClick={() =>
                            refine(
                              `${f.fix}\n\nTheir answer, use exactly this and add nothing to it: ${answers[key].trim()}`,
                              key,
                              f
                            )
                          }
                          className="rounded border border-accent px-2 py-0.5 text-[11px] text-accent hover:bg-accent-light disabled:opacity-40"
                        >
                          {running === key ? "Adding..." : "Add it"}
                        </button>
                        {/* Says it once and stops asking. Without this the same
                            question about a figure he does not have comes back
                            on every run for the life of the application. */}
                        <button
                          type="button"
                          onClick={() => setDismissed((d) => [...d, f.question])}
                          className="text-[11px] text-[var(--tx-3)] hover:text-[var(--tx)] hover:underline"
                        >
                          I don&apos;t have that
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}

      {review && review.findings.length === 0 && (
        <p className={EMPTY_INLINE}>
          {unverified
            ? "Every finding has been fixed. None of it is verified yet - check again to confirm the fixes landed and nothing new was introduced."
            : `${modelLabel(review.reviewedBy)} found nothing. It is asked not to pad the list, and an empty result is confirmed with a second pass before it is shown.`}
        </p>
      )}

      {staleAfterRefine && !review && (
        <p className="mt-2 text-xs text-[var(--tx-3)]">
          Rewritten. A refine does not always apply every fix it is given, so check again before trusting it.
        </p>
      )}

      {error && <p className={ERROR_TEXT}>{error}</p>}

      {/* Everything below is occasional: reading the text, downloading it,
          Drive, an instruction of your own, versions, deleting. It used to all
          be on screen at once, competing with the thing you actually came to
          do. */}
      {showMore && (
        <div className="mt-3 space-y-3 border-t border-line pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-md border border-line p-0.5 text-xs">
              {(["edit", "preview"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded px-2.5 py-1 capitalize transition-colors ${
                    tab === t ? "bg-accent text-white" : "text-[var(--tx-3)] hover:text-accent"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <DocumentPreview
              documentId={documentId}
              driveFileIdDocx={driveFileIdDocx}
              hasContent={Boolean(initialContent.trim())}
            />
          </div>

          {tab === "edit" ? (
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={20}
              spellCheck
              className="w-full rounded border border-line-2 p-3 font-mono text-xs leading-relaxed"
            />
          ) : (
            <div className="max-h-[32rem] overflow-y-auto rounded border border-line bg-[var(--surface)] p-4">
              {lines.map((line, i) =>
                line.kind === "heading" ? (
                  <h4 key={i} className="pt-3 text-sm font-semibold text-[var(--tx)] first:pt-0">
                    {line.text}
                  </h4>
                ) : line.kind === "scope" ? (
                  <p key={i} className="mt-0.5 text-xs leading-relaxed text-[var(--tx-3)]">{line.text}</p>
                ) : line.kind === "bullet" ? (
                  <p key={i} className="flex gap-2 pl-1 text-sm leading-relaxed text-[var(--tx-2)]">
                    <span aria-hidden className="text-[var(--tx-3)]">
                      •
                    </span>
                    <span>{line.text}</span>
                  </p>
                ) : (
                  <p key={i} className="mt-1.5 text-sm leading-relaxed text-[var(--tx-2)]">
                    {line.text}
                  </p>
                )
              )}
            </div>
          )}

          <div className="rounded-md bg-[var(--surface-2)] p-2.5">
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={instruction.includes("\n") ? 4 : 1}
              placeholder="Change something specific"
              className="w-full resize-y rounded border border-line-2 px-2 py-1.5 text-xs"
            />
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => refine()}
                disabled={isRefining || !instruction.trim()}
                className="rounded border border-accent px-2.5 py-1 text-xs text-accent hover:bg-accent-light disabled:opacity-40"
              >
                {running === "box" ? "Rewriting..." : "Rewrite with this"}
              </button>
              <ModelSelect value={model} onChange={setModel} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <a
              href={`/api/documents/${documentId}?format=docx`}
              className="rounded border border-line-2 px-2.5 py-1 hover:bg-[var(--surface-2)]"
            >
              .docx
            </a>
            <a
              href={`/api/documents/${documentId}?format=pdf`}
              className="rounded border border-line-2 px-2.5 py-1 hover:bg-[var(--surface-2)]"
            >
              .pdf
            </a>
            {drive.docx || drive.pdf ? (
              <span className="flex items-center gap-2 text-[var(--tx-3)]">
                <span>Drive:</span>
                {drive.docx && (
                  <a href={drive.docx} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    docx
                  </a>
                )}
                {drive.pdf && (
                  <a href={drive.pdf} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                    pdf
                  </a>
                )}
                <button
                  type="button"
                  onClick={saveToDrive}
                  disabled={isSavingToDrive}
                  className="text-[var(--tx-3)] hover:text-accent hover:underline disabled:opacity-40"
                >
                  {isSavingToDrive ? "Updating..." : "Update"}
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={saveToDrive}
                disabled={isSavingToDrive}
                className={buttonClass("outline", "sm")}
              >
                {isSavingToDrive ? "Saving..." : "Save to Drive"}
              </button>
            )}
            <span className="ml-auto">
              <ConfirmButton
                label="Delete"
                question="Delete this document and every earlier version of it?"
                confirmLabel="Delete it"
                action={deleteDocument.bind(null, documentId, applicationId)}
                pendingLabel="Deleting..."
              />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
