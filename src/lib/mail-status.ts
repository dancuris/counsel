import type { MailCategory } from "@/lib/constants";

/**
 * What a classified message implies about an application's stage.
 *
 * An H&R Block rejection arrived, was classified correctly, and was filed
 * against the right one of two H&R Block applications - and the status stayed
 * on Applied. Everything worked except the part that mattered, and the pipeline
 * kept showing a role that was over.
 *
 * Deliberately narrow. Only categories that state a stage outright appear here:
 * a recruiter's note says nothing reliable about where things stand, so it
 * moves nothing.
 *
 * An application confirmation was originally excluded on that same reasoning,
 * which was wrong. "Thank you for applying" is the employer telling you the
 * application landed - it is the most reliable signal of Applied there is, and
 * more reliable than remembering to set it by hand. The pipeline sat on Live
 * posting found for roles Dan had already applied to.
 */
const IMPLIES: Partial<Record<MailCategory, string>> = {
  application_confirmation: "APPLIED",
  rejection: "CLOSED_REJECTED",
  interview_invite: "INTERVIEWING",
  offer: "OFFER",
};

/**
 * Statuses this is allowed to move away from, per target.
 *
 * The rule is never regress and never overrule a human. An interview invite
 * moves a role forward from applied, but must not drag one back from Offer;
 * and nothing reopens a role that was already closed, because a "we'll keep you
 * in mind" follow-up should not resurrect a dead application.
 */
const MOVABLE_FROM: Record<string, string[]> = {
  // Only ever forward. A confirmation for a role already interviewing is a
  // stale receipt arriving late, not a reason to walk the stage back.
  APPLIED: ["TARGET", "LIVE_POSTING_FOUND", "VERIFY"],
  CLOSED_REJECTED: ["TARGET", "LIVE_POSTING_FOUND", "APPLIED", "INTERVIEWING", "VERIFY"],
  INTERVIEWING: ["TARGET", "LIVE_POSTING_FOUND", "APPLIED", "VERIFY"],
  OFFER: ["APPLIED", "INTERVIEWING"],
};

export type StatusSuggestion = { next: string; reason: string };

export function statusFromMail(
  category: string | null | undefined,
  currentStatus: string
): StatusSuggestion | null {
  const next = IMPLIES[category as MailCategory];
  if (!next || next === currentStatus) return null;
  if (!MOVABLE_FROM[next]?.includes(currentStatus)) return null;

  const reason =
    next === "APPLIED"
      ? "an application confirmation arrived"
      : next === "CLOSED_REJECTED"
      ? "a rejection arrived"
      : next === "INTERVIEWING"
        ? "an interview invitation arrived"
        : "an offer arrived";
  return { next, reason };
}

/**
 * What a closed posting implies, which is far less than it looks.
 *
 * A posting disappearing from LinkedIn says the employer stopped taking new
 * applications. It says nothing at all about an application already in flight:
 * the United role Dan is interviewing for is closed on LinkedIn, and several
 * he has applied to and is waiting on are too. Closing those would be worse
 * than useless - it would delete live opportunities from the pipeline.
 *
 * So this only ever moves a role that was never applied to, and it is the only
 * thing allowed to act on a closed posting. Same never-regress shape as
 * statusFromMail, and deliberately narrower.
 */
const CLOSABLE = ["TARGET", "LIVE_POSTING_FOUND", "VERIFY"];

export function statusForClosedPosting(currentStatus: string): StatusSuggestion | null {
  if (!CLOSABLE.includes(currentStatus)) return null;
  return { next: "PASSED", reason: "the posting is no longer accepting applications" };
}

/**
 * A meeting in the diary is the strongest interview signal there is.
 *
 * `statusFromMail` needs the classifier to say `interview_invite`, and on the
 * one case that mattered it did not. A talent acquisition manager
 * invited Dan to a call under a subject naming the employer;
 * that was read as `recruiter_outreach`, which is a **fair** reading of those
 * words, so the rule correctly declined to act. The meeting went in the diary
 * for the next morning and the role sat on Applied, missing from the
 * "live conversations" count on the one page meant to say what is happening.
 *
 * Widening the categories was the wrong repair. Cold recruiter approaches are
 * the bulk of this mailbox, and moving those to Interviewing would corrupt the
 * pipeline far worse than one role being understated.
 *
 * So this keys on the booking rather than the message. A classification is a
 * guess about what an email meant; a meeting somebody scheduled is a fact, and
 * nobody books an interview for a role they are not interviewing for. Same
 * never-regress shape as the rest of this file: it only moves a role forward,
 * and it never overrules a human who has already moved it further.
 */
export function statusFromMeeting(currentStatus: string): StatusSuggestion | null {
  if (!MOVABLE_FROM.INTERVIEWING.includes(currentStatus)) return null;
  return { next: "INTERVIEWING", reason: "a meeting was scheduled" };
}
