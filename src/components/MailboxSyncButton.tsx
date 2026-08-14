"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/constants";
import { buttonClass } from "@/lib/button";
import { ERROR_TEXT } from "@/lib/type";

export function MailboxSyncButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [moves, setMoves] = useState<{ company: string; role: string; from: string; to: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  function sync() {
    setError(null);
    setResult(null);
    setMoves([]);
    startTransition(async () => {
      const res = await fetch("/api/mailbox/sync", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Sync failed.");
        return;
      }
      // Lead first: "0 matched" reads as failure when the sync has actually
      // surfaced an opportunity that is not being tracked yet.
      const parts: string[] = [];
      if (data.leads > 0) parts.push(`${data.leads} need${data.leads === 1 ? "s" : ""} filing`);
      if (data.matched > 0) parts.push(`${data.matched} filed against a role`);
      setMoves(Array.isArray(data.statusChanges) ? data.statusChanges : []);
      setResult(
        data.new === 0
          ? "Nothing new."
          : parts.length
            ? `${data.new} new · ${parts.join(" · ")}`
            : `${data.new} new, none job related.`
      );
      router.refresh();
    });
  }

  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={isPending}
        className={buttonClass("outline", "sm")}
      >
        {isPending ? "Syncing..." : "Sync now"}
      </button>
      {result && <span className="text-xs text-[var(--mint)]">{result}</span>}
      {error && <span className={ERROR_TEXT}>{error}</span>}
      {/* A status the app changed on its own has to be visible, or the pipeline
          moves under you with no explanation. */}
      {moves.length > 0 && (
        <span className="basis-full text-xs text-[var(--tx-2)]">
          {moves.map((m, i) => (
            <span key={i} className="block">
              {m.company} moved to <b className="font-medium">{JOB_STATUS_LABELS[m.to as JobStatus] ?? m.to}</b>
            </span>
          ))}
        </span>
      )}
    </span>
  );
}
