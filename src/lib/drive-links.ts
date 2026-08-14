/**
 * Drive constants and URL shapes, kept apart from google-drive.ts so client
 * components and light server routes can import them. That module pulls in
 * Prisma, the OAuth token store and both document renderers; nothing here has
 * a dependency at all.
 */

/**
 * Full read/write Drive access.
 *
 * The narrow alternative, drive.file, grants per-file access to files this app
 * created and nothing else, which means it cannot search. It could never find
 * the existing Jobs/<Company> folders, so it would create a second folder
 * beside each one and fork the structure it was meant to file into. Filing into
 * a tree that already exists needs to be able to read that tree.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

/**
 * Whether a granted-scope string carries Drive access.
 *
 * Google returns the granted scopes space separated. Matched as whole tokens
 * rather than with `includes`, because the full scope is a prefix of every
 * narrower one: a substring test would accept a connection carrying only
 * drive.file or drive.readonly, neither of which can do the work.
 */
export function hasDriveScope(scopes: string | null | undefined): boolean {
  return (scopes ?? "").split(/\s+/).includes(DRIVE_SCOPE);
}

export function driveFileUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * Opens a .docx in Google Docs' Office editing mode, which edits that same
 * file in place rather than making a converted copy.
 *
 * driveFileUrl gives Drive's preview, which is right for a PDF and wrong for a
 * document you meant to edit: it renders the file and offers no way to change
 * it. For a resume adopted from Drive, where the Drive file is the only copy
 * that exists, "open" has to mean "open so I can work on it".
 */
export function driveDocEditUrl(fileId: string): string {
  return `https://docs.google.com/document/d/${fileId}/edit`;
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}
