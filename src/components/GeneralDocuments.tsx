"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { driveFileUrl } from "@/lib/drive-links";
import { ERROR_TEXT } from "@/lib/type";

type Doc = { id: string; label: string; words: number; docx: string | null; pdf: string | null; updatedAt: string | null };

/**
 * The two documents that belong to no role, with their Drive links.
 *
 * They existed before this component did, but only as links pasted into a
 * conversation - which is the same fault as a count that links nowhere. On a
 * networking call the whole value is being able to find them in five seconds.
 */
export function GeneralDocuments({ docs, folderUrl }: { docs: Doc[]; folderUrl?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  function rebuild(kind: string) {
    setError(null);
    setBusy(kind);
    start(async () => {
      try {
        const res = await fetch("/api/general-documents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Rebuild returned ${res.status}.`);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <div className="space-y-3">
      {docs.map((d) => (
        <div key={d.id} className="rounded-lg border border-line bg-[var(--surface-2)] p-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[13px] font-medium text-[var(--tx)]">{d.label}</span>
            <span className="text-[11px] text-[var(--tx-3)]">
              {d.words ? `${d.words.toLocaleString()} words` : "not built yet"}
              {d.updatedAt ? ` · ${new Date(d.updatedAt).toLocaleDateString()}` : ""}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            {d.docx ? (
              <a
                href={driveFileUrl(d.docx)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-line-2 bg-[var(--surface)] px-2.5 py-1 hover:bg-[var(--surface-2)]"
              >
                Word
              </a>
            ) : null}
            {d.pdf ? (
              <a
                href={driveFileUrl(d.pdf)}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded border border-line-2 bg-[var(--surface)] px-2.5 py-1 hover:bg-[var(--surface-2)]"
              >
                PDF
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => rebuild(d.id)}
              disabled={busy !== null}
              className="text-[var(--tx-3)] hover:text-accent hover:underline disabled:opacity-40"
            >
              {busy === d.id ? "Rebuilding..." : "Rebuild"}
            </button>
          </div>
        </div>
      ))}
      <p className="text-[11px] leading-relaxed text-[var(--tx-3)]">
        Filed at the top of your Jobs folder rather than under a company, because they belong to no role. Rebuilding
        updates the same two files, so a link you have already sent keeps working.
        {folderUrl && (
          <>
            {" "}
            <a href={folderUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Open the folder
            </a>
            .
          </>
        )}
      </p>
      {error && <p className={ERROR_TEXT}>{error}</p>}
    </div>
  );
}
