import { LoadingShell, Skeleton } from "@/components/Skeleton";

// The prep document runs to thousands of words, so this one is a page of text
// rather than a list.
export default function Loading() {
  return (
    <LoadingShell>
      <div className="space-y-5">
        <div>
          <Skeleton className="h-2.5 w-32" />
          <Skeleton className="mt-2.5 h-5 w-56" />
          <Skeleton className="mt-2.5 h-3 w-72" />
        </div>
        <section className="panel space-y-3 p-5">
          {["w-[45%]", "w-full", "w-full", "w-[88%]", "w-[38%]", "w-full", "w-[92%]", "w-[70%]"].map((w, i) => (
            <Skeleton key={i} className={`h-3 ${w}`} />
          ))}
        </section>
      </div>
    </LoadingShell>
  );
}
