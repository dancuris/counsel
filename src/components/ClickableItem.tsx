"use client";

import type { ReactNode } from "react";
import { useRowNavigation } from "@/lib/use-row-navigation";

export function ClickableItem({
  href,
  children,
  className,
}: {
  href: string;
  children: ReactNode;
  className?: string;
}) {
  const { pending, handlers } = useRowNavigation(href);
  return (
    <li
      {...handlers}
      aria-busy={pending || undefined}
      className={`-mx-2 cursor-pointer rounded-md px-2 py-1 transition-colors hover:bg-accent-light/60 ${
        pending ? "is-navigating" : ""
      } ${className ?? ""}`}
    >
      {children}
    </li>
  );
}
