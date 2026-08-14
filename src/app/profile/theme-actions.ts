"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { THEME_COOKIE, THEME_CHOICES, type ThemeChoice } from "@/lib/theme";

export async function setTheme(choice: ThemeChoice) {
  if (!THEME_CHOICES.includes(choice)) return;

  const store = await cookies();
  store.set(THEME_COOKIE, choice, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    // Not httpOnly: this is a display preference, not a credential, and the
    // PWA service worker benefits from being able to read it.
    httpOnly: false,
  });

  // The theme lives on <html> in the root layout, so the whole tree has to
  // re-render for the change to take effect.
  revalidatePath("/", "layout");
}
