/**
 * Whether a piece of correspondence may still be rewritten.
 *
 * Three code paths answered this differently, which is how "can I edit a note
 * I already sent" had three answers depending on which page you were standing
 * on. The contact page refused anything that was not a draft. The role page's
 * textarea saved straight through with no check at all, so history was quietly
 * editable. And "Mark as sent" wrote `status: "sent"` with no Gmail id, which
 * the app is not entitled to claim.
 *
 * The distinction that settles it is one the schema already makes, and the two
 * statuses genuinely differ in authority:
 *
 * - **`sent`** means Gmail returned a message id. The stored copy IS what went
 *   out, and Gmail holds the same text. Editing it here would make the record
 *   disagree with the thing it records, so it is locked.
 * - **`sent_externally`** means Dan says he sent it, from Proton, where he may
 *   well have changed a line before hitting send. The stored copy is a
 *   transcription with no independent authority, so correcting it makes the
 *   record MORE accurate, not less.
 *
 * A draft is a draft.
 */

export type EditableCorrespondence = {
  status: string;
  gmailMessageId?: string | null;
};

export function canEditCorrespondence(c: EditableCorrespondence): boolean {
  // A Gmail id is proof, whatever the status says alongside it.
  if (c.gmailMessageId) return false;
  return c.status === "draft" || c.status === "sent_externally";
}

/** Why it is locked, for the one place that has to explain itself. */
export function whyLocked(c: EditableCorrespondence): string | null {
  if (canEditCorrespondence(c)) return null;
  return "This went out through Gmail, so the copy here matches the message itself. Write a new note instead.";
}

/**
 * What a "Mark as sent" button is entitled to claim.
 *
 * Nothing was verified, so it cannot be `sent` - only Dan's word that it went
 * out from somewhere else. `POST /api/correspondence/send` remains the sole
 * writer of `sent`, and only once Gmail has returned an id.
 */
export const MARKED_BY_HAND = "sent_externally";
