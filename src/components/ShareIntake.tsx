"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { buttonClass } from "@/lib/button";
import { ERROR_TEXT } from "@/lib/type";

/**
 * Runs the whole intake on a link that arrived from a share sheet.
 *
 * The same three stages the paste box runs, for the same reason: if the app
 * can tell what the next step is, it should take it. Somebody who just shared
 * a job into Counsel does not then want to press Track, read a verdict, and
 * press Generate.
 *
 * It starts on its own. A share sheet is already an explicit act of intent, so
 * asking for a second confirmation on arrival would be ceremony. The one guard
 * is `started`, because React runs effects twice in development and a double
 * intake would create the role twice.
 */
export function ShareIntake({ url }: { url: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [phase, setPhase] = useState<"reading" | "evaluating" | "drafting" | "done" | "error">("reading");
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    (async () => {
      try {
        const res = await fetch("/api/linkedin/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not read that posting.");

        if (data.alreadyTracked) {
          setNote(`Already tracked: ${data.company} - ${data.roleTitle}`);
          setPhase("done");
          router.push(`/applications/${data.applicationId}`);
          return;
        }

        setNote(`${data.company} - ${data.roleTitle}`);

        if (data.hasDescription) {
          setPhase("evaluating");
          const verdict = await fetch("/api/evaluate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ applicationId: data.applicationId }),
          })
            .then(async (r) => (r.ok ? ((await r.json())?.evaluation?.recommendation as string | undefined) : null))
            .catch(() => null);

          // A pass stops here and spends nothing on documents for a role
          // nobody will apply to, exactly as the paste box does.
          if (!verdict) {
            setNote("Tracked it, but the evaluation did not run. Open the role and try again.");
          } else if (verdict !== "pass") {
            setPhase("drafting");
            // Checked, because a swallowed failure here looks exactly like
            // success: the role is tracked and evaluated either way, and the
            // missing documents are only noticed when he goes to apply.
            const drafted = await fetch("/api/generate-documents", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ applicationId: data.applicationId }),
            })
              .then((r) => r.ok)
              .catch(() => false);
            if (!drafted) setNote("Tracked and evaluated. The documents did not draft; generate them from the role.");
          }
        }

        setPhase("done");
        router.push(`/applications/${data.applicationId}`);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
        setPhase("error");
      }
    })();
  }, [url, router]);

  const label = {
    reading: "Reading the posting...",
    evaluating: "Evaluating the fit...",
    drafting: "Drafting your resume and cover letter...",
    done: "Done. Opening the role...",
    error: "That did not work.",
  }[phase];

  return (
    <div>
      <p className="text-[13px] font-medium text-[var(--tx)]">{label}</p>
      {note && <p className="mt-1 text-[12.5px] text-[var(--tx-2)]">{note}</p>}
      {/* The link is shown because a share sheet can hand over something other
          than what you meant to share, and a wrong URL is otherwise invisible
          until the wrong role appears. */}
      <p className="mt-2 break-all text-[11.5px] text-[var(--tx-3)]">{url}</p>

      {error && (
        <div className="mt-3">
          <p className={ERROR_TEXT}>{error}</p>
          <Link href="/" className={buttonClass("primary", "md", "mt-3 inline-block")}>
            Back to Today
          </Link>
        </div>
      )}
    </div>
  );
}
