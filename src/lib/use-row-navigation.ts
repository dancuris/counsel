"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * Click-to-navigate behaviour for the rows and cards that are not links.
 *
 * A table row cannot be wrapped in an `<a>`, so these navigate through the
 * router - which costs two things a real link gives you for free, and both of
 * them are why clicking a row used to look like nothing happened:
 *
 * - **No prefetch.** Every destination here is `force-dynamic`, so the router
 *   has nothing cached and the whole trip starts on click. Prefetching on
 *   hover (and on pointer-down, which is all a touch device gets) pulls the
 *   destination's `loading.tsx` shell down ahead of the click.
 * - **No pending state.** `router.push` outside a transition gives the caller
 *   no way to know it is in flight. Inside one, `pending` stays true until the
 *   new route is ready to show, which is exactly the window that needs to look
 *   busy.
 *
 * Prefetching is idempotent in the router's cache, so re-entering a row does
 * not re-request it.
 */
export function useRowNavigation(href: string) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const prefetch = useCallback(() => router.prefetch(href), [router, href]);
  const navigate = useCallback(() => {
    startTransition(() => router.push(href));
  }, [router, href]);

  return {
    pending,
    /** Spread onto the clickable element. */
    handlers: {
      onClick: navigate,
      onPointerEnter: prefetch,
      onPointerDown: prefetch,
    },
  };
}
