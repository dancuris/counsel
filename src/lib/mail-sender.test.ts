import { describe, expect, it } from "vitest";
import { effectiveSender, inboundKind, looksLikeAPerson } from "./mail-sender";

/**
 * Who wrote a message, and whether it is asking anything.
 *
 * The stakes: 17 of the 19 roles with any mail have a robot as their most
 * recent sender, so a loose reading of "they wrote last" reports the entire
 * pipeline as owing a reply and the signal dies on its first morning. The
 * first version did exactly that on four roles.
 */
const OWN = new Set(["owner@example.com", "owner.search@example.com"]);

describe("effectiveSender", () => {
  it("recovers the original sender from a forward", () => {
    // Dan forwarded his back catalogue to himself, which made him the largest
    // single sender in his own mailbox and stopped contact threading matching.
    expect(
      effectiveSender({ fromEmail: "owner@example.com", forwardedFromEmail: "tom@examplesearch.com" })
    ).toBe("tom@examplesearch.com");
  });

  it("falls back to the envelope sender", () => {
    expect(effectiveSender({ fromEmail: "Tom@ExampleSearch.com" })).toBe("tom@examplesearch.com");
  });

  it("returns null when there is no sender at all", () => {
    expect(effectiveSender({ fromEmail: null })).toBeNull();
  });
});

describe("looksLikeAPerson", () => {
  it("excludes Dan's own addresses", () => {
    expect(looksLikeAPerson("owner@example.com", OWN)).toBe(false);
  });

  it("excludes no-reply shapes", () => {
    for (const a of ["jobs-noreply@company.com", "no-reply@x.com", "auto-reply@x.com", "mailer@x.com"]) {
      expect(looksLikeAPerson(a, OWN), a).toBe(false);
    }
  });

  it("excludes the ATS domains", () => {
    for (const a of ["x@myworkday.com", "x@talent.icims.com", "req@something.oracle.com"]) {
      expect(looksLikeAPerson(a, OWN), a).toBe(false);
    }
  });

  it("accepts a real person", () => {
    expect(looksLikeAPerson("dana.whitfield@example.com", OWN)).toBe(true);
  });

  it("accepts a department mailbox, which is still a correspondent", () => {
    // a "Careers" display name is not a human but it is a thread worth tracking, so only
    // the address disqualifies a sender and never the display name.
    expect(looksLikeAPerson("careers@recruitment.americanexpress.com", OWN)).toBe(true);
  });
});

describe("inboundKind", () => {
  const from = (fromEmail: string, category: string, direction = "received") =>
    inboundKind({ fromEmail, category, direction }, OWN);

  it("treats an invitation from a person as asking something", () => {
    expect(from("sam@examplehotels.com", "interview_invite")).toBe("answer");
  });

  it("downgrades the same invitation from a department mailbox", () => {
    // A role account cannot be waiting on an answer. Left as "answer", a role account
    // read as owing a reply with nobody to reply to.
    expect(from("careers@recruitment.americanexpress.com", "interview_invite")).toBe("contact");
  });

  it("counts an ordinary exchange as contact, not as a question", () => {
    // Brian thanking Dan for the resume resets the clock without meaning he
    // owes anything. This is the case the first version got wrong.
    expect(from("tom@examplesearch.com", "other_job_related")).toBe("contact");
  });

  it("treats receipts and rejections as noise", () => {
    expect(from("x@company.com", "application_confirmation")).toBe("noise");
    expect(from("x@company.com", "rejection")).toBe("noise");
    expect(from("x@company.com", "not_job_related")).toBe("noise");
  });

  it("treats Dan's own sent mail as noise", () => {
    expect(from("owner@example.com", "recruiter_outreach", "sent")).toBe("noise");
  });

  it("treats an unclassified message as noise rather than guessing", () => {
    expect(inboundKind({ fromEmail: "x@y.com", category: null, direction: "received" }, OWN)).toBe("noise");
  });
});
