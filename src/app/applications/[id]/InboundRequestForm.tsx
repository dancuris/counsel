"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModelSelect } from "@/components/ModelSelect";
import { buttonClass } from "@/lib/button";
import { ERROR_TEXT } from "@/lib/type";

type Result = {
  summary: string;
  deadline: string;
  wantsDocument: boolean;
  targetPages: number;
};

export function InboundRequestForm({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [emailText, setEmailText] = useState("");
  const [model, setModel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit() {
    setError(null);
    setResult(null);
    startTransition(async () => {
      const res = await fetch("/api/inbound-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, emailText, model: model || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't process that email.");
        return;
      }
      setResult(data);
      setEmailText("");
      router.refresh();
    });
  }

  return (
    <div>
      <textarea
        value={emailText}
        onChange={(e) => setEmailText(e.target.value)}
        placeholder="Paste an email you received - a recruiter's questions, a request for materials, next steps..."
        rows={5}
        className="w-full rounded border border-line-2 p-2 text-sm"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!emailText.trim() || isPending}
          className={buttonClass("primary", "md")}
        >
          {isPending ? "Reading it..." : "Log it and draft a reply"}
        </button>
        <ModelSelect value={model} onChange={setModel} />
      </div>
      <p className="mt-1.5 text-xs text-[var(--tx-3)]">
        Logs the email under Correspondence, adds a follow-up, and if they asked for written answers, drafts the
        document under Documents where you can edit it.
      </p>

      {isPending && <p className="mt-1.5 text-xs text-[var(--tx-3)]">Drafting a full document takes a minute.</p>}

      {result && (
        <div className="mt-2 rounded-md border border-green-200 bg-green-50 p-2.5 text-xs text-green-900">
          <p className="font-medium">{result.summary}</p>
          {result.deadline && <p className="mt-0.5">Deadline noted: {result.deadline}</p>}
          <p className="mt-0.5">
            {result.wantsDocument
              ? `Draft created under Documents${result.targetPages ? ` (target ~${result.targetPages} pages)` : ""}. Edit it there.`
              : "No document needed. Logged with a follow-up."}
          </p>
        </div>
      )}

      {error && <p className={ERROR_TEXT}>{error}</p>}
    </div>
  );
}
