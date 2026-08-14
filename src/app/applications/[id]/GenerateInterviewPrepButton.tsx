"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModelSelect } from "@/components/ModelSelect";
import { buttonClass } from "@/lib/button";
import { ERROR_TEXT } from "@/lib/type";

export function GenerateInterviewPrepButton({
  applicationId,
  hasJobDescription,
  hasExistingPrep,
}: {
  applicationId: string;
  hasJobDescription: boolean;
  hasExistingPrep: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("");

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/generate-interview-prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, model: model || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Prep generation failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onClick}
          disabled={!hasJobDescription || isPending}
          className={buttonClass("primary", "md")}
        >
          {isPending ? "Building prep..." : hasExistingPrep ? "Regenerate prep" : "Build interview prep"}
        </button>
        <ModelSelect value={model} onChange={setModel} />
      </div>
      {isPending && <p className="mt-1.5 text-xs text-[var(--tx-3)]">This one takes a minute. It writes the full package.</p>}
      {!hasJobDescription && <p className="mt-1.5 text-xs text-[var(--tx-3)]">Save a job description first.</p>}
      {error && <p className={ERROR_TEXT}>{error}</p>}
    </div>
  );
}
