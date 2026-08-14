import Link from "next/link";
import { formatDate } from "@/lib/format";
import { CORRESPONDENCE_TYPE_LABELS, type CorrespondenceType } from "@/lib/constants";
import { ConfirmButton } from "@/components/ConfirmButton";
import { deleteCorrespondence } from "./correspondence-actions";
import { buttonClass } from "@/lib/button";

/**
 * A note on the role page: what it says, and the way into the one editor.
 *
 * **It no longer edits anything.** This was a second correspondence UI - a
 * plain textarea with its own save, its own refine, its own send and its own
 * "mark as sent" - and none of it had rich text, a signature, attachments or
 * copies, all of which the contact composer has had all along.
 *
 * CLAUDE.md already said not to grow one of these. It had already grown, and
 * the response was a day of bolting escapes onto it: an "Open in composer"
 * link, then a second copy of that link because the first sat below the fold.
 * Dan's verdict was the correct one. Writing a note behaved differently
 * depending on which page you happened to be standing on, and that is not
 * something more links can fix.
 *
 * So: one editor, on the contact page. This is the record and the door.
 * Deleting stays, because it is about this role's history rather than about
 * writing.
 */
export function CorrespondenceEditor({
  id,
  applicationId,
  type,
  recipientName,
  recipientRole,
  initialContent,
  status,
  sentAt,
  subject,
  attachmentNames = [],
  composerHref,
}: {
  id: string;
  applicationId: string;
  type: string;
  recipientName: string;
  recipientRole: string | null;
  initialContent: string;
  status: string;
  sentAt: Date | null;
  recipientEmail: string | null;
  subject: string | null;
  attachmentNames?: string[];
  /** The contact composer, when this note is attached to somebody. */
  composerHref?: string | null;
  gmailMessageId?: string | null;
}) {
  const typeLabel = CORRESPONDENCE_TYPE_LABELS[type as CorrespondenceType] ?? type;
  const isDraft = status === "draft";

  return (
    <li className="border-t border-line pt-3 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-[var(--tx)]">
          {recipientName}
          {recipientRole && <span className="font-normal text-[var(--tx-3)]"> - {recipientRole}</span>}
          <span className="ml-1.5 rounded-full bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--tx-2)]">
            {typeLabel}
          </span>
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            status === "sent" || status === "sent_externally"
              ? "bg-green-50 text-green-700"
              : "bg-amber-50 text-amber-800"
          }`}
        >
          {status === "sent"
            ? `Sent ${formatDate(sentAt)}`
            : status === "sent_externally"
              ? `Sent elsewhere ${formatDate(sentAt)}`
              : "Draft"}
        </span>
      </div>

      {subject && <p className="mt-1.5 text-[12.5px] font-medium text-[var(--tx-2)]">{subject}</p>}

      <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--tx-2)]">{initialContent}</p>

      {attachmentNames.length > 0 && (
        <p className="mt-1.5 text-xs text-[var(--tx-3)]">
          <span className="font-medium">Attached:</span> {attachmentNames.join(", ")}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {composerHref ? (
          <Link href={composerHref} className={buttonClass(isDraft ? "primary" : "outline", "sm")}>
            {isDraft ? "Open in composer" : "Write to them"}
          </Link>
        ) : (
          <span className="text-[12px] text-[var(--tx-3)]">
            Not attached to a contact, so there is nowhere to open it. Add them to this role first.
          </span>
        )}
        <ConfirmButton
          label="Delete"
          question={`Delete this note to ${recipientName}?`}
          confirmLabel="Delete it"
          action={deleteCorrespondence.bind(null, id, applicationId)}
          pendingLabel="Deleting..."
        />
      </div>
    </li>
  );
}
