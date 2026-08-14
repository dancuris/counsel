"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buttonClass } from "@/lib/button";

export type PickerApplication = { id: string; company: string; role: string };

const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Token overlap, ignoring the filler words that appear in almost every
// executive title and would otherwise make everything look like a match.
const STOP = new Set(["vp", "vice", "president", "director", "head", "of", "and", "the", "senior", "svp", "avp", "global"]);
function roleOverlap(a: string, b: string): number {
  const t = (v: string) => new Set(norm(v).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
  const A = t(a);
  const B = t(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hits = 0;
  for (const w of A) if (B.has(w)) hits += 1;
  return hits / Math.max(A.size, B.size);
}

function score(app: PickerApplication, company: string | null, role: string | null): number {
  let s = 0;
  if (company) {
    const a = norm(app.company);
    const b = norm(company);
    if (a === b) s += 100;
    else if (a.includes(b) || b.includes(a)) s += 70;
  }
  if (role) s += roleOverlap(app.role, role) * 50;
  return s;
}

export function ApplicationPicker({
  applications,
  suggestCompany = null,
  suggestRole = null,
  name = "applicationId",
  submitLabel,
  placeholder = "Search company or role...",
}: {
  applications: PickerApplication[];
  suggestCompany?: string | null;
  suggestRole?: string | null;
  name?: string;
  submitLabel: string;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  // The list opens in normal flow, not as an overlay, so once you scroll into
  // sixty roles the trigger is off-screen above you and there was no other way
  // out: no Escape, no click-outside, no cancel. Three ways now, because a
  // control you can open and cannot close is a trap.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const sorted = useMemo(
    () =>
      [...applications].sort((a, b) => a.company.localeCompare(b.company) || a.role.localeCompare(b.role)),
    [applications]
  );

  // Anything scoring well against what Claude read out of the message floats
  // to the top as a suggestion; everything else stays strictly alphabetical
  // so the list is predictable to scan.
  const suggestions = useMemo(() => {
    if (!suggestCompany && !suggestRole) return [];
    return sorted
      .map((a) => ({ a, s: score(a, suggestCompany, suggestRole) }))
      .filter((x) => x.s >= 60)
      .sort((x, y) => y.s - x.s)
      .slice(0, 3)
      .map((x) => x.a);
  }, [sorted, suggestCompany, suggestRole]);

  const suggestedIds = new Set(suggestions.map((a) => a.id));

  const filtered = useMemo(() => {
    const q = norm(query);
    if (!q) return sorted;
    return sorted.filter((a) => norm(`${a.company} ${a.role}`).includes(q));
  }, [sorted, query]);

  const chosen = applications.find((a) => a.id === selected);

  return (
    <div className="w-full" ref={box}>
      <input type="hidden" name={name} value={selected} />

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded border border-line-2 bg-[var(--surface)] px-2 py-1.5 text-left text-xs hover:border-accent/50"
      >
        {chosen ? (
          <span className="font-medium text-[var(--tx)]">
            {chosen.company} <span className="font-normal text-[var(--tx-3)]">- {chosen.role}</span>
          </span>
        ) : (
          <span className="text-[var(--tx-3)]">Choose a role...</span>
        )}
      </button>

      {open && (
        <div className="mt-1 rounded-lg border border-line bg-[var(--surface)] shadow-sm">
          <div className="flex items-center justify-between gap-2 border-b border-line px-2 py-1">
            <span className="text-[10.5px] uppercase tracking-[0.06em] text-[var(--tx-3)]">Choose a role</span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded px-1.5 py-0.5 text-[11px] text-[var(--tx-3)] transition hover:text-[var(--tx)]"
            >
              Close
            </button>
          </div>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="w-full rounded-t-lg border-b border-line px-2.5 py-2 text-xs"
          />

          {suggestions.length > 0 && !query && (
            <div className="border-b border-line bg-accent-light/40 px-2.5 py-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-accent-dark">Likely match</p>
              {suggestions.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => {
                    setSelected(a.id);
                    setOpen(false);
                  }}
                  className="mt-1 block w-full truncate rounded px-1.5 py-1 text-left text-xs hover:bg-[var(--surface)]"
                >
                  <span className="font-medium text-[var(--tx)]">{a.company}</span>{" "}
                  <span className="text-[var(--tx-3)]">- {a.role}</span>
                </button>
              ))}
            </div>
          )}

          <ul className="max-h-56 overflow-y-auto">
            {filtered.length === 0 && <li className="px-2.5 py-2 text-xs text-[var(--tx-3)]">No match.</li>}
            {filtered.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(a.id);
                    setOpen(false);
                  }}
                  className={`block w-full truncate px-2.5 py-1.5 text-left text-xs hover:bg-[var(--surface-2)] ${
                    suggestedIds.has(a.id) ? "bg-accent-light/30" : ""
                  }`}
                >
                  <span className="font-medium text-[var(--tx)]">{a.company}</span>{" "}
                  <span className="text-[var(--tx-3)]">- {a.role}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Right-aligned and accent, matching the company form beside it. Filing
        is the action on an Inbox row - the only other button creates a new
        role, and that one is not offered at all on a message with no role in
        it - so it should not read as the quietest thing there.
      */}
      <button
        type="submit"
        disabled={!selected}
        className={buttonClass("primary", "md", "mt-1.5 ml-auto block")}
      >
        {submitLabel}
      </button>
    </div>
  );
}
