import { LoadingShell, Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <LoadingShell>
      <div className="max-w-2xl space-y-8">
        <div>
          <Skeleton className="h-4 w-44" />
          <Skeleton className="mt-2.5 h-3 w-[min(26rem,85%)]" />
          <section className="panel mt-4 space-y-3 p-4">
            <Skeleton className="h-28 w-full rounded-lg" />
            <Skeleton className="h-8 w-32 rounded-lg" />
          </section>
        </div>
        <Skeleton className="h-3 w-36" />
      </div>
    </LoadingShell>
  );
}
