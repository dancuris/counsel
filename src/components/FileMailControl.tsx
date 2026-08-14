"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { ApplicationPicker } from "@/components/ApplicationPicker";
import { buttonClass, inputClass } from "@/lib/button";

/**
 * Filing a message: against a role, or against the employer. Not both.
 *
 * These shipped as two forms side by side, which reads as two independent
 * things you might do in either order. They are one decision with two answers -
 * filing to a company clears the role and vice versa - and side-by-side forms
 * hid that. A toggle says it: pick which kind of thing this belongs to, then
 * pick the thing.
 *
 * Role is the default because most mail is about a job. Company is for the
 * case that has no job yet: an introduction, a recruiter at a firm Dan is not
 * yet applying to, a company that has been in touch before a posting exists.
 */
export function FileMailControl({
  applications,
  companies,
  contacts,
  suggestCompany,
  suggestRole,
  fileToRole,
  fileToCompany,
  fileToPerson,
}: {
  applications: { id: string; company: string; role: string }[];
  companies: { id: string; name: string }[];
  contacts: { id: string; name: string; company: string | null }[];
  suggestCompany: string | null;
  suggestRole: string | null;
  fileToRole: (formData: FormData) => Promise<void>;
  fileToCompany: (formData: FormData) => Promise<void>;
  fileToPerson: (formData: FormData) => Promise<void>;
}) {
  // Role is the usual default, but not when the classifier found an employer
  // and no job. That is the networking case - an introduction, a coffee, a
  // recruiter at a firm with nothing posted - and defaulting to "role" there
  // asks Dan to pick a job that does not exist.
  const [mode, setMode] = useState<"role" | "company" | "person">(!suggestRole && suggestCompany ? "company" : "role");
  const [pickedPerson, setPickedPerson] = useState("");
  // Pre-selects the employer the classifier detected, which is right far more
  // often than not and makes the common case one click.
  const [picked, setPicked] = useState(
    () => companies.find((c) => suggestCompany && c.name.toLowerCase() === suggestCompany.toLowerCase())?.id ?? ""
  );

  return (
    <div className="min-w-[260px] flex-1">
      <div className="mb-1.5 inline-flex rounded-md border border-line p-0.5 text-[11px]">
        {(["role", "company", "person"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded px-2 py-0.5 capitalize transition-colors ${
              mode === m ? "bg-accent text-white" : "text-[var(--tx-3)] hover:text-accent"
            }`}
          >
            File to {m}
          </button>
        ))}
      </div>

      {mode === "role" && (
        <form action={fileToRole}>
          <ApplicationPicker
            applications={applications}
            suggestCompany={suggestCompany}
            suggestRole={suggestRole}
            submitLabel="File to this role"
          />
        </form>
      )}

      {mode === "company" && (
        <form action={fileToCompany} className="flex flex-wrap items-center gap-1.5">
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="min-w-0 flex-1 rounded-md border border-line bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--tx-2)]"
          >
            <option value="">Choose a company...</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="__new">A company not listed...</option>
          </select>
          {picked === "__new" && (
            <input
              name="newCompanyName"
              required
              autoFocus
              placeholder="Company name"
              className={`min-w-0 flex-1 ${inputClass("sm")}`}
            />
          )}
          <input type="hidden" name="companyId" value={picked === "__new" ? "" : picked} />
          <SubmitButton className={buttonClass("primary", "md", "ml-auto shrink-0")}>
            File to this company
          </SubmitButton>
        </form>
      )}

      {mode === "person" && (
        <form action={fileToPerson} className="flex flex-wrap items-center gap-1.5">
          <select
            value={pickedPerson}
            onChange={(e) => setPickedPerson(e.target.value)}
            name="contactId"
            className="min-w-0 flex-1 rounded-md border border-line bg-[var(--surface-2)] px-2 py-1.5 text-xs text-[var(--tx-2)]"
          >
            <option value="">Choose a person...</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.company ? ` - ${c.company}` : ""}
              </option>
            ))}
          </select>
          <SubmitButton className="ml-auto shrink-0 rounded-md bg-accent px-4 py-2 text-[13px] font-medium text-white transition hover:bg-accent-dark">
            File to this person
          </SubmitButton>
        </form>
      )}

      <p className="mt-1 text-[10.5px] leading-relaxed text-[var(--tx-3)]">
        {mode === "role"
          ? "For mail about a job you are tracking."
          : mode === "company"
            ? "For mail with no job behind it yet, like an introduction. It shows on the company page, and moves to a role later if one appears."
            : "For a conversation that belongs to the person rather than to a job. It files to their employer too, so the history is on both when a role turns up."}
      </p>
    </div>
  );
}
