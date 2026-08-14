import { describe, expect, it } from "vitest";
import { CHASE_DAY, CHECK_IN_DAY, followUpState, type FollowUpInput } from "./follow-up-state";

/**
 * The cadence, which is the app's only genuinely opinionated rule.
 *
 * Its first version asserted four replies owed and would have been wrong about
 * all four on its first morning, so the branch order and the "is there anyone
 * to chase" guard are the parts worth pinning down. The constants are read
 * from the module rather than restated, so changing the cadence changes the
 * tests with it instead of breaking them.
 */
const NOW = new Date("2026-08-13T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const daysAhead = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function input(over: Partial<FollowUpInput> = {}): FollowUpInput {
  return {
    lastOutbound: null,
    lastInboundAnswer: null,
    lastInboundContact: null,
    nextMeeting: null,
    waitingUntil: null,
    now: NOW,
    ...over,
  };
}

describe("branch order, strongest statement first", () => {
  it("a dated follow-up outranks a booked meeting", () => {
    const s = followUpState(input({ waitingUntil: daysAhead(3), nextMeeting: daysAhead(1) }));
    expect(s.verdict).toBe("snoozed");
  });

  it("a booked meeting outranks an unanswered question", () => {
    const s = followUpState(input({ nextMeeting: daysAhead(1), lastInboundAnswer: daysAgo(20) }));
    expect(s.verdict).toBe("booked");
  });

  it("an unanswered question outranks a day count", () => {
    const s = followUpState(input({ lastInboundAnswer: daysAgo(20), lastOutbound: daysAgo(30) }));
    expect(s.verdict).toBe("reply");
    expect(s.ball).toBe("you");
  });
});

describe("the day thresholds", () => {
  it("waits below the check-in day", () => {
    const s = followUpState(input({ lastOutbound: daysAgo(CHECK_IN_DAY - 1) }));
    expect(s.verdict).toBe("wait");
  });

  it("permits a check-in on the check-in day", () => {
    const s = followUpState(input({ lastOutbound: daysAgo(CHECK_IN_DAY) }));
    expect(s.verdict).toBe("checkin");
  });

  it("still only checks in on the chase day itself", () => {
    // The rule is "past CHASE_DAY", not "on it", so day 10 is the last day of
    // the check-in window. Worth pinning: the constant is named for the day
    // chasing begins, which reads as inclusive and is not.
    expect(followUpState(input({ lastOutbound: daysAgo(CHASE_DAY) })).verdict).toBe("checkin");
  });

  it("calls for a chase the day after", () => {
    expect(followUpState(input({ lastOutbound: daysAgo(CHASE_DAY + 1) })).verdict).toBe("chase");
  });

  it("states the real number of days, never a rounded phrase", () => {
    // The Ask route once turned six days into "a full week" because Dan framed
    // it that way. The state object carries the figure so prose cannot drift.
    expect(followUpState(input({ lastOutbound: daysAgo(6) })).daysQuiet).toBe(6);
  });
});

describe("a chase needs somebody to chase", () => {
  it("does not tell him to check in when only a robot has written", () => {
    // 17 of the 19 roles with any mail have a no-reply address as their most
    // recent sender. A loose rule reports the whole pipeline as actionable.
    const s = followUpState(input({ lastInboundContact: daysAgo(20) }));
    expect(s.verdict).toBe("noreply");
    expect(s.due).toBe(false);
  });

  it("does chase when he has actually written to someone", () => {
    const s = followUpState(input({ lastOutbound: daysAgo(20) }));
    expect(s.verdict).toBe("chase");
  });

  it("counts a named person writing in as a correspondent", () => {
    const s = followUpState(input({ lastInboundAnswer: daysAgo(20) }));
    expect(s.verdict).toBe("reply");
  });
});

describe("a snooze actually silences", () => {
  it("is not due while the follow-up date is still ahead", () => {
    expect(followUpState(input({ waitingUntil: daysAhead(5), lastOutbound: daysAgo(30) })).due).toBe(false);
  });

  it("becomes due once the date arrives", () => {
    expect(followUpState(input({ waitingUntil: daysAgo(1), lastOutbound: daysAgo(30) })).due).toBe(true);
  });
});

describe("nothing has happened at all", () => {
  it("reports no day count rather than zero", () => {
    expect(followUpState(input()).daysQuiet).toBeNull();
  });
});
