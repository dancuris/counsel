import type { Recommendation } from "@/lib/constants";

const DOTS: Record<Recommendation, { className: string; label: string }> = {
  swing: { className: "bg-[var(--mint)]", label: "Swing - worth pursuing" },
  stretch: { className: "bg-[var(--amber)]", label: "Stretch - a real reach" },
  pass: { className: "bg-[var(--tx-3)]", label: "Pass - not worth pursuing" },
};

// A dense list can't afford a sixth column, so the evaluation verdict rides
// in as a leading dot instead: scannable down the edge at zero horizontal
// cost. The full labelled badge still lives on the application itself.
export function RecommendationDot({ recommendation }: { recommendation?: string | null }) {
  const dot = recommendation ? DOTS[recommendation as Recommendation] : undefined;

  if (!dot) {
    return (
      <span
        title="Not evaluated yet"
        aria-label="Not evaluated yet"
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full ring-1 ring-inset ring-[var(--line-2)]"
      />
    );
  }

  return (
    <span
      title={dot.label}
      aria-label={dot.label}
      className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${dot.className}`}
    />
  );
}

export function RecommendationLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-[11.5px] text-[var(--tx-3)]">
      {(Object.keys(DOTS) as Recommendation[]).map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${DOTS[key].className}`} />
          <span className="capitalize">{key}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block h-1.5 w-1.5 rounded-full ring-1 ring-inset ring-[var(--line-2)]" />
        Not evaluated
      </span>
    </div>
  );
}
