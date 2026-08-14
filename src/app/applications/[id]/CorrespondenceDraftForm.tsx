import Link from "next/link";
import { buttonClass } from "@/lib/button";
import { EMPTY_INLINE } from "@/lib/type";

/**
 * Where to go to write to somebody about this role.
 *
 * **It does not draft anything any more.** It used to: a type dropdown, a
 * model picker, a context box and a row of "Draft a thank-you for X" buttons,
 * all producing a note into a plain textarea with no rich text, no signature
 * and no attachments. The same job had two answers depending on which page you
 * started from, and the worse answer was the more prominent one.
 *
 * Every capability it had exists in the contact composer, which now has the
 * type picker as well. There is nothing left for this to do except point at
 * it, which is what "people-work happens on the contact page" meant.
 */
export function CorrespondenceDraftForm({
  contacts,
}: {
  applicationId: string;
  contacts: { id: string; name: string; role: string | null }[];
}) {
  if (contacts.length === 0) {
    return (
      <p className={EMPTY_INLINE}>
        Nobody is attached to this role yet. Add a contact above, and you can write to them with the editor, your
        signature, attachments and Claude.
      </p>
    );
  }

  return (
    <div>
      <p className="text-[12.5px] text-[var(--tx-3)]">
        Writing happens on the contact, where the editor, your signature, attachments and Claude all are.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {contacts.map((c) => (
          <Link key={c.id} href={`/contacts/${c.id}?write=1`} className={buttonClass("outline", "sm")}>
            Write to {c.name}
          </Link>
        ))}
      </div>
    </div>
  );
}
