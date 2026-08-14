"use client";

import { useState } from "react";
import { ERROR_TEXT } from "@/lib/type";

/**
 * A labelled value with a copy button, sized for a form field.
 *
 * Built for the Workday page, where the unit of work is one field: their form
 * has a separate input for job title, employer, city, start month and end
 * month, so "copy the whole role" would help with none of it. The button is
 * the label's own row rather than a separate column, so a long description and
 * a five-character date read as the same kind of thing.
 *
 * The button states rather than toasts. A toast for something you will do
 * twenty times in one sitting is twenty interruptions.
 */
/**
 * The whole chip is the button.
 *
 * Workday adds skills one at a time, so a list of twenty is twenty separate
 * paste operations and a separate Copy control beside each one would double
 * the things on screen for no gain. Clicking the word copies the word.
 */
export function CopyChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          // Selecting the text still works, and the chip is the text.
        }
      }}
      className={`rounded-full border px-2.5 py-1 text-[12px] transition-colors ${
        copied
          ? "border-transparent bg-[var(--mint)] text-white"
          : "border-line bg-[var(--surface-2)] text-[var(--tx-2)] hover:border-line-2"
      }`}
    >
      {copied ? "Copied" : value}
    </button>
  );
}

export function CopyField({
  label,
  value,
  hint,
  multiline = false,
}: {
  label: string;
  value: string;
  hint?: string;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const empty = !value.trim();

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard access can be refused. Say so rather than looking like it
      // worked: a silently empty paste into a job application is expensive.
      setFailed(true);
    }
  }

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--tx-3)]">{label}</p>
        {!empty && (
          <button
            type="button"
            onClick={() => void copy()}
            className={`shrink-0 text-[11px] font-medium ${copied ? "text-[var(--mint)]" : "text-accent hover:underline"}`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>

      {empty ? (
        // Named, not hidden. A blank box on the page is a prompt to type
        // something into Workday by hand; a missing box is a field forgotten.
        <p className="mt-0.5 text-[13px] italic text-[var(--tx-3)]">Not in the resume. Fill this in by hand.</p>
      ) : multiline ? (
        <pre className="mt-0.5 whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-[var(--tx)]">
          {value}
        </pre>
      ) : (
        <p className="mt-0.5 break-words text-[13px] text-[var(--tx)]">{value}</p>
      )}

      {hint && <p className="mt-0.5 text-[11px] text-[var(--tx-3)]">{hint}</p>}
      {failed && <p className={ERROR_TEXT}>Could not reach the clipboard. Select the text and copy it.</p>}
    </div>
  );
}
