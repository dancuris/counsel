"use client";

import { useEffect } from "react";

// Registers the pass-through service worker that makes the app installable.
// Registration is best-effort: if it fails the app still works exactly as a
// normal site, so failures are swallowed rather than surfaced to the user.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return null;
}
