/**
 * When to follow up on a role, computed rather than asked.
 *
 * The cadence already existed, as prose inside the Ask prompt, reachable only
 * by typing a question about one role. That has two failures. The answer goes
 * stale the moment the clock moves - the question was six days quiet
 * when Dan asked and seven the next morning, which is the difference between
 * "wait" and "a check-in is fine" - and a decision reached in conversation
 * leaves no trace, so the app cannot tell "nothing to do here" from "he decided
 * there is nothing to do here". Those look identical and are not the same.
 *
 * So the rule lives here, as one pure function over dates, and everything that
 * needs it reads it: the line on the role, the roll-up onto Today, and the
 * reminder date the Ask route offers. None of them can drift from the others
 * because none of them holds its own copy. That is the same rule this app has
 * had to learn repeatedly: a count and the page it links to must be computed
 * from one definition, or they drift and the number stops being believed.
 *
 * It stays pure and free of Prisma types so the boundaries are testable
 * against fabricated dates rather than by waiting a day and looking.
 */

import { inboundKind, type SenderLike } from "@/lib/mail-sender";

const DAY = 86_400_000;

/**
 * The cadence, as numbers. Under `CHECK_IN_DAY` days: wait. Between that and
 * `CHASE_DAY`: a short check-in is fine. Past `CHASE_DAY`: the silence is
 * notable and chasing is right.
 *
 * These are the figures the Ask prompt states in prose. If the advice ever
 * needs to change, change them here, not the prose around them.
 */
export const CHECK_IN_DAY = 7;
export const CHASE_DAY = 10;

/** Who is holding the conversation up. */
export type Ball = "you" | "them" | "nobody";

export type Verdict =
  /** They wrote last and he owes the answer. */
  | "reply"
  /** Past the chase threshold. */
  | "chase"
  /** Inside the check-in window. */
  | "checkin"
  /** Too soon to be silence. */
  | "wait"
  /** Something is booked; chasing about status in between reads as anxious. */
  | "booked"
  /** He decided to wait, and said until when. */
  | "snoozed"
  /** Nobody has ever written, so days quiet means nothing. */
  | "opening"
  /**
   * Something happened, but there is no human on the other end of it. An
   * application went in and only machines have replied.
   */
  | "noreply";

export type FollowUpInput = {
  /** Last thing Dan sent them, however it went out. */
  lastOutbound: Date | null;
  /** Last message that actually asks him something. */
  lastInboundAnswer: Date | null;
  /**
   * Last message from a real person of any kind. An acknowledgement does not
   * hand him the ball, but it does mean the thread is not silent.
   */
  lastInboundContact: Date | null;
  /** The next booked meeting, if there is one ahead of now. */
  nextMeeting: Date | null;
  /**
   * The soonest open follow-up with a date on it. A dated follow-up is Dan
   * having decided, so it outranks everything below it.
   */
  waitingUntil: Date | null;
  now: Date;
};

export type FollowUpState = {
  verdict: Verdict;
  ball: Ball;
  /** Days since the last thing that happened either way; null if nothing has. */
  daysQuiet: number | null;
  /** When this becomes worth acting on. Null where no date applies. */
  actOn: Date | null;
  /** Whether it is worth acting on today. */
  due: boolean;
  /** One line, written for him, always naming the actual figure. */
  label: string;
  tone: "urgent" | "warn" | "calm";
};

function days(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / DAY);
}

function onDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * The cadence, in the order the branches actually override one another.
 *
 * Order is the whole design here. A decision to wait beats a booked meeting
 * beats an unanswered reply beats a day count, because each one is a stronger
 * statement about what should happen than the one below it.
 */
