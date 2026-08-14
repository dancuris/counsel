"use client";

import { useSyncExternalStore } from "react";
import { EMPTY_INLINE } from "@/lib/type";

/**
 * The palette, read from the running page rather than from the stylesheet.
 *
 * The first version parsed `globals.css` with `readFileSync` at request time,
 * which was wrong twice over: the selector is `:root, :root[data-theme="light"]`
 * so a regex expecting `:root {` matched nothing, and source files are not in
 * the deployed bundle at all, so it would have rendered an empty section in
 * production while looking correct locally.
 *
 * The second version read the values in an effect and called `setState`, which
 * is a lint **error** in this repo and shipped anyway because the lint gate in
 * `ship.sh` had been silently inverted by `pipefail`. CI caught it on its first
 * run, which is the whole argument for having CI.
 *
 * `useSyncExternalStore` is the correct tool and not merely the compliant one.
 * The theme genuinely is an external store: it lives on the document element
 * and in the OS colour-scheme setting, and it can change while this page is
 * open. Subscribing means the swatches follow a theme toggle, which neither of
 * the previous versions did.
 */
type Token = { name: string; value: string };

/**
 * Cached so `getSnapshot` returns a stable reference.
 *
 * React calls the snapshot on every render and compares by identity; rebuilding
 * the array each time is an infinite loop. Invalidated by the subscription
 * below when the theme actually changes.
 */
let cache: Token[] | null = null;
const EMPTY: Token[] = [];

function readTokens(): Token[] {
  if (cache) return cache;

  const names = new Set<string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      // A cross-origin sheet throws on access. There are none here, but a
      // colour chart is not worth an unhandled exception.
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (!rule.selectorText.includes(":root")) continue;
      for (const prop of Array.from(rule.style)) {
        if (prop.startsWith("--")) names.add(prop);
      }
    }
  }

  const computed = getComputedStyle(document.documentElement);
  cache = [...names]
    .map((name) => ({ name, value: computed.getPropertyValue(name).trim() }))
    // Only things that render as a colour. Gradients, shadows and the numeric
    // tokens are real but a swatch of them says nothing.
    .filter((t) => /^(#|rgb|hsl|oklch|color\()/i.test(t.value))
    .sort((a, b) => a.name.localeCompare(b.name));

  return cache;
}

/** Re-read when the theme attribute changes, or when the OS setting does. */
function subscribe(onChange: () => void): () => void {
  const invalidate = () => {
    cache = null;
    onChange();
  };

  const observer = new MutationObserver(invalidate);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", invalidate);

  return () => {
    observer.disconnect();
    media.removeEventListener("change", invalidate);
  };
}

export function ThemeTokens() {
  // The server has no document, so it renders the placeholder and the client
  // fills it in. Both snapshots are stable references, so neither loops.
  const tokens = useSyncExternalStore(subscribe, readTokens, () => EMPTY);

  if (tokens.length === 0) {
    return <p className={EMPTY_INLINE}>Reading the theme...</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {tokens.map((t) => (
        <div key={t.name} className="flex items-center gap-2">
          <span
            className="h-6 w-6 shrink-0 rounded border border-line"
            style={{ background: t.value }}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block truncate font-mono text-[11px] text-[var(--tx-2)]">{t.name}</span>
            <span className="block truncate font-mono text-[10px] text-[var(--tx-3)]">{t.value}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
