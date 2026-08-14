import { recentFailures } from "@/lib/failures";
import { formatDateTime } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { buttonClass } from "@/lib/button";
import { markFailuresSeen } from "@/app/settings/actions";
import { EMPTY_INLINE } from "@/lib/type";

/**
 * The failures the app decided not to interrupt you about.
 *
 * Everything here already happened, was already caught, and already let the
 * user carry on - that is the design and it is right. What was missing is any
 * way to find out afterwards. A Drive sync that has been failing for a week, a
 * status advance that stopped working, an activity log quietly not recording:
 * all three would look identical to nothing having happened.
 *
 * Deliberately not a badge in the nav. These are not things to act on today;
 * they are things to notice when something feels off, which is what Settings
 * is for. The one number that matters is how many are new.
 */
export async function FailurePanel() {
  const failures = await recentFailures(15);
  if (failures.length === 0) {
    return (
      <p className={EMPTY_INLINE}>
        Nothing has failed quietly. This lists background work that was caught and swallowed, so an empty list
        is the good case.
      </p>
    );
  }

  const unseen = failures.filter((f) => !f.seenAt).length;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] text-[var(--tx-2)]">
          {failures.length} recent, {unseen} not yet looked at. Background work that failed without
          interrupting you.
        </p>
        {unseen > 0 && (
          <form action={markFailuresSeen}>
            <SubmitButton className={buttonClass("outline", "sm")} pendingLabel="Marking...">
              Mark all seen
            </SubmitButton>
          </form>
        )}
      </div>

      <ul className="mt-3 space-y-2.5">
        {failures.map((f) => (
          <li key={f.id} className="border-l-2 border-line pl-3">
            <p className="text-[12.5px]">
              <span className="font-mono text-[var(--tx)]">{f.operation}</span>
              {!f.seenAt && <span className="ml-2 text-[11px] font-medium text-[var(--amber)]">new</span>}
              <span className="ml-2 text-[11px] text-[var(--tx-3)]">{formatDateTime(f.at)}</span>
            </p>
            <p className="mt-0.5 text-[12.5px] leading-relaxed text-[var(--tx-2)]">{f.message}</p>
            {f.context && <p className="mt-0.5 font-mono text-[11px] text-[var(--tx-3)]">{f.context}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
