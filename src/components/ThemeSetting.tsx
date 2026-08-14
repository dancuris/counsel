"use client";

import { useTransition } from "react";
import { setTheme } from "@/app/profile/theme-actions";
import { THEME_CHOICES, THEME_LABELS, type ThemeChoice } from "@/lib/theme";

const HINTS: Record<ThemeChoice, string> = {
  system: "Follows your device, including its light and dark schedule",
  light: "Always light",
  dark: "Always dark",
};

export function ThemeSetting({ current }: { current: ThemeChoice }) {
  const [pending, start] = useTransition();

  return (
    <div className="panel p-4">
      <h2 className="text-sm font-semibold">Appearance</h2>
      <p className="mt-1 text-[13px] text-[var(--tx-3)]">{HINTS[current]}</p>

      <div className="mt-3 inline-flex gap-0.5 rounded-xl border border-line bg-[var(--bg)] p-1">
        {THEME_CHOICES.map((choice) => {
          const active = choice === current;
          return (
            <button
              key={choice}
              type="button"
              disabled={pending}
              // The whole tree re-renders on change (the theme lives on <html>),
              // so this is a server action rather than a class toggle.
              onClick={() => start(() => void setTheme(choice))}
              className={`rounded-lg px-3.5 py-1.5 text-[13px] transition-colors disabled:opacity-50 ${
                active
                  ? "bg-[var(--surface-2)] text-[var(--tx)] shadow-[0_1px_2px_rgba(0,0,0,.14)]"
                  : "text-[var(--tx-2)] hover:text-[var(--tx)]"
              }`}
            >
              {THEME_LABELS[choice]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
