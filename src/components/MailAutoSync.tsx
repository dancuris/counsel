"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Syncs the mailbox when the app is opened, so mail arrives without anyone
// remembering to press a button. Gated on staleness because a sync fetches the
// inbox and runs a Claude classification pass - firing that on every render or
// every navigation would be slow and would cost money for nothing.
export function MailAutoSync({
  lastSyncedAt,
  staleMinutes = 15,
}: {
  lastSyncedAt: string | null;
  staleMinutes?: number;
}) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    const age = lastSyncedAt ? Date.now() - new Date(lastSyncedAt).getTime() : Infinity;
    if (age < staleMinutes * 60_000) return;

    // The ref only guards this mount. Navigating away and back remounts the
    // component, and lastSyncedAt is still stale because the previous sync has
    // not finished writing yet - so it fires again, on top of the first one.
    // sessionStorage survives the remount and holds the claim for the length of
    // one sync, which is what actually stops the overlap.
    const CLAIM = "mailSyncStartedAt";
    const claimed = Number(window.sessionStorage.getItem(CLAIM) ?? 0);
    if (Date.now() - claimed < 120_000) return;
    window.sessionStorage.setItem(CLAIM, String(Date.now()));

    fired.current = true;
    // Deliberately fire-and-forget: the page stays usable while this runs, and
    // a failure here should never block reading what has already been pulled.
    fetch("/api/mailbox/sync", { method: "POST" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && (data.new > 0 || data.leads > 0)) router.refresh();
      })
      .catch(() => {})
      // Release the claim as soon as the run ends, so a genuine retry is not
      // blocked for the full two minutes after a fast sync.
      .finally(() => window.sessionStorage.removeItem("mailSyncStartedAt"));
  }, [lastSyncedAt, staleMinutes, router]);

  return null;
}
