/**
 * A Google Drive folder id, from an id or from a pasted folder URL.
 *
 * Shared because the control moved from Profile to Settings and a second copy
 * would drift. Pasting the URL out of the address bar is the obvious thing to
 * do with a Drive folder, so both are accepted.
 */
export function parseDriveFolderId(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const fromUrl = value.match(/\/folders\/([A-Za-z0-9_-]+)/);
  if (fromUrl) return fromUrl[1];
  // A bare id only. Anything else is a paste that went wrong, and storing it
  // would turn every later save into a Drive 404 rather than a visible mistake.
  return /^[A-Za-z0-9_-]{10,}$/.test(value) ? value : null;
}
