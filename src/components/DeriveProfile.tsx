"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonClass, inputClass } from "@/lib/button";
import { SubmitButton } from "@/components/SubmitButton";
import { ERROR_BLOCK } from "@/lib/type";
import { saveDerivedProfile } from "@/app/setup/start/actions";

/**
 * The step that writes the profile, and then hands it straight back to be
 * corrected.
 *
 * Showing the result for editing is not politeness, it is the safety property.
 * These five fields ground every judgement the app later makes and every
 * document it writes, and they were written by a model from a resume and eight
 * short answers. Some of it will be slightly wrong. Presenting it as finished
 * would bury that; presenting it as a draft puts the person who knows the
 * truth in front of it while they are still in setup rather than three months
 * later when a recruiter quotes it back.
 */

type ProfileFields = {
  positioning: string;
  careerNarrative: string;
  personalLogistics: string;
  standingPreferences: string;
  evaluationFramework: string;
};

const FIELDS: { name: keyof ProfileFields; label: string; hint: string; rows: number }[] = [
  {
    name: "positioning",
    label: "Positioning",
    hint: "How the app describes you to itself on every call. Check the verified figures at the bottom especially: nothing outside that list may ever appear on a document.",
    rows: 10,
  },
  {
    name: "careerNarrative",
    label: "Career narrative",
    hint: "The reasons behind the moves. This is what a cover letter draws on, so correct anything that reads as almost right.",
    rows: 12,
  },
  {
    name: "evaluationFramework",
    label: "How to judge a role",
    hint: "The rule used to tell you a role is worth pursuing or is not. If a verdict ever looks wrong later, this is the field to change.",
    rows: 8,
  },
  {
    name: "personalLogistics",
    label: "Logistics",
    hint: "Location, travel, timing, anything you asked never to be suggested.",
    rows: 6,
  },
  {
    name: "standingPreferences",
    label: "House style",
    hint: "Applied to everything written for you. Add anything you find yourself correcting by hand.",
    rows: 8,
  },
];

export function DeriveProfile({
  hasResume,
  hasModel,
  saved,
  profile,
}: {
  hasResume: boolean;
  hasModel: boolean;
  saved: boolean;
  profile: ProfileFields;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState(false);

  const written = Boolean(profile.positioning.trim() && profile.careerNarrative.trim());

  /**
   * How much would be destroyed by building again.
   *
   * This step overwrites five profile fields and the default resume variant,
   * and on an instance that has been running a while those have been corrected
   * by hand over months. A "Build it again" button that does that on one click
   * is the same shape as the bulk repair that destroyed 56 cover letters: every
   * step succeeds and the loss is silent. So a rebuild over existing content
   * arms first and says what it is about to replace.
   */
  const existingSize = Object.values(profile).join("").trim().length;
  const substantial = existingSize > 500;

  async function build() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/setup/derive", { method: "POST" });
      // Checked rather than assumed: a failed request and a successful one
      // look identical to `fetch`, and this one takes a minute, so a silent
      // failure would read as the page simply never finishing.
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? "That did not work. Nothing was saved.");
        return;
      }
      router.refresh();
    } catch {
      setError("The request did not complete. Nothing was saved, so it is safe to try again.");
    } finally {
      setRunning(false);
      setArmed(false);
    }
  }

  if (!hasResume) {
    return (
      <p className="max-w-[62ch] rounded-lg border border-line-2 bg-[var(--surface-2)] p-4 text-[13px] leading-relaxed text-[var(--tx-2)]">
        There is no resume to read yet.{" "}
        <Link href="/setup/start?step=resume" className="underline hover:text-[var(--tx)]">
          Paste one first
        </Link>
        , and this step will have something to work from.
      </p>
    );
  }

  return (
    <div>
      {!hasModel && (
        <p className="mb-6 max-w-[62ch] rounded-lg border border-line-2 bg-[var(--surface-2)] p-4 text-[13px] leading-relaxed text-[var(--tx-2)]">
          This step needs a model key, since it is the app writing the profile rather than you.{" "}
          <Link href="/setup/start?step=model" className="underline hover:text-[var(--tx)]">
            Add one
          </Link>
          , or fill these fields in yourself below. The app still tracks roles either way.
        </p>
      )}

      {armed ? (
        <div className="max-w-[62ch] rounded-lg border border-line-2 bg-[var(--surface-2)] p-4">
          <p className="text-[13px] leading-relaxed text-[var(--tx-2)]">
            This replaces your positioning, career narrative, logistics, evaluation rules and house style, and
            rewrites the default resume variant. That is {existingSize.toLocaleString()} characters of text, including
            anything you have corrected by hand. There is no undo.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={build} disabled={running} className={buttonClass("danger", "md")}>
              {running ? "Rebuilding..." : "Replace it"}
            </button>
            <button
              type="button"
              onClick={() => setArmed(false)}
              disabled={running}
              className={buttonClass("outline", "md")}
            >
              Keep what I have
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => (substantial ? setArmed(true) : build())}
            disabled={running || !hasModel}
            className={buttonClass("primary", "md")}
          >
            {running ? "Reading your resume..." : written ? "Build it again" : "Build my profile"}
          </button>
          {running && (
            <span className="text-[12px] text-[var(--tx-3)]">
              This takes up to a minute. Leaving the page cancels it.
            </span>
          )}
          {saved && !running && <span className="text-[12px] text-[var(--mint)]">Saved</span>}
        </div>
      )}

      {error && <p className={`${ERROR_BLOCK} mt-4 max-w-[62ch]`}>{error}</p>}

      {written && (
        <form action={saveDerivedProfile} className="mt-8">
          <p className="mb-6 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
            This is a draft written from what you gave it. Read it and fix anything that is not true. You are the only
            one who can tell.
          </p>
          {FIELDS.map((field) => (
            <div key={field.name} className="mt-6 first:mt-0">
              <label className="block text-[12.5px] font-medium text-[var(--tx)]" htmlFor={field.name}>
                {field.label}
              </label>
              <p className="mt-1 max-w-[62ch] text-[12px] leading-relaxed text-[var(--tx-3)]">{field.hint}</p>
              <textarea
                id={field.name}
                name={field.name}
                rows={field.rows}
                // Keyed on the value so a rebuild repaints the box. Without it
                // React keeps whatever the textarea first rendered and the page
                // would go on showing the previous draft after "Build it again".
                key={profile[field.name].slice(0, 64)}
                defaultValue={profile[field.name]}
                className={`mt-2 ${inputClass("md")}`}
              />
            </div>
          ))}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <SubmitButton className={buttonClass("primary", "md")} pendingLabel="Saving">
              Save my profile
            </SubmitButton>
            <Link href="/" className={buttonClass("outline", "md")}>
              Done, take me in
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}
