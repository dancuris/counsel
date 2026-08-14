import { checkForUpdate } from "@/lib/updates";
import { formatDate } from "@/lib/format";
import Link from "next/link";

/**
 * Tells the owner a newer version exists, and how loudly depends on why.
 *
 * An ordinary release is a quiet line: this is somebody's job search, not a
 * product with a release cadence to advertise, and a banner every few days
 * teaches them to skip the one that matters. A release marked `critical` -
 * data loss, a security problem, something producing a wrong document - gets
 * the amber treatment, because at that point running the old version is worse
 * than the interruption.
 *
 * Renders nothing at all when there is no update or no upstream configured,
 * which is the common case and should cost nothing visually.
 */
export async function UpdateNotice() {
  const update = await checkForUpdate();
  if (update.status !== "behind") return null;

  return (
    <div
      className={`mb-4 rounded-lg border px-3.5 py-2.5 text-[12.5px] leading-relaxed ${
        update.critical
          ? "border-[var(--amber-line)] bg-[var(--amber-dim)] text-[var(--tx)]"
          : "border-line bg-[var(--surface-2)] text-[var(--tx-2)]"
      }`}
    >
      {update.critical ? (
        <>
          <span className="font-medium text-[var(--amber)]">Update recommended now.</span>{" "}
          {update.title}. Released {formatDate(new Date(update.date))}.
        </>
      ) : (
        <>
          A newer version is available: {update.title}, {formatDate(new Date(update.date))}.{" "}
          <span className="text-[var(--tx-3)]">Update when it suits you.</span>
        </>
      )}{" "}
      <Link href="/releases" className="text-accent hover:underline">
        What changed
      </Link>
    </div>
  );
}
