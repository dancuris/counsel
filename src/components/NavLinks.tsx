"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * `mobile` renders the same links sized for a finger.
 *
 * 44px is the minimum target Apple asks for and the desktop segments are 32,
 * which is fine for a cursor and not for a thumb. The two variants share this
 * component rather than being written twice, so the active-state logic - the
 * exact match on "/" that stops it prefix-matching every route - cannot drift
 * between them.
 */
export function NavLinks({ links, mobile = false }: { links: { href: string; label: string }[]; mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <>
      {links.map((link) => {
        // "/" would otherwise prefix-match every route, so it needs an exact test.
        const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            // Segments inside the nav's own container: the active one is a
            // raised tile, so the state reads from elevation rather than colour
            // and survives both themes unchanged.
            className={`flex items-center whitespace-nowrap rounded-lg transition-colors ${
              mobile ? "min-h-[44px] flex-1 justify-center px-2 text-[13px]" : "px-3 py-1.5 text-[13px]"
            } ${
              active
                ? "bg-[var(--surface-2)] text-[var(--tx)] shadow-[0_1px_2px_rgba(0,0,0,.14)]"
                : "text-[var(--tx-2)] hover:bg-[var(--surface-2)] hover:text-[var(--tx)]"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
