/**
 * Who a message is really from, and whether that is a person.
 *
 * This lived inside the Inbox page, where it decided whether to offer "add as
 * contact". The follow-up cadence needs the same answer for a different
 * reason, and it is the more consequential caller: if an ATS receipt counts as
 * a reply, every role Dan has applied to looks answered and the whole signal
 * goes quiet. Seventeen of his nineteen roles with any mail on them have a
 * robot as the most recent sender.
 *
 * Kept pure, with no Prisma types in the signature, so the rule can be
 * exercised against fabricated messages rather than his live pipeline.
 */

/**
 * Most senders in this mailbox are ATS robots (jobs-noreply@, +autoreply@,
 * myworkday.com). The test is deliberately loose: a false positive costs one
 * ignored button in the Inbox, and in the cadence it costs one role that waits
 * for a nudge it should have got. Both are cheaper than the opposite.
 */
const NO_REPLY = /(^|[.\-_+])(no-?reply|donotreply|auto-?reply|notification|mailer|bounce)([.\-_+@]|$)/i;

export type SenderLike = {
  fromEmail: string | null;
  /** Recovered original sender, where the message reached him as a forward. */
  forwardedFromEmail?: string | null;
};

/**
 * The address that actually wrote the message.
 *
 * Dan is the largest single sender in his own mailbox, because he forwarded
 * the back catalogue from his personal address. Reading `fromEmail` alone
 * credits him for every recruiter's email, which is how contact threading
 * managed to never once match.
 */
export function effectiveSender(m: SenderLike): string | null {
  const recovered = m.forwardedFromEmail?.trim().toLowerCase();
  if (recovered) return recovered;
  return m.fromEmail?.trim().toLowerCase() ?? null;
}

/**
 * Is this someone who could reply, as opposed to a system that emitted a
 * receipt? `own` holds Dan's own addresses: a forward of his own note names
 * him, and he is not a correspondent to himself.
 */
export function looksLikeAPerson(email: string | null, own: Set<string>): boolean {
  if (!email) return false;
  const addr = email.trim().toLowerCase();
  if (own.has(addr)) return false;
  if (NO_REPLY.test(addr)) return false;
  if (/@(myworkday|otp\.workday|talent\.icims|.*\.oracle)\.com$/i.test(addr)) return false;
  // a "Careers" sender is a department, but it is still a correspondent worth
  // tracking, so only the address disqualifies a sender, never the name.
  return true;
}

/**
 * Whether an incoming message needs an answer, merely happened, or is noise.
 *
 * This is the distinction the first version missed, and it was wrong on the
 * exact role Dan asked about. A search consultant wrote last on one
 * thread, so "they wrote last" was true - but the message was him thanking Dan
 * for the resume. Another employer's last word was "we will be in touch soon".
 * Neither owes an answer, and telling him he owed four replies he did not owe
 * would have burned the whole signal on its first morning.
 *
 * A category names the kind of message. It cannot tell you whether a sentence
 * inside it asked a question, so the classes are drawn where the category
 * genuinely does carry that:
 *
 * - **answer** - an invitation, an offer, or a recruiter making an approach.
 *   These are asking him something by their nature.
 * - **contact** - a real person was in the thread. It resets the clock on
 *   silence without claiming he is holding anything up.
 * - **noise** - a receipt, a rejection, a robot, or his own forward. Ignored
 *   completely, because seventeen of his nineteen roles with mail on them have
 *   one of these as the most recent sender.
 */
export type InboundKind = "answer" | "contact" | "noise";

/**
 * A department mailbox rather than a person: `careers@`, `recruiting@`,
 * `talent@`. These pass the no-reply test, because they are not literally
 * named no-reply, and American Express sends from one - an automated "Tricia
 * Rumola referred you" notice from `careers@recruitment.americanexpress.com`,
 * classified as recruiter outreach and owed no answer by anybody.
 *
 * It is deliberately not folded into `looksLikeAPerson`. The Inbox uses that to
 * decide whether to offer "add as contact", and a careers address is still
 * worth keeping as a correspondent. Only the stronger claim - that a human is
 * waiting on him - needs a named individual behind it.
 */
const ROLE_ACCOUNT =
  /^(careers?|recruit(ing|ment)?|talent|jobs?|hr|people|hiring|apply|applications?|resumes?|info|contact|support|admin|help|team|hello)([.\-_+]|@|$)/i;

function isRoleAccount(email: string): boolean {
  const local = email.split("@")[0] ?? "";
  return ROLE_ACCOUNT.test(local);
}

const DEMANDS_ANSWER = new Set(["interview_invite", "offer", "recruiter_outreach"]);
/** A real exchange, but not by itself a question. */
const REAL_CONTACT = new Set(["other_job_related"]);

export function inboundKind(
  m: SenderLike & { direction?: string | null; category?: string | null },
  own: Set<string>
): InboundKind {
  // His own sent mail, and his own forwards of his own notes, are him talking.
  if (m.direction === "sent") return "noise";
  if (!m.category) return "noise";
  const sender = effectiveSender(m);
  if (!looksLikeAPerson(sender, own)) return "noise";
  // A department mailbox can still be real contact worth counting against
  // silence; it just cannot be someone waiting on an answer.
  if (DEMANDS_ANSWER.has(m.category)) return sender && isRoleAccount(sender) ? "contact" : "answer";
  if (REAL_CONTACT.has(m.category)) return "contact";
  // application_confirmation, rejection, not_job_related.
  return "noise";
}
