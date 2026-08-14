"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { groupContacts, surnameFirst, type ContactRow } from "@/lib/contact-grouping";
import { EMPTY_BLOCK } from "@/lib/type";

export function ContactSearch({ rows }: { rows: ContactRow[] }) {
  const [q, setQ] = useState("");
  const [bySurname, setBySurname] = useState(true);
  const [grouped, setGrouped] = useState(true);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const base = needle
      ? rows.filter((r) =>
          [r.name, r.role, r.email, r.where, r.relatesTo, r.nextAction].filter(Boolean).join(" ").toLowerCase().includes(needle)
        )
      : rows;
    // Sorting the display name rather than the stored one, so the order always
    // matches what is on screen.
    return [...base].sort((a, b) => {
      const owedDiff = Number(Boolean(b.nextAction)) - Number(Boolean(a.nextAction));
      if (owedDiff !== 0) return owedDiff;
      const av = bySurname ? surnameFirst(a.name) : a.name;
      const bv = bySurname ? surnameFirst(b.name) : b.name;
      return av.localeCompare(bv);
    });
  }, [rows, q, bySurname]);

  // Kept pure and lifted out so the tiering rule can be tested without a
  // database or a browser, the same way drive-match and activity are.
  const groups = useMemo(() => groupContacts(filtered, grouped), [filtered, grouped]);

  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, employer or role..."
          className="min-w-0 flex-1 rounded-lg border border-line bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--tx)]"
        />
        <div className="inline-flex rounded-lg border border-line bg-[var(--surface-2)] p-0.5 text-[11.5px]">
          {(
            [
              ["Surname", bySurname, () => setBySurname(true)],
              ["First name", !bySurname, () => setBySurname(false)],
            ] as const
          ).map(([label, on, set]) => (
            <button
              key={label}
              type="button"
              onClick={set}
              className={`rounded-md px-2.5 py-1 transition ${on ? "bg-accent text-white" : "text-[var(--tx-3)] hover:text-[var(--tx)]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setGrouped((g) => !g)}
          className={`rounded-lg border px-2.5 py-1.5 text-[11.5px] transition ${
            grouped ? "border-amber-line bg-[var(--amber-dim)] text-[var(--amber)]" : "border-line text-[var(--tx-3)] hover:text-[var(--tx)]"
          }`}
        >
          By company
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {filtered.length === 0 && (
          <p className={`panel ${EMPTY_BLOCK}`}>
            {q ? `Nobody matches "${q}".` : "No contacts yet."}
          </p>
        )}
        {groups.map((g) => {
          const count = g.subgroups.reduce((n, sg) => n + sg.rows.length, 0);
          if (count === 0) return null;
          const showRoleTier = g.subgroups.length > 1 || Boolean(g.subgroups[0]?.label);

          return (
            <section key={g.label || "all"} className="panel overflow-hidden">
              {g.label && (
                <div className="border-b border-line px-4 py-2.5">
                  <h2 className="text-[12px] font-semibold text-[var(--tx-2)]">
                    {g.label} <span className="font-normal text-[var(--tx-3)]">{count}</span>
                  </h2>
                </div>
              )}
              {g.subgroups.map((sg) => (
                <div key={sg.label || "only"}>
                  {showRoleTier && sg.label && (
                    <div className="border-b border-line bg-[var(--surface-2)] px-4 py-1.5 pl-6">
                      <h3 className="text-[11px] text-[var(--tx-3)]">{sg.label}</h3>
                    </div>
                  )}
                  <ul className="divide-y divide-[var(--line)]">
                    {sg.rows.map((c) => (
                      <li key={c.id}>
                        <Link
                          href={`/contacts/${c.id}`}
                          className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 pr-4 transition-colors hover:bg-[var(--surface-2)] ${
                            showRoleTier && sg.label ? "pl-6" : "pl-4"
                          }`}
                        >
                          <span className="text-[13px] font-medium text-[var(--tx)]">
                            {bySurname ? surnameFirst(c.name) : c.name}
                          </span>
                          {c.role && <span className="text-[12px] text-[var(--tx-3)]">{c.role}</span>}
                          <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--tx-3)]">
                            {grouped && g.label !== "You owe these people something" ? "" : c.where}
                          </span>
                          {/* Suppressed under a role heading, which already says it. */}
                          {c.relatesTo && !(showRoleTier && sg.label) && (
                            <span className="shrink-0 truncate text-[11px] text-[var(--tx-3)]">on {c.relatesTo}</span>
                          )}
                          {c.messages > 0 && (
                            <span className="shrink-0 text-[11px] text-[var(--tx-3)]">
                              {c.messages} {c.messages === 1 ? "note" : "notes"}
                            </span>
                          )}
                          {c.nextAction && (
                            <span className="w-full truncate text-[11.5px] text-[var(--amber)]">owed: {c.nextAction}</span>
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
