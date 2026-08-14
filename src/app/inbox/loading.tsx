import { LoadingShell, Skeleton, SkeletonRows } from "@/components/Skeleton";

export default function Loading() {
  return (
    <LoadingShell>
      <div className="space-y-5">
        <div>
          <Skeleton className="h-7 w-32" />
          <Skeleton className="mt-3 h-3 w-[min(34rem,90%)]" />
        </div>
        <section className="panel overflow-hidden">
          <SkeletonRows count={9} />
        </section>
      </div>
    </LoadingShell>
  );
}
