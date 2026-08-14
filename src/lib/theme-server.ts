import { cookies } from "next/headers";
import { THEME_COOKIE, THEME_CHOICES, type ThemeChoice } from "@/lib/theme";

/**
 * The theme is read on the server and written onto <html> before the page is
 * sent, so there is no flash of the wrong theme on load. A client-side script
 * reading localStorage cannot do that: the first paint has already happened.
 *
 * "system" deliberately resolves to *no* attribute rather than to a computed
 * value. The server cannot know what the device prefers, and hard-coding a
 * guess would defeat the prefers-color-scheme rules in globals.css.
 */
export async function getThemeChoice(): Promise<ThemeChoice> {
  const value = (await cookies()).get(THEME_COOKIE)?.value;
  return THEME_CHOICES.includes(value as ThemeChoice) ? (value as ThemeChoice) : "system";
}
