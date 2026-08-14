/**
 * The terms somebody accepts when they claim an instance.
 *
 * The LICENSE file is the instrument; this is the acknowledgment that it was
 * read. Keeping the wording here rather than in the form means the claim page,
 * the invite email and the recorded version cannot drift apart, and bumping
 * `LICENSE_VERSION` makes every future claim record which text was shown.
 *
 * The data sentence is deliberately the second half. It is the reciprocal of
 * the first: the author keeps the software, the person keeps everything they
 * put into it, and neither is left to inference.
 */

export const LICENSE_VERSION = "2026-08-1";

export const AUTHOR = "Dan Curis";

/** Shown beside the checkbox on the claim form. Short enough to actually read. */
export const ACKNOWLEDGMENT =
  `I understand this software was built by ${AUTHOR} and remains their intellectual property, ` +
  "licensed to me for a single personal instance and not for redistribution or commercial use.";

/**
 * Stated wherever somebody is about to commit their job search to an instance.
 *
 * Only true when they deployed it themselves, which is why it is phrased about
 * the account rather than about intentions.
 */
export const DATA_STATEMENT =
  "This instance runs on your own accounts, against a database you created. Everything you put into it " +
  `is yours, and ${AUTHOR} holds no credentials to it and cannot read your job search.`;
