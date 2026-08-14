import Link from "next/link";
import { formatDateTime } from "@/lib/format";
import type { ActivityItem, ActivityKind } from "@/lib/activity";
import { EMPTY_INLINE } from "@/lib/type";

// One dot colour per kind, so the shape of a search reads at a glance: a column
// of amber is a lot of drafting, a column of green is things actually going out.
const DOT: Record<ActivityKind, string> = {
  created: "bg-[var(--line-2)]",
  status: "bg-[var(--amber)]",
  document: "bg-sky-400",
  evaluation: "bg-violet-400",
  correspondence: "bg-emerald-400",
  mail: "bg-emerald-300",
  interview: "bg-rose-400",
  followup: "bg-orange-300",
  upload: "bg-[var(--tx-3)]",
  jd: "bg-[var(--tx-3)]",
  edit: "bg-[var(--line-2)]",
};

export function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return <p className={EMPTY_INLINE}>Nothing recorded yet.</p>;
  }

  return (
    <ol className="relative space-y-0">
      {items.map((item, i) => {
        const body = (
          <>
            <span className="min-w-0">
              <span className="block text-[var(--tx)]">{item.title}</span>
              {item.detail && <span className="block truncate text-xs text-[var(--tx-3)]">{item.detail}</span>}
            </span>
            <span className="shrink-0 whitespace-nowrap text-xs text-[var(--tx-3)]">{formatDateTime(item.at)}</span>
          </>
        );
        return (
          <li key={`${item.at.toISOString()}-${i}`} className="relative flex gap-3 pb-3 last:pb-0">
            {/* The rail is drawn per row rather than as one absolute element so
                it stops at the final entry instead of running past it. */}
            {i < items.length - 1 && (
              <span aria-hidden className="absolute left-[3.5px] top-3 h-full w-px bg-[var(--surface-2)]" />
            )}
            <span aria-hidden className={`relative mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[item.kind]}`} />
            {item.href ? (
              <Link
                href={item.href}
                className="flex min-w-0 flex-1 items-baseline justify-between gap-3 text-sm hover:opacity-80"
              >
                {body}
              </Link>
            ) : (
              <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3 text-sm">{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
