"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModelSelect } from "@/components/ModelSelect";
import { buttonClass } from "@/lib/button";
import { ERROR_TEXT } from "@/lib/type";

export function GenerateDocumentsButton({
  applicationId,
  hasJobDescription,
  addressLabels,
  emailLabels,
  defaultModelLabel,
}: {
  /** Short name of the model this runs on with no override. */
  defaultModelLabel?: string;
  applicationId: string;
  hasJobDescription: boolean;
  addressLabels: string[];
  emailLabels: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [atsSafe, setAtsSafe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState("");
  // Which address and email go on this specific document. A role in Atlanta
  // should not carry the Connecticut address.
  const [addressLabel, setAddressLabel] = useState("");
  const [emailLabel, setEmailLabel] = useState("");

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await fetch("/api/generate-documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          atsSafe,
          model: model || undefined,
          addressLabel: addressLabel || undefined,
          emailLabel: emailLabel || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Generation failed.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div>
      <label className="mb-2 flex items-center gap-2 text-xs text-[var(--tx-3)]">
        <input type="checkbox" checked={atsSafe} onChange={(e) => setAtsSafe(e.target.checked)} />
        ATS-safe formatting (plain paragraphs, no lists/borders)
      </label>
      {(addressLabels.length > 1 || emailLabels.length > 1) && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {addressLabels.length > 1 && (
            <select
              value={addressLabel}
              onChange={(e) => setAddressLabel(e.target.value)}
              className="rounded border border-line-2 px-2 py-1 text-xs"
            >
              <option value="">Default address</option>
              {addressLabels.map((l) => (
                <option key={l} value={l}>
                  {l} address
                </option>
              ))}
            </select>
          )}
          {emailLabels.length > 1 && (
            <select
              value={emailLabel}
              onChange={(e) => setEmailLabel(e.target.value)}
              className="rounded border border-line-2 px-2 py-1 text-xs"
            >
              <option value="">Default email</option>
              {emailLabels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClick}
          disabled={!hasJobDescription || isPending}
          className={buttonClass("primary", "md")}
        >
          {isPending ? "Generating..." : "Generate resume + cover letter"}
        </button>
        <ModelSelect value={model} onChange={setModel} defaultLabel={defaultModelLabel} />
      </div>
      {!hasJobDescription && <p className="mt-1 text-xs text-[var(--tx-3)]">Save a job description first.</p>}
      {error && <p className={ERROR_TEXT}>{error}</p>}
    </div>
  );
}
