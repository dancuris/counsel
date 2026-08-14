"use client";

import { useState } from "react";
import { buttonClass } from "@/lib/button";
import type { Finding } from "@/lib/linkedin-diff";
import { ERROR_TEXT } from "@/lib/type";

/**
 * Paste the profile, get the differences.
 *
 * A diff and not a rewrite. What LinkedIn should say is Dan's call; what it
 * currently disagrees with is a fact, and that is the part worth automating.
 */
const LABEL: Record<Finding["kind"], string> = {
  "dates-disagree": "Dates disagree",
  "missing-from-linkedin": "Not on LinkedIn",
  "title-differs": "Title written differently",
  "missing-from-resume": "Not on the resume",
};

const TONE: Record<Finding["kind"], string> = {
  // Dates are the only finding a recruiter can check independently, so they
  // are the only ones shown as a problem rather than a difference.
  "dates-disagree": "text-flame",
  "missing-from-linkedin": "text-[var(--amber)]",
  "title-differs": "text-[var(--tx-3)]",
  "missing-from-resume": "text-[var(--tx-3)]",
};

type Result = {
  findings: Finding[];
  missingFromLinkedIn: string[];
  rolesFound: number;
  comparedAgainst: string;
};

export function LinkedInCompare() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function compare() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/linkedin/compare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Comparison failed with ${res.status}.`);
      setResult(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * Reads the export files straight in the browser.
   *
   * The LinkedIn export arrives as a zip of CSVs, and asking Dan to open each
   * one and paste it is asking him to do the computer's job. They are small
   * text files, so they are read client-side and concatenated: no upload
   * endpoint, no storage, and nothing about his career sitting on a disk it
   * did not need to touch.
   *
   * Each file is labelled, because Positions.csv and Profile.csv mean
   * different things and the model reads better with the filename attached.
   */
  async function readFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const wanted = [...files].filter((f) => /\.(csv|txt|json)$/i.test(f.name));
    if (!wanted.length) {
      setError("Those do not look like the export files. Look for Positions.csv and Profile.csv inside the unzipped folder.");
      return;
    }
    const parts = await Promise.all(
      wanted.map(async (f) => `--- ${f.name} ---\n${(await f.text()).slice(0, 20000)}`)
    );
    setText(parts.join("\n\n"));
  }

  return (
    <div>
      <label className="mb-3 flex flex-wrap items-center gap-3 text-[12.5px] text-[var(--tx-3)]">
        <span
          className={buttonClass("outline", "sm", "cursor-pointer")}
          onClick={(e) => (e.currentTarget.parentElement?.querySelector("input") as HTMLInputElement)?.click()}
        >
          Choose the export files
        </span>
        <input
          type="file"
          multiple
          accept=".csv,.txt,.json"
          className="hidden"
          onChange={(e) => void readFiles(e.target.files)}
        />
        <span>Positions.csv and Profile.csv from the unzipped folder. Or paste below.</span>
      </label>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        placeholder="Open your LinkedIn profile, select all, paste here. Or paste the Positions and Profile files from the LinkedIn data export."
        className="w-full rounded-lg border border-line bg-[var(--surface-2)] p-3 text-[13px] leading-relaxed"
      />
      <div className="mt-2.5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void compare()}
          disabled={busy || text.trim().length < 80}
          className={buttonClass("primary", "md")}
        >
          {busy ? "Comparing..." : "Compare with my resume"}
        </button>
        {result && (
          <span className="text-[12.5px] text-[var(--tx-3)]">
            {result.rolesFound} role{result.rolesFound === 1 ? "" : "s"} read, against {result.comparedAgainst}
          </span>
        )}
      </div>

      {error && <p className={ERROR_TEXT}>{error}</p>}

      {result && (
        <div className="mt-5 space-y-5">
          {result.findings.length === 0 && result.missingFromLinkedIn.length === 0 ? (
            <p className="text-[13px] text-[var(--mint)]">
              Nothing disagrees. The roles, the titles and the dates all line up with the resume.
            </p>
          ) : null}

          {result.findings.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold">What disagrees</h3>
              <ul className="mt-2 space-y-2.5">
                {result.findings.map((f, i) => (
                  <li key={i} className="border-l-2 border-line pl-3">
                    <p className={`text-[12px] font-medium uppercase tracking-wide ${TONE[f.kind]}`}>{LABEL[f.kind]}</p>
                    <p className="mt-0.5 text-[13px] text-[var(--tx)]">{f.what}</p>
                    {(f.resume || f.linkedin) && (
                      <p className="mt-1 text-[12px] text-[var(--tx-3)]">
                        {f.resume && (
                          <>
                            resume: <span className="text-[var(--tx-2)]">{f.resume}</span>
                          </>
                        )}
                        {f.resume && f.linkedin ? " · " : ""}
                        {f.linkedin && (
                          <>
                            LinkedIn: <span className="text-[var(--tx-2)]">{f.linkedin}</span>
                          </>
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.missingFromLinkedIn.length > 0 && (
            <div>
              <h3 className="text-[13px] font-semibold">On the resume, not on LinkedIn</h3>
              <p className="mt-0.5 text-[12px] text-[var(--tx-3)]">
                Material the resume carries that the profile does not. Yours to decide what belongs there.
              </p>
              <ul className="mt-2 space-y-1.5">
                {result.missingFromLinkedIn.map((m, i) => (
                  <li key={i} className="text-[13px] text-[var(--tx-2)]">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
