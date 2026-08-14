"use client";

import { useState } from "react";
import { buttonClass } from "@/lib/button";
import { ERROR_BLOCK } from "@/lib/type";

type Report = {
  patterns: { pattern: string; evidence: string; soWhat: string }[];
  caveat: string;
  counts: { reached: number; didNot: number };
};

/**
 * The content half of the retrospective.
 *
 * The table above it counts things - how many roles had a tailored resume, how
 * many were evaluated first. That can show a correlation but not a cause. The
 * reason seventeen roles never replied is in the gap statements the evaluations
 * already wrote and nobody ever read back.
 *
 * Behind a button because it is a model call over the whole archive. A page
 * that quietly spends money whenever it is opened is a page you stop opening.
 */
export function PatternAnalysis() {
  const [state, setState] = useState<"idle" | "running">("idle");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setState("running");
    try {
      const res = await fetch("/api/retrospective", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not run the analysis.");
      setReport(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setState("idle");
    }
  }

  return (
    <section className="panel mt-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-[13px] font-semibold">What the rejections have in common</h2>
          <p className="mt-0.5 text-[11.5px] text-[var(--tx-3)]">
            Reads every gap the evaluations recorded and looks for what repeats in the roles that never replied.
          </p>
        </div>
        <button
          type="button"
          onClick={run}
          disabled={state === "running"}
          className={buttonClass("primary", "sm")}
        >
          {state === "running" ? "Reading the archive..." : report ? "Run again" : "Look for patterns"}
        </button>
      </div>

      {error && <p className={ERROR_BLOCK}>{error}</p>}

      {report && (
        <div className="mt-3 space-y-3">
          <p className="text-[11.5px] text-[var(--tx-3)]">
            Across {report.counts.reached} that reached a conversation and {report.counts.didNot} that did not.
          </p>
          {report.patterns.map((p, i) => (
            <div key={i} className="rounded-xl border border-line bg-[var(--surface-2)] p-3">
              <p className="text-[13px] font-medium text-[var(--tx)]">{p.pattern}</p>
              <p className="mt-1.5 text-[12px] text-[var(--tx-3)]">{p.evidence}</p>
              <p className="mt-1.5 text-[12.5px] text-[var(--tx-2)]">
                <b className="font-semibold text-[var(--tx)]">Do:</b> {p.soWhat}
              </p>
            </div>
          ))}
          {report.caveat && (
            <p className="rounded-xl border border-amber-line bg-[var(--amber-dim)] p-3 text-[12px] text-[var(--tx-2)]">
              {report.caveat}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
