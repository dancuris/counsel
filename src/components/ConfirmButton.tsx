"use client";

import { useEffect, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * A destructive or irreversible action, confirmed in place.
 *
 * Two rules in this codebase were both being broken by the same gap. The app
 * has no native dialogs, because `window.confirm` renders outside the page,
 * cannot be themed, and takes the whole screen on an iPhone - yet two survived
 * on the highest-stakes paths, sending a message and deleting a role. And four
 * deletes had no confirmation at all: correspondence, a contact, a document
 * version and an uploaded file each went in one click with no undo, in an app
 * that stops to confirm sending an email.
 *
 * Confirming inline is what makes the difference worth having. The row is
 * still on screen while you decide, so the recipient, the filename or the
 * person's name is visible at the moment of the decision - which is precisely
 * what a modal covering the page destroys.
 *
 * Two shapes, because the callers differ: `action` for a server action, which
 * gets a real form and a pending state, and `onConfirm` for the send path,
 * which is a fetch with its own progress handling.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel = "Yes, do it",
  action,
  onConfirm,
  className,
  pendingLabel,
  disabled,
}: {
  /** Resting label. */
  label: string;
  /** Shown while armed. Name the specific thing: who, or which file. */
  question: string;
  confirmLabel?: string;
  /** A server action. Gets a form and a pending state. */
  action?: (formData: FormData) => Promise<void> | void;
  /** For callers that are not a form, such as the fetch-based send. */
  onConfirm?: () => void;
  className?: string;
  pendingLabel?: string;
  disabled?: boolean;
}) {
  const [armed, setArmed] = useState(false);

  // Escape disarms. Anything that opens needs a way out that is not the mouse,
  // and this one can appear under the cursor.
  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setArmed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed]);

  if (!armed) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setArmed(true)}
        className={className ?? "text-xs text-[var(--tx-3)] transition-colors hover:text-red-600 hover:underline"}
      >
        {label}
      </button>
    );
  }

  const cancel = (
    <button
      type="button"
      onClick={() => setArmed(false)}
      className="text-xs text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
    >
      Cancel
    </button>
  );

  const confirmClass =
    "rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-red-700";

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="text-xs text-[var(--tx-2)]">{question}</span>
      {action ? (
        <form action={action} className="inline">
          <SubmitButton className={confirmClass} pendingLabel={pendingLabel}>
            {confirmLabel}
          </SubmitButton>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => {
            setArmed(false);
            onConfirm?.();
          }}
          className={confirmClass}
        >
          {confirmLabel}
        </button>
      )}
      {cancel}
    </span>
  );
}
