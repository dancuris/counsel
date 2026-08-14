"use client";

import { useSyncExternalStore } from "react";
import { EMPTY_INLINE } from "@/lib/type";

/**
 * The palette by the job each color does, with live contrast ratios.
 *
 * The first version was a swatch dump: every custom property that parsed as a
 * color, sorted alphabetically. That tells you the values and nothing about
 * whether they work. A palette is a set of decisions about foreground on
 * background, and the only question that matters for most of them is whether
 * the text is legible, which is measurable rather than a matter of taste.
 *
 * So this reads the computed values from the running page, computes the WCAG
 * contrast ratio for each real foreground/background pairing the app actually
 * uses, and says plainly which ones pass. Live, in whichever theme is active,
 * because a pair that passes in light can fail in dark and a build-time table
 * would never show it.
 */

type Pair = { label: string; fg: string; bg: string; size: "body" | "large"; note?: string };

/**
 * The pairings that exist in the interface, not every possible combination.
 *
 * Each one is somewhere real: `--tx-3` on `--surface-2` is the hint text inside
 * a panel, which is the smallest and lowest-contrast type in the app and the
 * most likely to fail.
 */
const PAIRS: Pair[] = [
  { label: "Body text", fg: "--tx", bg: "--bg", size: "body" },
  { label: "Secondary text", fg: "--tx-2", bg: "--bg", size: "body" },
  { label: "Muted text", fg: "--tx-3", bg: "--bg", size: "body", note: "labels, timestamps" },
  { label: "Muted on a panel", fg: "--tx-3", bg: "--surface-2", size: "body", note: "hint text, the smallest type here" },
  { label: "Body on a panel", fg: "--tx", bg: "--surface", size: "body" },
  { label: "Warning text", fg: "--amber", bg: "--bg", size: "body" },
  { label: "Success text", fg: "--mint", bg: "--bg", size: "body" },
  { label: "Page title", fg: "--tx", bg: "--bg", size: "large" },
];

function parseColor(value: string): [number, number, number] | null {
  const m = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return null;
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(fg: string, bg: string): number | null {
  const a = parseColor(fg);
  const b = parseColor(bg);
  if (!a || !b) return null;
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

type Row = Pair & { value: number | null; fgValue: string; bgValue: string; passes: boolean; threshold: number };

let cache: Row[] | null = null;
const EMPTY: Row[] = [];

function read(): Row[] {
  if (cache) return cache;
  const computed = getComputedStyle(document.documentElement);
  cache = PAIRS.map((p) => {
    const fgValue = computed.getPropertyValue(p.fg).trim();
    const bgValue = computed.getPropertyValue(p.bg).trim();
    const value = ratio(fgValue, bgValue);
    // AA: 4.5 for body text, 3.0 for large or bold text.
    const threshold = p.size === "large" ? 3 : 4.5;
    return { ...p, fgValue, bgValue, value, threshold, passes: value !== null && value >= threshold };
  });
  return cache;
}

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

export function ThemePalette() {
  const rows = useSyncExternalStore(subscribe, read, () => EMPTY);

  if (rows.length === 0) {
    return <p className={EMPTY_INLINE}>Reading the theme...</p>;
  }

  const failing = rows.filter((r) => !r.passes).length;

  return (
    <div>
      {/* Wide content scrolls inside its own container rather than pushing
          the page sideways, which is the rule everywhere else here and which
          this table broke the day it was written. */}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[440px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-left">
            <th className="pb-2 pr-3 font-medium text-[var(--tx-3)]">Pairing</th>
            <th className="pb-2 pr-3 font-medium text-[var(--tx-3)]">Sample</th>
            <th className="pb-2 pr-3 font-medium text-[var(--tx-3)]">Ratio</th>
            <th className="pb-2 font-medium text-[var(--tx-3)]">AA</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line last:border-b-0">
              <td className="py-2 pr-3 align-top">
                <span className="block text-[var(--tx)]">{r.label}</span>
                <span className="block font-mono text-[10.5px] text-[var(--tx-3)]">
                  {r.fg} on {r.bg}
                </span>
                {r.note && <span className="block text-[11px] text-[var(--tx-3)]">{r.note}</span>}
              </td>
              <td className="py-2 pr-3 align-top">
                <span
                  className="inline-block rounded px-2 py-1"
                  style={{ background: `var(${r.bg})`, color: `var(${r.fg})`, fontSize: r.size === "large" ? 19 : 13 }}
                >
                  Sample
                </span>
              </td>
              <td className="py-2 pr-3 align-top font-mono text-[var(--tx-2)]">
                {r.value ? `${r.value.toFixed(2)}:1` : "?"}
              </td>
              <td className="py-2 align-top">
                <span className={r.passes ? "text-[var(--mint)]" : "text-flame"}>
                  {r.passes ? "pass" : `fails, needs ${r.threshold}`}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--tx-3)]">
        {failing === 0
          ? "Every pairing in use meets WCAG AA in the theme you are looking at. Switch themes to check the other one."
          : `${failing} of ${rows.length} pairings fall below AA in the theme you are looking at. These are computed live, so they follow the active theme.`}
      </p>
    </div>
  );
}
