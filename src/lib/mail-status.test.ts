import { describe, expect, it } from "vitest";
import { statusForClosedPosting, statusFromMail, statusFromMeeting } from "./mail-status";

/**
 * What may move a role's stage, and what may never move it backwards.
 *
 * The never-regress shape is the whole safety property: an automatic rule that
 * walks a live opportunity back, or reopens a dead one, is worse than a rule
 * that does nothing.
 */
describe("statusFromMail", () => {
  it("moves an applied role forward on an interview invitation", () => {
    expect(statusFromMail("interview_invite", "APPLIED")?.next).toBe("INTERVIEWING");
  });

  it("records an application from its confirmation", () => {
    expect(statusFromMail("application_confirmation", "LIVE_POSTING_FOUND")?.next).toBe("APPLIED");
  });

  it("never walks a stage backwards", () => {
    // A confirmation arriving late for a role already interviewing is a stale
    // receipt, not a reason to undo the stage.
    expect(statusFromMail("application_confirmation", "INTERVIEWING")).toBeNull();
    expect(statusFromMail("interview_invite", "OFFER")).toBeNull();
  });

  it("never reopens a closed role", () => {
    // A "we will keep you in mind" follow-up must not resurrect it.
    expect(statusFromMail("interview_invite", "CLOSED_REJECTED")).toBeNull();
    expect(statusFromMail("application_confirmation", "CLOSED_REJECTED")).toBeNull();
  });

  it("ignores categories that state nothing about the stage", () => {
    // A recruiter approach says nothing reliable about where things stand.
    // This is precisely why one role sat on Applied with a call booked.
    expect(statusFromMail("recruiter_outreach", "APPLIED")).toBeNull();
    expect(statusFromMail("other_job_related", "APPLIED")).toBeNull();
    expect(statusFromMail(null, "APPLIED")).toBeNull();
  });
});

describe("statusFromMeeting", () => {
  it("moves an applied role to interviewing", () => {
    // A classification is a guess about what an email meant; a booked meeting
    // is a fact. This is the repair for the case above.
    expect(statusFromMeeting("APPLIED")?.next).toBe("INTERVIEWING");
    expect(statusFromMeeting("LIVE_POSTING_FOUND")?.next).toBe("INTERVIEWING");
    expect(statusFromMeeting("VERIFY")?.next).toBe("INTERVIEWING");
  });

  it("leaves a role that is already further along", () => {
    expect(statusFromMeeting("INTERVIEWING")).toBeNull();
    expect(statusFromMeeting("OFFER")).toBeNull();
  });

  it("does not resurrect a closed role from a stale diary entry", () => {
    expect(statusFromMeeting("CLOSED_REJECTED")).toBeNull();
    expect(statusFromMeeting("PASSED")).toBeNull();
  });
});

describe("statusForClosedPosting", () => {
  it("passes a role that was never applied to", () => {
    expect(statusForClosedPosting("TARGET")?.next).toBe("PASSED");
    expect(statusForClosedPosting("LIVE_POSTING_FOUND")?.next).toBe("PASSED");
  });

  it("never touches an application in flight", () => {
    // The United role Dan is interviewing for is closed on LinkedIn. Acting on
    // that would delete a live opportunity.
    expect(statusForClosedPosting("APPLIED")).toBeNull();
    expect(statusForClosedPosting("INTERVIEWING")).toBeNull();
    expect(statusForClosedPosting("OFFER")).toBeNull();
  });
});
