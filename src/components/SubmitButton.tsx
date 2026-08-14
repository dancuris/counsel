"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/**
 * A submit button that knows whether its own form is in flight.
 *
 * Server actions gave no feedback at all: you pressed Save, nothing changed,
 * and the only way to know it had worked was the page eventually re-rendering.
 * On a slow action that reads as a dead button, so people press it again.
 *
 * useFormStatus reports the status of the nearest enclosing form, which is why
 * this has to be its own client component rather than a prop on the page.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  title,
  disabled,
  formAction,
}: {
  children: ReactNode;
  /** Shown while submitting. Defaults to the resting label, dimmed. */
  pendingLabel?: ReactNode;
  className?: string;
  title?: string;
  /** Disable for reasons of your own; pending still disables regardless. */
  disabled?: boolean;
  /**
   * Override the enclosing form's action, for a row with two of them - "I sent
   * this myself" and Delete share one form. Raw `<button type="submit">` was
   * used for these purely because this component did not accept it, which is
   * why they were the buttons with no pending state.
   */
  formAction?: (formData: FormData) => Promise<void> | void;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending || disabled}
      title={title}
      aria-busy={pending}
      className={`${className ?? ""} transition-opacity disabled:cursor-wait disabled:opacity-55`}
    >
      {pending ? (pendingLabel ?? children) : children}
    </button>
  );
}
