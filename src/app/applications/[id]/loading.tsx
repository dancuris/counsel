import { LoadingShell, Skeleton } from "@/components/Skeleton";

// Mirrors the real page's masthead, quick-action box and tab strip, so the
// content lands into the shape that is already on screen rather than pushing a
// finished layout down as it arrives.
export default function Loading() {
  return (
    <LoadingShell>
      <div className="space-y-8">
        <div>
          <Skeleton className="h-2.5 w-40" />
          <Skeleton className="mt-3 h-5 w-[min(26rem,70%)]" />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-2.5 w-28" />
          </div>
          <Skeleton className="mt-4 h-8 w-36 rounded-lg" />
        </div>

        <Skeleton className="h-[76px] w-full rounded-xl" />

        <div>
          <div className="mb-3 flex gap-4 border-b border-line pb-2.5">
            {["w-16", "w-20", "w-20", "w-20", "w-14"].map((w, i) => (
              <Skeleton key={i} className={`h-3 ${w}`} />
            ))}
          </div>
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <section key={i} className="panel p-4 sm:p-5">
                <Skeleton className="h-3 w-32" />
                <div className="mt-4 space-y-2.5">
                  <Skeleton className="h-2.5 w-full" />
                  <Skeleton className="h-2.5 w-[88%]" />
                  <Skeleton className="h-2.5 w-[64%]" />
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </LoadingShell>
  );
}
