export const THEME_COOKIE = "counsel-theme";

export const THEME_CHOICES = ["system", "light", "dark"] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

export const THEME_LABELS: Record<ThemeChoice, string> = {
  system: "Match system",
  light: "Light",
  dark: "Dark",
};

// Constants only. The cookie read lives in theme-server.ts because it needs
// next/headers, and this module is imported by a client component.
