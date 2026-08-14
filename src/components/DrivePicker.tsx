"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { attachDriveFile } from "@/app/applications/[id]/drive-actions";
import { buttonClass } from "@/lib/button";
import { ERROR_BLOCK } from "@/lib/type";

type Entry = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  modifiedTime?: string;
  path?: string;
};

/**
 * Attaches a resume or cover letter that already exists in Drive.
 *
 * Two cases it exists for, both real. Reconciling the archive left 85 files
 * unattributed, nearly all of them loose in a folder shared by two roles where
 * the rules deliberately refuse to guess. And a role can have documents Dan
 * wrote outside the app entirely, which is what happened with Marriott: he
 * applied using files Counsel could see but had no way to adopt.
 *
 * Before this, the only routes were moving files around in Drive and re-running
 * a script, or editing the database. Neither is something you can do from a
 * phone between meetings.
 *
 * Opens in the application's company folder rather than the Drive root, because
 * that is where the file almost always already is.
 */
export function DrivePicker({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [trail, setTrail] = useState<{ id: string | null; label: string }[]>([{ id: null, label: "Company folder" }]);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Entry | null>(null);
  const [type, setType] = useState<"resume" | "cover_letter">("resume");
  const [saving, startSave] = useTransition();

  const here = trail[trail.length - 1];
  const search = query.trim();
  // Everything the browse call keys on, in one value.
  const requestKey = search ? `q:${search}` : `f:${here.id ?? "root"}`;

  /**
   * The last answer Drive gave, tagged with what was asked.
   *
   * Held this way rather than as separate entries/loading/error flags so that
   * "still loading" is derived from the tag not matching the question being
   * asked now, instead of being switched on by hand at the top of the effect.
   * A `setLoading(true)` there runs during render and costs an extra pass
   * before the request has even left, which is what React's set-state-in-effect
   * rule was flagging.
   */
  const [result, setResult] = useState<{ key: string; entries: Entry[]; error: string | null } | null>(null);
  const loading = result?.key !== requestKey;
  const entries = result?.entries ?? [];
  // A stale error belongs to the previous question, so it goes as soon as a
  // new one is in flight.
  const error = loading ? null : result?.error ?? null;

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();

    // Searching covers all of Jobs, and every keystroke was its own round trip
    // to the Drive API - eight of them to type "Marriott". Let the typing
    // settle, then ask once. Browsing into a folder is a deliberate click, so
    // it goes straight away.
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({ applicationId });
        if (search) params.set("q", search);
        else if (here.id) params.set("folderId", here.id);

        fetch(`/api/drive/browse?${params}`, { signal: controller.signal })
          .then(async (r) => {
            const data = await r.json();
            if (!r.ok) throw new Error(data.error ?? "Could not read Drive.");
            setResult({ key: requestKey, entries: data.entries ?? [], error: null });
          })
          .catch((e) => {
            // An aborted request was superseded, not failed. Reporting it would
            // put an error under a search the user has already moved on from.
            if (controller.signal.aborted) return;
            setResult({ key: requestKey, entries: [], error: (e as Error).message });
          });
      },
      search ? 250 : 0
    );

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, applicationId, here.id, search, requestKey]);

  // Reopening should ask Drive again rather than show whatever was on screen
  // when it was closed.
  function close() {
    setOpen(false);
    setPicked(null);
    setQuery("");
    setTrail([{ id: null, label: "Company folder" }]);
    setResult(null);
  }

  function attach() {
    if (!picked) return;
    startSave(async () => {
      const fd = new FormData();
      fd.set("fileId", picked.id);
      fd.set("type", type);
      await attachDriveFile(applicationId, fd);
      close();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-[var(--tx-2)] transition hover:text-[var(--tx)]"
      >
        Attach from Drive
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-line bg-[var(--surface-2)] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-semibold text-[var(--tx)]">Attach a file from Drive</p>
        <button type="button" onClick={close} className="text-xs text-[var(--tx-3)] hover:text-[var(--tx)]">
          Cancel
        </button>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search all of Jobs, or browse below"
        className="mt-2 w-full rounded-lg border border-line bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--tx)]"
      />

      {!query.trim() && trail.length > 1 && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-[11.5px] text-[var(--tx-3)]">
          {trail.map((crumb, i) => (
            <span key={`${crumb.id ?? "root"}-${i}`}>
              <button
                type="button"
                onClick={() => setTrail(trail.slice(0, i + 1))}
                className="hover:text-[var(--tx)] hover:underline"
              >
                {crumb.label}
              </button>
              {i < trail.length - 1 ? <span className="px-1">/</span> : null}
            </span>
          ))}
        </div>
      )}

      {error && <p className={ERROR_BLOCK}>{error}</p>}

      <ul className="mt-2 max-h-64 divide-y divide-[var(--line)] overflow-y-auto rounded-lg border border-line bg-[var(--surface)]">
        {loading && <li className="px-2.5 py-2 text-xs text-[var(--tx-3)]">Reading Drive...</li>}
        {!loading && entries.length === 0 && (
          <li className="px-2.5 py-2 text-xs text-[var(--tx-3)]">
            {query.trim() ? "Nothing matched." : "This folder is empty."}
          </li>
        )}
        {!loading &&
          entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() =>
                  entry.isFolder
                    ? setTrail([...trail, { id: entry.id, label: entry.name }])
                    : setPicked(picked?.id === entry.id ? null : entry)
                }
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12.5px] transition hover:bg-[var(--surface-2)] ${
                  picked?.id === entry.id ? "bg-[var(--amber-dim)]" : ""
                }`}
              >
                <span className="text-[var(--tx-3)]">{entry.isFolder ? "\u{1F4C1}" : "\u{1F4C4}"}</span>
                <span className="min-w-0 flex-1 truncate text-[var(--tx)]">{entry.name}</span>
                {entry.path && <span className="shrink-0 text-[11px] text-[var(--tx-3)]">in {entry.path}</span>}
                {picked?.id === entry.id && <span className="shrink-0 text-[11px] font-semibold text-[var(--amber)]">picked</span>}
              </button>
            </li>
          ))}
      </ul>

      {picked && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--tx-2)]">Attach as</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as "resume" | "cover_letter")}
            className="rounded-lg border border-line bg-[var(--surface)] px-2 py-1 text-xs text-[var(--tx)]"
          >
            <option value="resume">Resume</option>
            <option value="cover_letter">Cover letter</option>
          </select>
          <button
            type="button"
            onClick={attach}
            disabled={saving}
            className={buttonClass("primary", "sm")}
          >
            {saving ? "Attaching..." : "Attach"}
          </button>
          <span className="min-w-0 truncate text-[11.5px] text-[var(--tx-3)]">{picked.name}</span>
        </div>
      )}

      <p className="mt-2 text-[11px] text-[var(--tx-3)]">
        Attached as a pointer: Drive keeps the file, Counsel just links to it. Nothing here overwrites it.
      </p>
    </div>
  );
}
