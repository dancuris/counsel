import { describe, expect, it } from "vitest";
import { fromDateOnlyInput, fromEasternInput, fromIsoInstant, toEasternInput } from "./local-time";

/**
 * The most expensive bug this app has shipped, so it gets the most tests.
 *
 * A recruiter wrote "tomorrow at 1:30pm EST". The parse was right, the form
 * showed 1:30pm, and the action stored 9:30am, because a `datetime-local`
 * value carries no offset and `new Date()` read it in the runtime's zone. It
 * reached the dashboard and the real Google Calendar entry.
 *
 * These ran as a throwaway script the day it was fixed and were then deleted,
 * which is exactly the gap this file closes.
 */
describe("fromEasternInput", () => {
  it("reads a summer wall clock as Eastern Daylight Time", () => {
    // The real case: 1:30pm ET on 13 Aug is 17:30Z, not 13:30Z.
    expect(fromEasternInput("2026-08-13T13:30")?.toISOString()).toBe("2026-08-13T17:30:00.000Z");
  });

  it("reads a winter wall clock as Eastern Standard Time", () => {
    expect(fromEasternInput("2026-01-15T13:30")?.toISOString()).toBe("2026-01-15T18:30:00.000Z");
  });

  it("resolves the hour after the spring forward", () => {
    expect(fromEasternInput("2026-03-08T03:30")?.toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });

  it("resolves an hour inside the autumn repeat", () => {
    expect(fromEasternInput("2026-11-01T01:30")?.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("refuses anything that is not a datetime-local value", () => {
    expect(fromEasternInput("")).toBeNull();
    expect(fromEasternInput("2026-08-13")).toBeNull();
    expect(fromEasternInput("nonsense")).toBeNull();
  });
});

describe("toEasternInput", () => {
  it("round-trips every boundary case", () => {
    for (const value of ["2026-08-13T13:30", "2026-01-15T13:30", "2026-03-08T03:30", "2026-11-01T01:30"]) {
      expect(toEasternInput(fromEasternInput(value)!)).toBe(value);
    }
  });

  it("renders midnight as 00 rather than 24", () => {
    // `hour12: false` emits 24 for midnight in some engines, which would
    // produce an invalid datetime-local value and silently blank the field.
    expect(toEasternInput(new Date("2026-08-13T04:00:00.000Z"))).toBe("2026-08-13T00:00");
  });
});

describe("fromDateOnlyInput", () => {
  it("stores a calendar day as UTC midnight, matching formatDate's UTC rendering", () => {
    expect(fromDateOnlyInput("2026-08-13")?.toISOString()).toBe("2026-08-13T00:00:00.000Z");
  });

  it("refuses a datetime-local value, which belongs to fromEasternInput", () => {
    expect(fromDateOnlyInput("2026-08-13T13:30")).toBeNull();
    expect(fromDateOnlyInput("")).toBeNull();
  });
});

describe("fromIsoInstant", () => {
  it("keeps the offset a full ISO string already carries", () => {
    expect(fromIsoInstant("2026-08-13T17:30:00.000Z")?.toISOString()).toBe("2026-08-13T17:30:00.000Z");
    expect(fromIsoInstant("2026-08-13T13:30:00-04:00")?.toISOString()).toBe("2026-08-13T17:30:00.000Z");
  });

  it("returns null rather than an Invalid Date", () => {
    expect(fromIsoInstant("not a date")).toBeNull();
  });
});
