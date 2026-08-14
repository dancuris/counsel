"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/lib/button";

/**
 * Editing a contact, with the save saying whether it happened.
 *
 * The action was always correct - an edit to a contact's title and phone did
 * reach the database - but the form gave no sign of it. You pressed
 * Save, the page revalidated, the fields showed the same text you had just
 * typed, and nothing anywhere said the write had landed. "I tried to save the
 * contact and it didn't seem to do anything" is exactly what that looks like.
 *
 * So the button states which of the two it is, the way `StatusForm` already
 * does: **Save changes** while the boxes differ from what the server holds,
 * **Saved** once they match. Nothing has to be dismissed and nothing appears
 * and vanishes; the control is the status.
 *
 * The other half is the silent refusal. `updateContactDetails` returns early
 * on an empty name, so clearing it and pressing Save really did do nothing.
 * The button is disabled and says why instead.
 */

export type ContactFields = {
  name: string;
  role: string;
  company: string;
  email: string;
  phone: string;
  relationship: string;
  nextAction: string;
  notes: string;
};

const BOX =
  "rounded-lg border border-line bg-[var(--surface-2)] px-2.5 py-1.5 text-[13px]";

export function ContactDetailsForm({
  action,
  initial,
}: {
  action: (formData: FormData) => Promise<void>;
  initial: ContactFields;
}) {
  const [values, setValues] = useState<ContactFields>(initial);

  const keys = Object.keys(initial) as (keyof ContactFields)[];
  const changed = keys.some((k) => values[k] !== initial[k]);
  const nameMissing = !values.name.trim();

  const set =
    (k: keyof ContactFields) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setValues((cur) => ({ ...cur, [k]: e.target.value }));

  return (
    <form action={action} className="mt-3 space-y-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <input name="name" value={values.name} onChange={set("name")} placeholder="Name" className={BOX} />
        <input name="role" value={values.role} onChange={set("role")} placeholder="Their job title" className={BOX} />
        <input name="company" value={values.company} onChange={set("company")} placeholder="Where they work" className={BOX} />
        <input name="email" value={values.email} onChange={set("email")} placeholder="Email" className={BOX} />
        <input name="phone" value={values.phone} onChange={set("phone")} placeholder="Phone" className={BOX} />
      </div>
      <input
        name="relationship"
        value={values.relationship}
        onChange={set("relationship")}
        placeholder="How you know them"
        className={`w-full ${BOX}`}
      />
      <input
        name="nextAction"
        value={values.nextAction}
        onChange={set("nextAction")}
        placeholder="What you owe them"
        className={`w-full ${BOX}`}
      />
      <textarea
        name="notes"
        value={values.notes}
        onChange={set("notes")}
        rows={3}
        placeholder="Notes"
        className={`w-full ${BOX}`}
      />

      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          disabled={!changed || nameMissing}
          className={buttonClass("primary", "md", "disabled:cursor-default")}
        >
          {changed ? "Save changes" : "Saved"}
        </SubmitButton>
        {nameMissing && <span className="text-xs text-[var(--tx-3)]">A name is required.</span>}
      </div>
    </form>
  );
}
