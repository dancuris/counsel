import Link from "next/link";
import { snoozeFollowUp } from "@/app/applications/[id]/actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { FollowUpState } from "@/lib/follow-up-state";
import { recruiterFirst } from "@/lib/contact-grouping";

/**
 * Where a role stands on following up, stated on the role rather than waiting
 * to be asked about.
 *
 * The question "when should I chase this" used to be answerable only by typing
 * it into Ask, one role at a time, and the answer went stale as soon as the
 * clock moved. Everything it needs is already in the database, so it is a line
 * on the page now, current every time the page renders.
 *
 * The two controls are the two things he can actually do with the answer: act
 * on it, or decide not to yet and say until when. Deciding not to yet has to
 * be recordable, or the app cannot tell "nothing to do" from "he decided".
 */

/**
 * `text-flame` is the utility, not `text-[var(--flame)]`. There is no raw
 * `--flame` at runtime - it exists only as `--color-flame` inside `@theme` -
 * so the arbitrary-value form resolves to nothing and CSS drops the
 * declaration, leaving correctly-sized invisible text. That has shipped twice
 * in this codebase and it is the urgent state, the one that must never be the
 * one nobody can read.
 */
const TONE: Record<FollowUpState["tone"], string> = {
  urgent: "font-medium text-flame",
  warn: "text-[var(--amber)]",
  calm: "text-[var(--tx-3)]",
};

export function FollowUpLine({
  state,
  applicationId,
  contacts = [],
}: {
  state: FollowUpState;
  applicationId: string;
  /**
   * Everybody on the role, named.
   *
   * This was a single `contactId`, filled with `contacts[0]` - and on a role
   * holding two people that resolved to the hiring-side contact rather than
   * the recruiter who owns the process. The label said "Write to them", so
   * the wrong choice was invisible until the composer opened on the wrong
   * person.
   *
   * Two changes, and the second matters more: the recruiter sorts first
   * because a cadence follow-up is a process question, and **every name is
   * shown**. An app guessing between a hiring manager and a recruiter will be
   * wrong regularly; an app that guesses silently is wrong invisibly.
   */
  contacts?: { id: string; name: string; role: string | null }[];
}) {
  // Nobody has ever been in touch, so there is no silence to measure and
  // nothing useful to say. Saying it anyway would put a grey line on 46 roles.
  if (state.verdict === "opening") return null;

  // Recruiter first, and capped at three: the largest role here has three
  // people on it, and a line naming more than that stops being a sentence.
  const people = recruiterFirst(contacts).slice(0, 3);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className={TONE[state.tone]}>{state.label}</span>

      {state.due && people.length > 0 && (
        <span className="flex flex-wrap items-center gap-x-2">
          <span className="text-[var(--tx-3)]">Write to</span>
          {people.map((c, i) => (
            <span key={c.id} className="flex items-center gap-x-2">
              {i > 0 && <span className="text-[var(--tx-3)]">or</span>}
              <Link
                href={`/contacts/${c.id}?write=1`}
                className="font-medium text-accent hover:underline"
                title={c.role ?? undefined}
              >
                {c.name}
              </Link>
            </span>
          ))}
        </span>
      )}

      {/*
        Only offered where there is something to put off. A snooze on a role
        that is already quiet-and-fine is a control for a decision nobody is
        being asked to make.
      */}
      {state.due && (
        <span className="flex items-center gap-2 text-[var(--tx-3)]">
          <span>or remind me in</span>
          {/*
            One form each rather than two buttons sharing one, because
            useFormStatus reports the nearest enclosing form: sharing it would
            put both buttons in the pending state on either click.
          */}
          {[3, 7].map((d) => (
            <form key={d} action={snoozeFollowUp.bind(null, applicationId)} className="inline">
              <input type="hidden" name="days" value={d} />
              <input type="hidden" name="note" value={`Follow up: ${state.label}`} />
              <SubmitButton className="underline underline-offset-2 hover:text-[var(--tx)]">{d}d</SubmitButton>
            </form>
          ))}
        </span>
      )}
    </div>
  );
}