export function followUpState(input: FollowUpInput): FollowUpState {
  const { lastOutbound, lastInboundAnswer, lastInboundContact, nextMeeting, waitingUntil, now } = input;

  // Silence is measured against anything real that happened, in either
  // direction. A thank-you is not a reply owed and it is still not silence.
  const lastAny =
    [lastOutbound, lastInboundAnswer, lastInboundContact]
      .filter((d): d is Date => d instanceof Date)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const daysQuiet = lastAny ? days(lastAny, now) : null;

  // He decided, and the decision has a date on it. Nagging through a snooze is
  // how a prompt becomes something you learn to dismiss without reading.
  if (waitingUntil && waitingUntil.getTime() > now.getTime()) {
    return {
      verdict: "snoozed",
      ball: lastInboundAnswer && (!lastOutbound || lastInboundAnswer > lastOutbound) ? "you" : "them",
      daysQuiet,
      actOn: waitingUntil,
      due: false,
      label: `Waiting until ${onDay(waitingUntil)}, your call`,
      tone: "calm",
    };
  }

  // Something is on the calendar. Chasing about status in the days before a
  // call is the one move that actively costs him something.
  if (nextMeeting && nextMeeting.getTime() > now.getTime()) {
    return {
      verdict: "booked",
      ball: "them",
      daysQuiet,
      actOn: null,
      due: false,
      label: `Booked ${onDay(nextMeeting)}, nothing to chase before then`,
      tone: "calm",
    };
  }

  // A real person wrote after he last did. The day count is irrelevant: he is
  // the one holding it up, and that is true at one day as much as at ten.
  if (lastInboundAnswer && (!lastOutbound || lastInboundAnswer.getTime() > lastOutbound.getTime())) {
    const d = days(lastInboundAnswer, now);
    return {
      verdict: "reply",
      ball: "you",
      daysQuiet,
      actOn: lastInboundAnswer,
      due: true,
      label: d === 0 ? "They wrote today, you owe the reply" : `They wrote ${d} day${d === 1 ? "" : "s"} ago, you owe the reply`,
      tone: "urgent",
    };
  }

  // Nobody has ever written in either direction. Silence is not the question
  // here; whether to make the first move at all is, and that is his to make.
  if (!lastAny) {
    return {
      verdict: "opening",
      ball: "nobody",
      daysQuiet: null,
      actOn: null,
      due: false,
      label: "No contact either way",
      tone: "calm",
    };
  }

  const quiet = days(lastAny, now);

  // Telling him to check in requires somebody to check in with. American
  // Express read as "quiet 9 days, a short check-in is fine" on the strength of
  // an automated referral notice from careers@recruitment.americanexpress.com,
  // and there is no one behind that address to write to. He has a correspondent
  // when he has written to somebody, or when a named person has written to him;
  // a department mailbox is neither.
  const hasCorrespondent = Boolean(lastOutbound || lastInboundAnswer);
  if (!hasCorrespondent) {
    return {
      verdict: "noreply",
      ball: "them",
      daysQuiet: quiet,
      actOn: null,
      due: false,
      label: `Nothing back in ${quiet} day${quiet === 1 ? "" : "s"}, no one to chase`,
      tone: "calm",
    };
  }

  if (quiet > CHASE_DAY) {
    return {
      verdict: "chase",
      ball: "them",
      daysQuiet: quiet,
      actOn: new Date(lastAny.getTime() + CHASE_DAY * DAY),
      due: true,
      label: `Quiet ${quiet} days, worth chasing`,
      tone: "urgent",
    };
  }

  if (quiet >= CHECK_IN_DAY) {
    return {
      verdict: "checkin",
      ball: "them",
      daysQuiet: quiet,
      actOn: new Date(lastAny.getTime() + CHECK_IN_DAY * DAY),
      due: true,
      label: `Quiet ${quiet} days, a short check-in is fine`,
      tone: "warn",
    };
  }

  const chaseOn = new Date(lastAny.getTime() + CHECK_IN_DAY * DAY);
  return {
    verdict: "wait",
    ball: "them",
    daysQuiet: quiet,
    actOn: chaseOn,
    due: false,
    label: `Quiet ${quiet} day${quiet === 1 ? "" : "s"}, too soon. Check in from ${onDay(chaseOn)}`,
    tone: "calm",
  };
}

/**
 * The rows a role carries, reduced to the four dates the cadence needs.
 *
 * Kept here, and pure, because the mapping is where the judgement calls live:
 * which correspondence counts as having gone out, which mail counts as a
 * reply, and which follow-up counts as a decision to wait. Putting it in a
 * page would give each page its own opinion.
 */
export function deriveFollowUpInput(
  role: {
    correspondence: { status: string; sentAt: Date | null; createdAt: Date }[];
    mailMessages: (SenderLike & { direction?: string | null; category?: string | null; receivedAt: Date })[];
    interviewNotes: { date: Date | null }[];
    followUps: { dueDate: Date | null; completed: boolean }[];
  },
  ownAddresses: Set<string>,
  now: Date
): FollowUpInput {
  // Both `sent` and `sent_externally` went out. The distinction matters to the
  // record (one has a Gmail id, the other is Dan's word) and not at all to
  // whether they have had time to answer.
  const outbound = role.correspondence
    .filter((c) => c.status === "sent" || c.status === "sent_externally")
    .map((c) => c.sentAt ?? c.createdAt);

  // His own sent mail already counts as outbound above, but the mailbox sync
  // also pulls notes he wrote by hand in Gmail, which exist nowhere else.
  for (const m of role.mailMessages) {
    if (m.direction === "sent") outbound.push(m.receivedAt);
  }

  const kinds = role.mailMessages.map((m) => ({ at: m.receivedAt, kind: inboundKind(m, ownAddresses) }));
  const answers = kinds.filter((k) => k.kind === "answer").map((k) => k.at);
  const contacts = kinds.filter((k) => k.kind === "contact").map((k) => k.at);

  const meetings = role.interviewNotes
    .map((n) => n.date)
    .filter((d): d is Date => d instanceof Date && d.getTime() > now.getTime());

  // A follow-up with no date is a backlog item, not a decision about timing,
  // so it must not silence a role. Only a date means "not until then".
  const waiting = role.followUps
    .filter((f) => !f.completed && f.dueDate instanceof Date)
    .map((f) => f.dueDate as Date)
    .filter((d) => d.getTime() > now.getTime());

  const newest = (ds: Date[]) => (ds.length ? new Date(Math.max(...ds.map((d) => d.getTime()))) : null);
  const soonest = (ds: Date[]) => (ds.length ? new Date(Math.min(...ds.map((d) => d.getTime()))) : null);

  return {
    lastOutbound: newest(outbound),
    lastInboundAnswer: newest(answers),
    lastInboundContact: newest(contacts),
    nextMeeting: soonest(meetings),
    waitingUntil: soonest(waiting),
    now,
  };
}
