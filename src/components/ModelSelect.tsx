"use client";

import { useState } from "react";
import { AVAILABLE_MODELS } from "@/lib/models";

/**
 * Per-action model override, collapsed until it is wanted.
 *
 * It used to render a full dropdown at every call site, and there are nine of
 * them: the assistant, evaluate, generate documents, generate prep, refine,
 * two correspondence forms, quick-add and the quick action box. Three sit on
 * the application page at once, so the same five model names appeared three
 * times on one screen, permanently, to support a choice Dan almost never
 * makes - the default on Settings is what he actually uses.
 *
 * So it is a word until clicked. Overriding is still one click away, and the
 * word changes to name the override when there is one, because a setting that
 * is in effect and invisible is worse than one taking up space.
 *
 * Fixed here rather than at the call sites so all nine change together, and so
 * the next one added cannot reintroduce the clutter.
 */
export function ModelSelect({
  value,
  onChange,
  className,
  defaultLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /**
   * Short name of the model this action would use with no override, so the
   * collapsed control can say what will actually run. Without it the word is
   * "model", which is an invitation rather than information.
   */
  defaultLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = AVAILABLE_MODELS.find((m) => m.value === value);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Use a different model for this action"
        className="rounded px-1 text-[11px] text-[var(--tx-3)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--tx)]"
      >
        {/* Always names the model that will run, overridden or not. Which
            model is doing the work is the point of this control - Dan reaches
            for it to send one resume to Gemini - so hiding it behind the word
            "model" would make the collapse a loss rather than a tidy-up. */}
        {chosen ? chosen.label.replace(/\s*\(.*\)$/, "") : defaultLabel || "model"}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-1">
      <select
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setOpen(false)}
        title="Model for this action"
        className={
          className ??
          "w-32 max-w-full shrink truncate rounded border border-line-2 px-1.5 py-0.5 text-xs text-[var(--tx-3)]"
        }
      >
        <option value="">Default model</option>
        {AVAILABLE_MODELS.map((m) => (
          <option key={m.value} value={m.value}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          onChange("");
          setOpen(false);
        }}
        className="text-[11px] text-[var(--tx-3)] hover:text-[var(--tx)]"
        title="Back to the default model"
      >
        reset
      </button>
    </span>
  );
}
