"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModelSelect } from "@/components/ModelSelect";
import { ERROR_TEXT } from "@/lib/type";

/**
 * Paste a posting, get a tracked and evaluated application.
 *
 * The two calls are sequenced on the client rather than chained on the server
 * so the stage is real: each label corresponds to a request that is genuinely
 * in flight. This is a 40-60 second operation and it previously showed one
 * static "Reading posting..." for all of it, then landed on a page with no
 * evaluation - which read as nothing having happened.
 */
type Stage = "idle" | "reading" | "evaluating" | "done";

const STAGE_TEXT: Record<Stage, string> = {
  idle: "Add & evaluate",
  reading: "Reading the posting...",
  evaluating: "Evaluating the fit...",
  done: "Opening it...",
};

export function QuickAddForm() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [isPending, startTransition] = useTransition();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    startTransition(async () => {
      setStage("reading");
      const res = await fetch("/api/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobDescription: text, model: model || undefined }),
      });
      const resBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStage("idle");
        setError(resBody.error ?? "Couldn't read that posting.");
        return;
      }

      // The application exists from here on. If evaluation fails the record is
      // still kept and the page shows an Evaluate button, so a failure here
      // costs the evaluation and not the paste.
      setStage("evaluating");
      const evaluated = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: resBody.applicationId, model: model || undefined }),
      })
        .then((r) => r.ok)
        .catch(() => false);
      if (!evaluated) setError("Added it, but the evaluation did not run. Open the role and run it again.");

      setStage("done");
      router.push(`/applications/${resBody.applicationId}`);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Paste the full job posting here..."
        rows={10}
        className="w-full rounded-lg border border-line p-3 text-sm"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={!text.trim() || isPending}
          className="rounded-lg bg-[var(--tx)] px-4 py-2 text-sm font-semibold text-[var(--bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {STAGE_TEXT[isPending ? stage : "idle"]}
        </button>
        <ModelSelect value={model} onChange={setModel} />
      </div>

      {isPending ? (
        <div className="flex items-center gap-2.5 text-xs text-[var(--tx-3)]">
          <span className="pulse" aria-hidden />
          <span>
            {stage === "reading"
              ? "Claude is reading the company and role out of the posting."
              : stage === "evaluating"
                ? "Scoring it against your positioning and evaluation framework. This is the slow part."
                : "Done."}
          </span>
        </div>
      ) : (
        <p className="text-xs text-[var(--tx-3)]">
          Claude reads the company and role, creates the application, saves the posting, and evaluates the fit. Takes
          about a minute.
        </p>
      )}

      {error && <p className={ERROR_TEXT}>{error}</p>}
    </form>
  );
}
