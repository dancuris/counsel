// Single-user app - dates/times are always displayed in the app owner's own
// timezone, not the server's ambient timezone (which is UTC on Vercel but
// whatever the local machine is set to in dev - without pinning this,
// interview times would visibly shift by hours between environments).
export const APP_TIMEZONE = "America/New_York";

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatDateTime(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  const hasTime = d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0;
  if (!hasTime) return formatDate(d);
  return d.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: APP_TIMEZONE });
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Today's date where Dan actually is, as YYYY-MM-DD.
 *
 * Prompts that resolve relative dates need this rather than the UTC date. For
 * roughly a quarter of every day - evening Eastern, already tomorrow in UTC -
 * they disagree, and an interview invitation saying "tomorrow at 9:30" was
 * being resolved a day late.
 */
export function todayLocalISO(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIMEZONE }).format(new Date());
}
