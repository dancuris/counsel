import { LoadingShell, Skeleton, SkeletonPanel, SkeletonRows } from "@/components/Skeleton";

// The dashboard's own loading UI, and the fallback for any route below it that
// has not declared one.
export default function Loading() {
  return (
    <LoadingShell>
      <div className="space-y-3">
        <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pb-4 pt-3">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-7 w-[min(30rem,85%)]" />
            <Skeleton className="mt-3 h-3 w-[min(20rem,60%)]" />
          </div>
          <div className="flex flex-none gap-2">
            <Skeleton className="h-[42px] w-24 rounded-lg" />
            <Skeleton className="h-[42px] w-36 rounded-lg" />
          </div>
        </section>

        <Skeleton className="h-[52px] w-full rounded-xl" />

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="panel p-5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="mt-3 h-7 w-12" />
              <Skeleton className="mt-2.5 h-2.5 w-24" />
            </div>
          ))}
        </section>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.62fr)_minmax(0,1fr)]">
          <SkeletonPanel rows={5} />
          <SkeletonPanel rows={4} titleWidth="w-16" />
        </div>

        <section className="panel overflow-hidden">
          <div className="border-b border-line px-4 py-3">
            <Skeleton className="h-3 w-40" />
          </div>
          <SkeletonRows count={8} />
        </section>
      </div>
    </LoadingShell>
  );
}
