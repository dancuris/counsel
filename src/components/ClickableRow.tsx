"use client";

import type { ReactNode } from "react";
import { useRowNavigation } from "@/lib/use-row-navigation";

export function ClickableRow({ href, children }: { href: string; children: ReactNode }) {
  const { pending, handlers } = useRowNavigation(href);
  return (
    <tr
      {...handlers}
      aria-busy={pending || undefined}
      className={`cursor-pointer transition-colors hover:bg-accent-light/60 ${pending ? "is-navigating" : ""}`}
    >
      {children}
    </tr>
  );
}
