"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { JOB_STATUSES, JOB_STATUS_LABELS } from "@/lib/constants";
import { buttonClass } from "@/lib/button";

/**
 * Status was an uncontrolled <select defaultValue={status}>. The server sent
 * the right option marked selected, but browsers restore form fields to their
 * previously entered value on back-navigation and bfcache restore, and that
 * restoration wins over a defaultValue. So the field could sit there showing a
 * status the application did not have, and pressing Save wrote that stale
 * value over the real one - silently demoting an interviewing role back to a
 * live posting.
 *
 * Controlled state fixes the display, because React writes the value on every
 * render rather than only on mount. The rest is there because a wrong status
 * is invisible once written:
 *
 * - `key` on the usage remounts this when the server value changes, so an
 *   auto-advance from a rejection email is reflected rather than overwritten.
 * - Save is disabled until something actually changes, so the accidental press
 *   Dan described cannot write anything at all.
 * - The current status is printed next to the field, so the two can be
 *   compared without opening a menu.
 */
export function StatusForm({
  action,
  status,
  lastCheckedAt,
}: {
  action: (formData: FormData) => void | Promise<void>;
  status: string;
  lastCheckedAt: string;
}) {
  const [nextStatus, setNextStatus] = useState(status);
  const [nextDate, setNextDate] = useState(lastCheckedAt);

  const changed = nextStatus !== status || nextDate !== lastCheckedAt;

  return (
    <form action={action} autoComplete="off" className="mt-3 flex flex-wrap items-center gap-2">
      <select
        name="status"
        value={nextStatus}
        onChange={(e) => setNextStatus(e.target.value)}
        className="rounded-lg border border-line bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--tx)]"
      >
        {JOB_STATUSES.map((s) => (
          <option key={s} value={s}>
            {JOB_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <input
        type="date"
        name="lastCheckedAt"
        value={nextDate}
        onChange={(e) => setNextDate(e.target.value)}
        className="rounded-lg border border-line bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px] text-[var(--tx)]"
      />

      <SubmitButton
        disabled={!changed}
        className={buttonClass("primary", "md", "disabled:cursor-default")}
      >
        {changed ? "Save change" : "Saved"}
      </SubmitButton>

      {changed ? (
        <span className="text-xs text-[var(--tx-3)]">
          now {JOB_STATUS_LABELS[status as keyof typeof JOB_STATUS_LABELS] ?? status}
        </span>
      ) : null}
    </form>
  );
}
