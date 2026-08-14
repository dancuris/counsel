/**
 * Counsel holds two Google connections, not one.
 *
 * They are deliberately different accounts. The job search runs from a mailbox
 * kept separate from the personal address, so mail and calendar live on the
 * dedicated job-search account. The document archive predates the app and sits
 * in a Workspace account with the storage, so Drive lives on that one.
 *
 * Splitting them also fixes something the single connection got wrong: one
 * token carried Gmail read, Gmail send, Calendar write and full Drive at once.
 * Now the mail token cannot touch Drive and the Drive token cannot read a
 * single message, which is what those grants should always have been.
 *
 * The id is the primary key on GoogleConnection, so a second row needs no
 * schema change. "singleton" is kept for mail because it is already the stored
 * value and renaming it would disconnect the live mailbox.
 */
export const MAIL_CONNECTION_ID = "singleton";
export const DRIVE_CONNECTION_ID = "drive";

export type ConnectionTarget = "mailbox" | "drive";

export function connectionIdFor(target: ConnectionTarget): string {
  return target === "drive" ? DRIVE_CONNECTION_ID : MAIL_CONNECTION_ID;
}

/** Human label used in error messages, so "reconnect" points at the right one. */
export function connectionLabel(target: ConnectionTarget): string {
  return target === "drive" ? "Google Drive account" : "mailbox";
}
