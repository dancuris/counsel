"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/lib/button";
import { EMPTY_INLINE, ERROR_BLOCK } from "@/lib/type";

type Candidate = {
  jobId: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  score: number;
  exact: boolean;
  closed: boolean;
};

/**
 * Finds the LinkedIn posting behind a role that is already tracked.
 *
 * It suggests rather than decides. Searching one real JPMorgan role returned
 * four different jobs at the same employer ranked above the right one, and a
 * wrong job description is invisible once attached: it produces a confident,
 * correctly formatted resume for a role nobody read. So the list is shown, the
 * best guess is marked, and the choice is a click.
 */
export function LinkedInMatch({ applicationId, hasJd }: { applicationId: string; hasJd: boolean }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "searching" | "picking" | "attaching">("idle");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function search() {
    setError(null);
    setDone(null);
    setState("searching");
    try {
      const res = await fetch(`/api/linkedin/search?applicationId=${applicationId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Search failed.");
      setCandidates(data.candidates ?? []);
      setSuggested(data.suggested ?? null);
      setState("picking");
    } catch (e) {
      setError((e as Error).message);
      setState("idle");
    }
  }

  async function attach(jobId: string) {
    setError(null);
    setState("attaching");
    try {
      const res = await fetch("/api/linkedin/attach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, jobId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not attach that posting.");
      setDone(
        `Job description attached${data.source === "ats" ? " from the employer's own site" : ""}.` +
          (data.closed ? " Note: LinkedIn says it is no longer accepting applications." : "")
      );
      setState("idle");
      setCandidates([]);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setState("picking");
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={search}
        disabled={state === "searching" || state === "attaching"}
        className={buttonClass("outline", "sm")}
      >
        {state === "searching" ? "Searching LinkedIn..." : hasJd ? "Search LinkedIn again" : "Search LinkedIn for this job"}
      </button>

      {done && <p className="mt-1.5 text-[11.5px] text-[var(--mint)]">{done}</p>}
      {error && <p className={ERROR_BLOCK}>{error}</p>}

      {(state === "picking" || state === "attaching") && (
        <div className="mt-2 rounded-xl border border-line bg-[var(--surface-2)] p-2.5">
          {candidates.length === 0 ? (
            <p className={EMPTY_INLINE}>
              Nothing came back. The posting has probably closed - paste the description instead.
            </p>
          ) : (
            <>
              <p className="text-[11.5px] text-[var(--tx-3)]">
                {suggested ? "Best guess is marked. Check it before attaching." : "No confident match - read carefully."}
              </p>
              <ul className="mt-1.5 space-y-1">
                {candidates.map((c) => (
                  <li key={c.jobId}>
                    <div
                      className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border px-2.5 py-1.5 ${
                        c.jobId === suggested ? "border-amber-line bg-[var(--amber-dim)]" : "border-line bg-[var(--surface)]"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-[var(--tx)]">{c.title}</span>
                        <span className="block truncate text-[11px] text-[var(--tx-3)]">
                          {c.company}
                          {c.location ? ` · ${c.location}` : ""} · {Math.round(c.score * 100)}% match
                          {c.exact ? " · exact title" : ""}
                          {c.closed ? " · no longer accepting applications" : ""}
                        </span>
                      </span>
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 text-[11px] text-[var(--tx-3)] underline hover:text-[var(--tx)]"
                      >
                        open
                      </a>
                      <button
                        type="button"
                        onClick={() => attach(c.jobId)}
                        disabled={state === "attaching"}
                        className={buttonClass("primary", "sm", "shrink-0")}
                      >
                        {state === "attaching" ? "..." : "Use this"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => setState("idle")}
                className="mt-2 text-[11px] text-[var(--tx-3)] hover:text-[var(--tx)]"
              >
                None of these
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
