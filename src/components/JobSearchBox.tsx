"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ERROR_TEXT } from "@/lib/type";

type Posting = { title: string; location: string; url: string; reqId?: string; postedOn?: string };

export function JobSearchBox() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [result, setResult] = useState<{
    company: string;
    roleTitle: string;
    board: { provider: string } | null;
    postings: Posting[];
    description: string | null;
    descriptionFor: string | null;
    careersUrl: string | null;
    message: string | null;
    scanned?: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();
  const [addStage, setAddStage] = useState<"idle" | "creating" | "evaluating">("idle");

  function search() {
    if (!text.trim()) return;
    setError(null);
    setResult(null);
    startSearch(async () => {
      const res = await fetch("/api/job-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't search.");
        return;
      }
      setResult(data);
    });
  }

  function track(p: Posting) {
    if (!result) return;
    startAdd(async () => {
      setAddStage("creating");
      const description = p.url === result.descriptionFor ? result.description : null;
      const res = await fetch("/api/job-search", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: result.company, roleTitle: p.title, url: p.url, description }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.applicationId) {
        setError(data.error ?? "Could not add that role.");
        setAddStage("idle");
        return;
      }
      // Only worth evaluating when there is a description to evaluate against.
      // Scoring a bare title produces a confident verdict from nothing.
      if (description && !data.duplicate) {
        setAddStage("evaluating");
        const evaluated = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationId: data.applicationId }),
        })
          .then((r) => r.ok)
          .catch(() => false);
        if (!evaluated) setError("Added it, but the evaluation did not run. Open the role and run it again.");
      }
      router.push(`/applications/${data.applicationId}`);
    });
  }

  return (
    // No panel of its own. It now sits inside the "Track a role" panel on the
    // home page, and a white card on a white card reads as a box in a box.
    // The disclosure above it is the separation this needs.
    <section className="rounded-lg border border-line bg-[var(--surface-2)] p-4">
      <h2 className="text-[13.5px] font-semibold">Find a posting</h2>
      <p className="mt-1 text-[12px] text-[var(--tx-3)]">
        Paste what LinkedIn showed you. Counsel looks it up on the employer&apos;s own board and brings back the full
        description.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              search();
            }
          }}
          rows={2}
          placeholder="Paste a job title and company from LinkedIn"
          className="min-w-[220px] flex-1 rounded-lg border border-line px-3 py-2 text-[13px]"
        />
        <button
          type="button"
          onClick={search}
          disabled={!text.trim() || searching}
          className="h-fit rounded-lg bg-[var(--tx)] px-4 py-2.5 text-[13px] font-semibold text-[var(--bg)] transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {searching ? "Looking..." : "Find it"}
        </button>
      </div>

      {error && <p className={ERROR_TEXT}>{error}</p>}

      {(searching || adding) && (
        <div className="mt-2 flex items-center gap-2.5 text-[12px] text-[var(--tx-3)]">
          <span className="pulse" aria-hidden />
          <span>
            {searching
              ? "Working out the employer, finding their job board, then pulling the description. Up to a minute the first time for a company."
              : addStage === "evaluating"
                ? "Saved. Now scoring it against your positioning."
                : "Creating the application."}
          </span>
        </div>
      )}

      {result && (
        <div className="mt-3">
          <p className="text-[12px] text-[var(--tx-3)]">
            Read as <b className="font-medium text-[var(--tx-2)]">{result.roleTitle}</b> at{" "}
            <b className="font-medium text-[var(--tx-2)]">{result.company}</b>
            {result.board ? ` · searched their ${result.board.provider} board` : ""}
            {result.scanned ? ` (${result.scanned} postings)` : ""}
          </p>

          {result.message && (
            <p className="mt-1.5 text-[12px] text-[var(--tx-3)]">
              {result.message}
              {result.careersUrl && (
                <>
                  {" "}
                  <a href={result.careersUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-[var(--tx)]">
                    Open careers site →
                  </a>
                </>
              )}
            </p>
          )}

          {result.postings.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {result.postings.map((p) => (
                <li
                  key={p.url}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-[var(--surface-2)] px-3 py-2"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{p.title}</span>
                    <span className="block truncate text-[11.5px] text-[var(--tx-3)]">
                      {p.location}
                      {p.reqId ? ` · ${p.reqId}` : ""}
                      {p.postedOn ? ` · ${p.postedOn}` : ""}
                      {p.url === result.descriptionFor && result.description
                        ? ` · JD ready (${result.description.split(/\s+/).length} words)`
                        : ""}
                    </span>
                  </span>
                  <span className="flex flex-none gap-1.5">
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-line-2 px-2.5 py-1 text-[11.5px] transition-colors hover:bg-[var(--surface)]"
                    >
                      Open
                    </a>
                    <button
                      type="button"
                      onClick={() => track(p)}
                      disabled={adding}
                      className="rounded-lg bg-[var(--amber)] px-2.5 py-1 text-[11.5px] font-semibold text-white disabled:opacity-40"
                    >
                      {adding
                        ? addStage === "evaluating"
                          ? "Evaluating..."
                          : "Adding..."
                        : "Track it"}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {result.description && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[12px] text-[var(--tx-3)] hover:text-[var(--tx)]">
                Preview the description
              </summary>
              <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-[var(--surface-2)] p-3 text-[12px] leading-relaxed">
                {result.description}
              </pre>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
