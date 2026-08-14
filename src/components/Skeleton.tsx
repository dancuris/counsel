/**
 * Building blocks for the route-level `loading.tsx` files.
 *
 * These are placeholders, not content: everything here is `aria-hidden` and the
 * boundary itself carries the live region, so a screen reader hears "loading"
 * once instead of reading out a wall of empty boxes.
 */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />;
}

/** Wraps a route's loading UI. Announces once, and dims so it never reads as real content. */
export function LoadingShell({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" aria-busy="true" aria-label="Loading" className="opacity-70">
      {children}
    </div>
  );
}

/** The repeated "title over subtitle" line that most of the app's lists are made of. */
export function SkeletonRows({ count = 6, className = "" }: { count?: number; className?: string }) {
  return (
    <div className={className}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3.5 border-b border-line px-4 py-3.5 last:border-b-0">
          <Skeleton className="h-[30px] w-[30px] flex-none rounded-lg" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-[42%]" />
            <Skeleton className="h-2.5 w-[64%]" />
          </div>
          <Skeleton className="h-2.5 w-16 flex-none" />
        </div>
      ))}
    </div>
  );
}

/**
 * A plain document shape, for the pages that are mostly prose.
 *
 * Every route in the app is server-rendered on demand, including the public
 * ones, so they all fall through to some loading UI. Without this they would
 * inherit the dashboard's, and a stranger clicking "Privacy" would get a flash
 * of a pipeline they cannot see.
 */
export function SkeletonDocument() {
  return (
    <LoadingShell>
      <div className="max-w-2xl space-y-4">
        <Skeleton className="h-6 w-52" />
        {["w-full", "w-full", "w-[85%]", "w-[40%]", "w-full", "w-[72%]"].map((w, i) => (
          <Skeleton key={i} className={`h-3 ${w}`} />
        ))}
      </div>
    </LoadingShell>
  );
}

/** A titled panel with rows inside, matching the `.panel` chrome used throughout. */
export function SkeletonPanel({ rows = 5, titleWidth = "w-24" }: { rows?: number; titleWidth?: string }) {
  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-line px-5 py-3.5">
        <Skeleton className={`h-3 ${titleWidth}`} />
      </div>
      <SkeletonRows count={rows} />
    </section>
  );
}
