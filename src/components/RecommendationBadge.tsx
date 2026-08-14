import type { Recommendation } from "@/lib/constants";

// swing / stretch / pass is the punchline of an evaluation, so it carries
// colour where StatusBadge mostly does not: that one says where a role *is*,
// this one says what to *do* about it. Pass is deliberately grey rather than
// red - a pass is information, not a failure.
const STYLES: Record<Recommendation, { color: string; hint: string }> = {
  swing: { color: "bg-[var(--mint-dim)] text-[var(--mint)] ring-[var(--mint-line)]", hint: "Worth pursuing" },
  stretch: { color: "bg-[var(--amber-dim)] text-[var(--amber)] ring-[var(--amber-line)]", hint: "A real reach" },
  pass: { color: "bg-[var(--surface-2)] text-[var(--tx-3)] ring-[var(--line-2)]", hint: "Not worth pursuing" },
};

export function RecommendationBadge({ recommendation }: { recommendation: string }) {
  const style = STYLES[recommendation as Recommendation];
  if (!style) {
    return (
      <span className="inline-flex items-center rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-xs font-medium capitalize text-[var(--tx-2)] ring-1 ring-inset ring-[var(--line-2)]">
        {recommendation}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ring-1 ring-inset ${style.color}`}
      >
        {recommendation}
      </span>
      <span className="hidden text-xs text-[var(--tx-3)] sm:inline">{style.hint}</span>
    </span>
  );
}
