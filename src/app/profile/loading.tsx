import { LoadingShell, Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <LoadingShell>
      <div className="max-w-3xl">
        <Skeleton className="h-7 w-36" />
        <Skeleton className="mt-3 h-3 w-[min(32rem,90%)]" />
        <div className="mt-6 space-y-3">
          {[0, 1, 2].map((i) => (
            <section key={i} className="panel space-y-3 p-4">
              <Skeleton className="h-3 w-44" />
              <Skeleton className="h-2.5 w-[80%]" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </section>
          ))}
        </div>
      </div>
    </LoadingShell>
  );
}
