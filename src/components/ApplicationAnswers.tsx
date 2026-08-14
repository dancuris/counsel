"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/lib/button";
import { ERROR_BLOCK } from "@/lib/type";

export type SavedAnswer = { id: string; question: string; answer: string; createdAt: string };

/**
 * The boxes an employer's form adds beyond the resume.
 *
 * "In a brief statement, please explain why you are an ideal fit for our
 * company" is not something the resume or the cover letter answers, and it
 * arrives when Dan is already inside the portal with the application half
 * finished. The output is text he pastes into their box, so the primary control
 * is Copy, not Save.
 *
 * They are kept because the same questions recur across employers, because a
 * form can time out and lose what was typed, and because what he told one
 * company is worth having when the next one asks something similar.
 */
export function ApplicationAnswers({
  applicationId,
  saved,
  save,
  remove,
}: {
  applicationId: string;
  saved: SavedAnswer[];
  save: (formData: FormData) => Promise<void>;
  remove: (answerId: string) => Promise<void>;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [words, setWords] = useState(150);
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [removing, startRemove] = useTransition();

  async function draft() {
    if (!question.trim() || drafting) return;
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch(`/api/applications/${applicationId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, words }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Draft failed with ${res.status}.`);
      setAnswer(data.answer);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDrafting(false);
    }
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Could not reach the clipboard. Select the text and copy it.");
    }
  }

  return (
    <div>
      <p className="text-[12.5px] text-[var(--tx-3)]">
        Paste a question from their application form. The answer is grounded in this role&apos;s job description and your
        profile, and written to go straight into their box.
      </p>

      <textarea
        value={question}
        onChange={(e) => setQuestion(e.target.value)}
        rows={2}
        placeholder="In a brief statement, please explain why you are an ideal fit for our company"
        className="mt-2.5 w-full rounded-lg border border-line bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--tx)]"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!question.trim() || drafting}
          onClick={() => void draft()}
          className={buttonClass("primary", "md")}
        >
          {drafting ? "Writing..." : "Draft the answer"}
        </button>
        <label className="flex items-center gap-1.5 text-[11.5px] text-[var(--tx-3)]">
          Limit
          <select
            value={words}
            onChange={(e) => setWords(Number(e.target.value))}
            className="rounded-md border border-line bg-[var(--surface-2)] px-1.5 py-1 text-[11.5px] text-[var(--tx-2)]"
          >
            {[75, 100, 150, 250, 400].map((w) => (
              <option key={w} value={w}>
                {w} words
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <p className={ERROR_BLOCK}>{error}</p>}

      {answer && (
        <div className="mt-3 rounded-lg border border-line bg-[var(--surface-2)] p-3">
          {/* Editable before it goes anywhere. The draft is a starting point and
              the form is the thing that matters. */}
          <textarea
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            rows={8}
            className="w-full resize-y rounded-md border border-line bg-[var(--surface)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--tx)]"
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void copy(answer, "draft")}
              className={buttonClass("primary", "sm")}
            >
              {copied === "draft" ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() =>
                startSave(async () => {
                  const fd = new FormData();
                  fd.set("question", question);
                  fd.set("answer", answer);
                  await save(fd);
                  setQuestion("");
                  setAnswer("");
                  router.refresh();
                })
              }
              className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-[var(--tx-2)] transition hover:text-[var(--tx)] disabled:opacity-40"
            >
              {saving ? "Keeping..." : "Keep it"}
            </button>
            <span className="text-[11px] text-[var(--tx-3)]">{answer.trim().split(/\s+/).length} words</span>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <ul className="mt-4 divide-y divide-[var(--line)] border-t border-line">
          {saved.map((a) => (
            <li key={a.id} className="py-3">
              <p className="text-[12px] font-medium text-[var(--tx-2)]">{a.question}</p>
              <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--tx-2)]">{a.answer}</p>
              <div className="mt-1.5 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void copy(a.answer, a.id)}
                  className="text-[11.5px] text-[var(--tx-3)] transition hover:text-[var(--tx)]"
                >
                  {copied === a.id ? "Copied" : "Copy"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuestion(a.question);
                    setAnswer(a.answer);
                  }}
                  className="text-[11.5px] text-[var(--tx-3)] transition hover:text-[var(--tx)]"
                >
                  Reuse
                </button>
                <button
                  type="button"
                  disabled={removing}
                  onClick={() =>
                    startRemove(async () => {
                      await remove(a.id);
                      router.refresh();
                    })
                  }
                  className="text-[11.5px] text-[var(--tx-3)] transition hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
