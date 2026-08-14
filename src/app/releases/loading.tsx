import { LoadingShell, Skeleton, SkeletonRows } from "@/components/Skeleton";

export default function Loading() {
  return (
    <LoadingShell>
      <div className="space-y-5">
        <div>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-2.5 h-3 w-64" />
        </div>
        <section className="panel overflow-hidden">
          <SkeletonRows count={7} />
        </section>
      </div>
    </LoadingShell>
  );
}
