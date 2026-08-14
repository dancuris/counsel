/**
 * Demo mode: a public instance with fabricated data and no way out to the
 * world.
 *
 * The point is showing the app to somebody without exposing a live executive
 * job search - real recruiters, real salary conversations, a real mailbox. So
 * the demo runs on its **own database**, seeded by `scripts/seed-demo.ts` with
 * an invented candidate at invented companies. Nothing here is Dan's.
 *
 * Two independent things have to be true, and the belt-and-braces is
 * deliberate:
 *
 * 1. `DATABASE_URL` points somewhere else, so there is no path to his records.
 * 2. `DEMO_MODE` refuses every outbound action regardless of what the database
 *    holds - sending mail, writing to Drive, syncing a mailbox.
 *
 * Either alone would probably do. Together, a misconfigured environment
 * variable cannot email a stranger from Dan's account, which is the failure
 * that would actually matter. The guard is in the library functions rather
 * than the routes, so a new caller inherits it instead of having to remember.
 */

export const IS_DEMO = process.env.DEMO_MODE === "1";

/**
 * Thrown by anything that reaches the outside world. Callers already handle a
 * thrown error from these paths, so demo mode surfaces as a normal, visible
 * failure rather than a silent no-op that looks like a bug.
 */
export class DemoModeError extends Error {
  constructor(what: string) {
    super(`This is a demo, so ${what} is switched off. Everything else works on sample data.`);
    this.name = "DemoModeError";
  }
}

/** Call at the top of anything that touches a real account. */
export function refuseInDemo(what: string): void {
  if (IS_DEMO) throw new DemoModeError(what);
}

/**
 * The cheapest capable model, for demo mode only.
 *
 * Mocked responses were the other option and they are the wrong one: the
 * evaluation and the drafting ARE the product. Somebody trying the demo will
 * paste a job link and expect a real verdict, and a canned paragraph would
 * either be obviously fake or, worse, look real while being the same text for
 * every posting. Haiku is roughly a fifth the price of Opus per token and
 * still does the job visibly.
 */
export const DEMO_MODEL = "claude-haiku-4-5-20251001";

/**
 * How many AI-produced artifacts the demo may create in a day.
 *
 * The model choice reduces the cost per call. It does nothing about volume,
 * and volume is the actual exposure: the demo runs on Dan's API key, so an
 * open link is an open invoice. This is the cap that matters.
 *
 * Counted from rows the demo has actually written today rather than an
 * in-memory tally, which would reset on every cold start and cap nothing.
 */
export const DEMO_DAILY_CALLS = 60;

export class DemoBudgetError extends Error {
  constructor() {
    super(
      "The demo has used up today's allowance of AI generations. Everything already on the page still works. " +
        "It resets tomorrow."
    );
    this.name = "DemoBudgetError";
  }
}

/**
 * Refuses once the demo has produced `DEMO_DAILY_CALLS` artifacts today.
 *
 * Counted off rows the demo actually wrote - evaluations, documents, Ask
 * answers - rather than an in-process counter, which resets on every cold
 * start and therefore caps nothing on serverless.
 *
 * It is approximate on purpose. Two visitors generating at the same instant
 * can both pass the check; the point is to stop somebody sitting on the link
 * for an hour, not to be exact at the boundary.
 */
export async function assertDemoBudget(db: {
  evaluation: { count: (args: object) => Promise<number> };
  document: { count: (args: object) => Promise<number> };
  askLog: { count: (args: object) => Promise<number> };
}): Promise<void> {
  if (!IS_DEMO) return;

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [evaluations, documents, asks] = await Promise.all([
    db.evaluation.count({ where: { generatedAt: { gte: since } } }),
    db.document.count({ where: { generatedAt: { gte: since } } }),
    db.askLog.count({ where: { createdAt: { gte: since } } }),
  ]);

  if (evaluations + documents + asks >= DEMO_DAILY_CALLS) throw new DemoBudgetError();
}
