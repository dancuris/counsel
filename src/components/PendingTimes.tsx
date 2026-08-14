import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { scheduleFromMail } from "@/app/inbox/actions";
import { toEasternInput } from "@/lib/local-time";
import { APP_TIMEZONE } from "@/lib/format";
import { inputClass } from "@/lib/button";

export type PendingTime = {
  id: string;
  subject: string | null;
  fromName: string | null;
  fromEmail: string;
  proposedStart: Date;
  proposedLabel: string | null;
  summary: string | null;
  detectedCompany: string | null;
  detectedRole: string | null;
  applicationId: string | null;
  application: { roleTitle: string; company: { name: string } } | null;
};

/**
 * Every interview time a sender has proposed that is not on the calendar yet.
 *
 * This block exists because of a real miss. An AT&T recruiter moved a call, the
 * sync read the new time correctly, matched it to the right application, and
 * stored it - and then showed nothing, because the only "Add to calendar"
 * button lived in the unmatched-leads list. Mail that filed perfectly was the
 * mail whose proposed time became invisible, which is exactly backwards. The
 * interview stayed off the calendar until it was found by hand.
 *
 * Two things are deliberately filtered out upstream in `pendingTimes()`:
 * times that have already passed, and times superseded by a later message in
 * the same thread. A reschedule leaves the original proposal sitting in the
 * database looking perfectly valid, and confirming it would put a meeting that
 * is not happening onto a real calendar.
 */
export function PendingTimes({ items }: { items: PendingTime[] }) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-2xl border border-amber-line bg-[var(--amber-dim)] p-4">
      <h2 className="text-[13px] font-semibold text-[var(--amber)]">
        {items.length === 1 ? "A time is waiting to be confirmed" : `${items.length} times waiting to be confirmed`}
      </h2>
      <p className="mt-1 text-xs text-[var(--tx-3)]">
        Read out of a message and not on your calendar yet. Check it against the wording before adding it.
      </p>

      <ul className="mt-3 space-y-2.5">
        {items.map((mail) => {
          const company = mail.application?.company.name ?? mail.detectedCompany ?? "Unknown company";
          const role = mail.application?.roleTitle ?? mail.detectedRole ?? "";
          const who = mail.fromName ?? mail.fromEmail;

          return (
            <li key={mail.id} className="panel p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-[13.5px] font-medium text-[var(--tx)]">
                  {mail.applicationId ? (
                    <Link href={`/applications/${mail.applicationId}`} className="hover:underline">
                      {company}
                    </Link>
                  ) : (
                    company
                  )}
                  {role ? <span className="font-normal text-[var(--tx-2)]"> - {role}</span> : null}
                </p>
                <p className="text-[15px] font-semibold tabular-nums text-[var(--tx)]">
                  {mail.proposedStart.toLocaleString("en-US", {
                    timeZone: APP_TIMEZONE,
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}{" "}
                  <span className="text-[11px] font-normal text-[var(--tx-3)]">ET</span>
                </p>
              </div>

              <p className="mt-1 text-xs text-[var(--tx-3)]">
                from {who}
                {mail.proposedLabel ? <> · read from &ldquo;{mail.proposedLabel}&rdquo;</> : null}
              </p>

              <form action={scheduleFromMail.bind(null, mail.id)} className="mt-2.5 flex flex-wrap items-center gap-2">
                <input
                  type="datetime-local"
                  name="start"
                  defaultValue={toEasternInput(mail.proposedStart)}
                  className={inputClass("sm")}
                />
                <input
                  name="roundName"
                  placeholder="Round"
                  className={`w-32 ${inputClass("sm")}`}
                />
                <SubmitButton
                  pendingLabel="Adding..."
                  className="rounded-lg bg-[var(--amber)] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  Add to calendar
                </SubmitButton>
              </form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

