import { describe, expect, it } from "vitest";
import { groupContacts, recruiterFirst, surnameFirst, type ContactRow } from "./contact-grouping";

/**
 * Grouping the people, which is where an employer and a relevance get confused.
 *
 * `CLAUDE.md` says writing a test here "immediately found two bugs in
 * surnameFirst". That test never existed as a file; it was a script run once.
 * These are the cases it describes, now actually pinned.
 */
describe("surnameFirst", () => {
  it("inverts an ordinary name", () => {
    expect(surnameFirst("Gail Dielman")).toBe("Dielman, Gail");
  });

  it("keeps a multi-word particle with the surname", () => {
    // Only the first word of the particle was listed, so this came back as
    // "Berg, Jan van der" with the particle stranded across the comma.
    expect(surnameFirst("Jan van der Berg")).toBe("van der Berg, Jan");
  });

  it("leaves a name that is already surname-first alone", () => {
    // How corporate directories emit them, and how Jennifer's name arrived.
    // Inverting a second time produced "KAREN, HALVORSEN,".
    expect(surnameFirst("HALVORSEN, KAREN")).toBe("HALVORSEN, KAREN");
  });

  it("leaves a single word alone", () => {
    expect(surnameFirst("Cher")).toBe("Cher");
  });
});

function row(over: Partial<ContactRow> = {}): ContactRow {
  return {
    id: Math.random().toString(36).slice(2),
    name: "A Person",
    role: null,
    email: null,
    where: "Somewhere",
    relatesTo: null,
    relatedRole: null,
    nextAction: null,
    messages: 0,
    ...over,
  };
}

describe("groupContacts", () => {
  it("groups by employer", () => {
    const groups = groupContacts(
      [row({ name: "A", where: "AT&T" }), row({ name: "B", where: "AT&T" }), row({ name: "C", where: "Delta" })],
      true
    );
    expect(groups.map((g) => g.label).sort()).toEqual(["AT&T", "Delta"]);
  });

  it("adds a role tier only where one employer holds people against more than one role", () => {
    // The rule has to appear on its own when the data changes. Reasoning from
    // "only AT&T needs it today" is right this week and wrong as soon as a
    // second role gets tracked anywhere.
    const oneRole = groupContacts([row({ where: "Delta", relatedRole: "VP Marketing" })], true);
    expect(oneRole[0].subgroups.length).toBe(1);

    const twoRoles = groupContacts(
      [row({ where: "AT&T", relatedRole: "AVP Analytics" }), row({ where: "AT&T", relatedRole: "AVP Planning" })],
      true
    );
    expect(twoRoles[0].subgroups.length).toBe(2);
  });
});

describe("recruiterFirst", () => {
  it("sorts the recruiter ahead of the incumbent", () => {
    // "Write to them" filled with contacts[0] and picked the hiring-side
    // contact over the recruiter who owns the process.
    const sorted = recruiterFirst([
      { role: "Vice President, Marketing" },
      { role: "Senior Recruiter" },
    ]);
    expect(sorted[0].role).toBe("Senior Recruiter");
  });

  it("leaves the order alone when nobody is a recruiter", () => {
    const input = [{ role: "CMO" }, { role: "VP Marketing" }];
    expect(recruiterFirst(input).map((c) => c.role)).toEqual(["CMO", "VP Marketing"]);
  });
});
