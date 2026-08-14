"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModelSelect } from "@/components/ModelSelect";
import { buttonClass } from "@/lib/button";
import { ERROR_TEXT } from "@/lib/type";

export function EvaluateButton({
  applicationId,
  hasJobDescription,
  defaultModelLabel,
}: {
  /** Short name of the model this runs on with no override. */
  defaultModelLabel?: string;
  applicationId: string;
  hasJobDescription: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("");

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, model: model || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Evaluation failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClick}
          disabled={!hasJobDescription || isPending}
          className={buttonClass("primary", "md")}
        >
          {isPending ? "Evaluating..." : "Evaluate fit"}
        </button>
        <ModelSelect value={model} onChange={setModel} defaultLabel={defaultModelLabel} />
      </div>
      {!hasJobDescription && <p className="mt-1 text-xs text-[var(--tx-3)]">Save a job description first.</p>}
      {error && <p className={ERROR_TEXT}>{error}</p>}
    </div>
  );
}
