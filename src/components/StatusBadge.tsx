import { JOB_STATUS_LABELS, type JobStatus } from "@/lib/constants";

// Only the two states that mean "something is happening" carry colour.
// Everything else is a neutral outline pill, so a dead role never competes
// with a live one for attention, and the accent keeps its meaning.
const COLORS: Record<JobStatus, string> = {
  OFFER: "bg-[var(--mint-dim)] text-[var(--mint)] border-mint-line font-semibold",
  INTERVIEWING: "bg-[var(--amber-dim)] text-[var(--amber)] border-amber-line font-semibold",
  APPLIED: "bg-[var(--surface-2)] text-[var(--tx)] border-line",
  LIVE_POSTING_FOUND: "bg-[var(--surface-2)] text-[var(--tx-2)] border-line",
  VERIFY: "bg-[var(--surface-2)] text-[var(--tx-3)] border-line",
  TARGET: "bg-[var(--surface-2)] text-[var(--tx-3)] border-line opacity-75",
  PASSED: "bg-[var(--surface-2)] text-[var(--tx-3)] border-line opacity-60",
  CLOSED_REJECTED: "bg-[var(--surface-2)] text-[var(--tx-3)] border-line opacity-60",
};

export function StatusBadge({ status }: { status: string }) {
  const key = status as JobStatus;
  const color = COLORS[key] ?? "bg-[var(--surface-2)] text-[var(--tx-2)] border-line";
  const label = JOB_STATUS_LABELS[key] ?? status;
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] ${color}`}
    >
      {label}
    </span>
  );
}
