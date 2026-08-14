"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { linkedInJobId } from "@/lib/linkedin";
import { buttonClass } from "@/lib/button";
import { ERROR_BLOCK } from "@/lib/type";

/**
 * Paste a LinkedIn job URL and get a tracked, evaluated opportunity.
 *
 * The URL is what Dan actually has in hand when he finds something; pasting the
 * description text is the step that sends him out of the app. Two requests
 * rather than one so the wait is legible - reading the posting is a couple of
 * seconds, evaluating it is much longer, and a single spinner for both looks
 * like a hang.
 *
 * Evaluation failing is not import failing. The role is already tracked with
 * its description by then, so it navigates there regardless and the evaluation
 * can be re-run from the page.
 */
export function LinkedInImport({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [phase, setPhase] = useState<"idle" | "reading" | "evaluating" | "drafting">("idle");
  // A closed posting stops here and asks. Evaluating one costs a model call on
  // a role that cannot be applied to, and that should be a choice rather than
  // something that happens on the way past.
  const [closedRole, setClosedRole] = useState<{ id: string; label: string } | null>(null);
  // A likely duplicate stops and asks rather than creating a second entry: a
  // One role came back as a perfect title match under a slightly different
  // employer name than the pipeline held, and the app made a copy and evaluated it.
  const [maybeDupe, setMaybeDupe] = useState<{
    applicationId: string;
    company: string;
    roleTitle: string;
    status: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const valid = Boolean(linkedInJobId(url));
  const busy = phase !== "idle";

  async function run(force = false) {
    setError(null);
    setNote(null);
    setMaybeDupe(null);
    setPhase("reading");
    try {
      const res = await fetch("/api/linkedin/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, force }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not read that posting.");

      if (data.alreadyTracked) {
        setNote(`Already tracked: ${data.company} - ${data.roleTitle}`);
        router.push(`/applications/${data.applicationId}`);
        return;
      }

      if (data.possibleDuplicate) {
        setMaybeDupe(data.possibleDuplicate);
        setPhase("idle");
        return;
      }

      if (data.closed) {
        setClosedRole({ id: data.applicationId, label: `${data.company} - ${data.roleTitle}` });
        setPhase("idle");
        return;
      }
      setNote(`${data.company} - ${data.roleTitle}${data.source === "ats" ? " (read from the employer's site)" : ""}`);

      if (data.hasDescription) {
        setPhase("evaluating");
        // A swallowed failure here is why a TransUnion role landed with a job
        // description, no evaluation, and no sign anything had gone wrong: the
        // catch hid it and there was no res.ok check at all. The import has
        // already succeeded by this point, so a failure is reported and the
        // navigation still happens - the evaluation can be re-run from the page.
        const verdict = await fetch("/api/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ applicationId: data.applicationId }),
        })
          .then(async (r) => (r.ok ? ((await r.json())?.evaluation?.recommendation as string | undefined) : null))
          .catch(() => null);

        if (!verdict) {
          setError("Tracked it, but the evaluation did not run. Open the role and run it again.");
        } else if (verdict !== "pass") {
          // The app already knows what happens next. A swing or a stretch was
          // always going to need a resume, so it drafts one rather than
          // evaluating, stopping, and asking you to press the button it knew
          // you were going to press. A pass stops here and spends nothing.
          setPhase("drafting");
          setNote(`${data.company} - ${data.roleTitle}: ${verdict}. Drafting your resume and cover letter...`);
          const drafted = await fetch("/api/generate-documents", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ applicationId: data.applicationId }),
          })
            .then((r) => r.ok)
            .catch(() => false);
          if (!drafted) setError("Tracked and evaluated, but the documents did not draft. Generate them from the role.");
        }
      }

      router.push(`/applications/${data.applicationId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setPhase("idle");
    }
  }

  async function evaluateClosed(run: boolean) {
    const target = closedRole;
    setClosedRole(null);
    if (!target) return;
    if (run) {
      setPhase("evaluating");
      const ok = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: target.id }),
      })
        .then((r) => r.ok)
        .catch(() => false);
      if (!ok) setError("The evaluation did not run. Open the role and try again.");
      setPhase("idle");
    }
    router.push(`/applications/${target.id}`);
    router.refresh();
  }

  return (
    <div className={compact ? "" : "panel p-4"}>
      {/*
        Compact used to suppress the heading entirely, which left a bare input
        and a button reading "Track it" on the busiest page in the app - the
        label was written and then hidden on the one surface that uses it. An
        unlabelled box does not say that pasting a link also evaluates the role
        and drafts both documents, which is the whole reason to paste it here
        rather than open the posting in a tab.

        Compact keeps the same two sentences, set smaller, rather than a
        different shorter wording: two versions of one explanation drift.
      */}
      <h2 className={compact ? "text-[13px] font-medium text-[var(--tx-2)]" : "text-sm font-semibold text-[var(--tx)]"}>
        Track a role
      </h2>
      <p className={`mt-0.5 text-[var(--tx-3)] ${compact ? "text-[11.5px]" : "text-xs"}`}>
        Paste a LinkedIn job link. It reads the posting, evaluates the fit, and drafts your resume and cover letter if
        it is worth pursuing. A pass stops after the verdict.
      </p>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && valid && !busy && run()}
          placeholder="https://www.linkedin.com/jobs/view/..."
          className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--tx)]"
        />
        <button
          type="button"
          onClick={() => run()}
          disabled={!valid || busy}
          className={buttonClass("primary", "md")}
        >
          {phase === "reading"
            ? "Reading posting..."
            : phase === "evaluating"
              ? "Evaluating..."
              : phase === "drafting"
                ? "Drafting documents..."
                : "Track it"}
        </button>
      </div>

      {url && !valid && !busy && (
        <p className="mt-1.5 text-[11.5px] text-[var(--tx-3)]">
          Needs a LinkedIn job link, the kind with /jobs/view/ or currentJobId in it.
        </p>
      )}
      {maybeDupe && (
        <div className="mt-2 rounded-xl border border-amber-line bg-[var(--amber-dim)] p-2.5">
          <p className="text-[12.5px] text-[var(--tx)]">
            You may already be tracking this: <b className="font-semibold">{maybeDupe.company}</b> -{" "}
            {maybeDupe.roleTitle} <span className="text-[var(--tx-3)]">({maybeDupe.status.toLowerCase().replace(/_/g, " ")})</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => router.push(`/applications/${maybeDupe.applicationId}`)}
              className={buttonClass("primary", "sm")}
            >
              Same role, open it
            </button>
            <button
              type="button"
              onClick={() => run(true)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-[var(--tx-2)] transition hover:text-[var(--tx)]"
            >
              No, track it separately
            </button>
          </div>
        </div>
      )}

      {closedRole && (
        <div className="mt-2 rounded-xl border border-amber-line bg-[var(--amber-dim)] p-2.5">
          <p className="text-[12.5px] text-[var(--tx)]">
            <b className="font-semibold">{closedRole.label}</b> is no longer accepting applications on LinkedIn.
          </p>
          <p className="mt-0.5 text-[11.5px] text-[var(--tx-3)]">
            It is tracked as passed, with the description saved. Evaluate it anyway?
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => evaluateClosed(true)}
              className={buttonClass("primary", "sm")}
            >
              Evaluate anyway
            </button>
            <button
              type="button"
              onClick={() => evaluateClosed(false)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-[var(--tx-2)] transition hover:text-[var(--tx)]"
            >
              Just track it
            </button>
          </div>
        </div>
      )}

      {note && <p className="mt-1.5 text-[11.5px] text-[var(--mint)]">{note}</p>}
      {error && <p className={ERROR_BLOCK}>{error}</p>}
    </div>
  );
}
