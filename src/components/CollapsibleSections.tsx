import Link from "next/link";
import { type ReactNode } from "react";
import { APP_TABS, type AppTabId } from "@/lib/app-tabs";

/**
 * Tabs, not a column of eleven panels.
 *
 * The page used to stack every section in one scroll, collapsible and
 * reorderable. That sounds like flexibility and behaved like a pile: everything
 * on screen at once, in a remembered order nobody chose, and anything you
 * wanted was below something you did not.
 *
 * This was a client component that received all twelve panels as children and
 * rendered three. Only the active tab reached the DOM, but every panel was
 * server-rendered and serialized either way, so standing on Work still shipped
 * Follow-ups, Meetings and the whole activity timeline. It is now a strip of
 * links: the page reads the tab from the URL and builds nothing else.
 *
 * That also drops the remembered-tab behaviour, deliberately. Persisting it
 * per application meant a role last left on Talk reopened on Talk, and with
 * the timeline alone on History a full history read as no history until you
 * happened to click.
 */

type PanelProps = {
  id: string;
  title: string;
  /** Kept for compatibility with existing call sites; no longer collapses. */
  isEmpty?: boolean;
  badge?: string;
  children: ReactNode;
};

/**
 * A section heading and its content.
 *
 * This used to be an inert marker whose props the parent read, which is what
 * forced every panel to exist before one could be chosen. It renders itself
 * now, so a panel the page does not build costs nothing.
 */
export function Panel({ id, title, badge, children }: PanelProps) {
  return (
    <section id={`section-${id}`} className="scroll-mt-24 py-7 first:pt-1">
      <div className="mb-3.5 flex items-baseline justify-between gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--tx-3)]">{title}</h2>
        {badge && <span className="text-[11.5px] text-[var(--tx-3)]">{badge}</span>}
      </div>
      {children}
    </section>
  );
}

export function CollapsibleSections({
  applicationId,
  active,
  counts,
  children,
}: {
  applicationId: string;
  active: AppTabId;
  counts: Record<AppTabId, number>;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 border-b border-line">
        <nav className="flex gap-1 overflow-x-auto">
          {APP_TABS.map((tab) => {
            const isActive = tab.id === active;
            const count = counts[tab.id] ?? 0;
            return (
              <Link
                key={tab.id}
                href={`/applications/${applicationId}?tab=${tab.id}`}
                scroll={false}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] transition-colors ${
                  isActive
                    ? "border-[var(--amber)] font-medium text-[var(--tx)]"
                    : "border-transparent text-[var(--tx-3)] hover:text-[var(--tx)]"
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className="rounded-full border border-line bg-[var(--surface-2)] px-1.5 text-[10.5px] font-normal text-[var(--tx-2)]">
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/*
        Sections separated by space and a hairline, not eleven boxes.

        Every panel used to be a bordered, shadowed card, so a tab read as a
        stack of containers and the eye had to find the content inside each
        one. The heading already says where a section starts and whitespace
        says where it ends, so type carries the hierarchy and the chrome goes.
      */}
      <div className="divide-y divide-[var(--line)]">{children}</div>
    </div>
  );
}
