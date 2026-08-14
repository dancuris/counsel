import { describe, expect, it } from "vitest";
import { parseWorkday, splitAddress, toMonthYear } from "./workday";

/**
 * Reading a resume variant into the boxes a Workday application asks for.
 *
 * The format is fixed by the generator, which makes it parseable - and makes a
 * silent parse failure expensive, because a missing role on this page is a
 * role Dan retypes by hand without noticing it was meant to be there.
 */
const VARIANT = `## EXECUTIVE PROFILE
Some prose about the candidate.

## CORE EXPERTISE
Customer Journey Design · Marketing Technology · Org Design

Platforms & Tools: Adobe Experience Cloud; Salesforce Marketing Cloud; Workfront

## PROFESSIONAL EXPERIENCE
### Managing Director, Marketing Strategy | Delta Air Lines
Jan 2026 to Jun 2026 · Atlanta, GA
> Marketing Strategy · Marketing Budget
- Owned the enterprise roadmap and a **$400M+** portfolio.
- Established the operating model for AI-enabled capabilities.

### Director, Marketing Operations | Delta Air Lines
Aug 2022 to Dec 2025 · Atlanta, GA
- Built the customer-data ecosystem.

| dentsu McGarryBowen · VML · Ogilvy
Jan 2008 to Jan 2013 · New York, NY
- Led delivery teams for Fortune 500 brands.

## EARLIER EXPERIENCE
- Group Technology Director, VML (2010 to 2011)
- Web Program Manager, LEGO Systems (2001 to 2003)

## EDUCATION
Boston College, Carroll School of Management · B.S., Management Information Systems
`;

describe("toMonthYear", () => {
  it("converts to the MM/YYYY Workday's boxes accept", () => {
    expect(toMonthYear("Aug 2022")).toBe("08/2022");
    expect(toMonthYear("January 2013")).toBe("01/2013");
  });

  it("returns nothing for a current role", () => {
    expect(toMonthYear("Present")).toBe("");
    expect(toMonthYear("")).toBe("");
  });

  it("keeps a bare year rather than inventing a month", () => {
    expect(toMonthYear("2013")).toBe("2013");
  });
});

describe("splitAddress", () => {
  it("splits a full US address into Workday's four boxes", () => {
    expect(splitAddress("12 Harbor Road, Southport, CT 06890")).toMatchObject({
      line1: "12 Harbor Road",
      city: "Southport",
      state: "CT",
      postal: "06890",
    });
  });

  it("copes with no postal code", () => {
    expect(splitAddress("Southport, CT")).toMatchObject({ city: "Southport", state: "CT", postal: "" });
  });

  it("puts an unsplittable value in line 1 rather than guessing", () => {
    // Guessing wrong here is worse than leaving it: the page shows the whole
    // line beside the parts so a bad split is visible before it is pasted.
    expect(splitAddress("New York City Metro Area").line1).toBe("New York City Metro Area");
  });
});

describe("parseWorkday", () => {
  const parsed = parseWorkday(VARIANT);

  it("finds every role, including the untitled agency block", () => {
    // A missing decade is far worse than a blank Job Title box.
    expect(parsed.roles.length).toBe(3);
    expect(parsed.roles.map((r) => r.employer)).toEqual([
      "Delta Air Lines",
      "Delta Air Lines",
      "dentsu McGarryBowen · VML · Ogilvy",
    ]);
  });

  it("reads title, location and both dates", () => {
    expect(parsed.roles[0]).toMatchObject({
      title: "Managing Director, Marketing Strategy",
      location: "Atlanta, GA",
      start: "01/2026",
      end: "06/2026",
      current: false,
    });
  });

  it("keeps the agency block with an empty title rather than dropping it", () => {
    expect(parsed.roles[2].title).toBe("");
    expect(parsed.roles[2].start).toBe("01/2008");
  });

  it("strips markdown emphasis, which a Workday textarea renders literally", () => {
    expect(parsed.roles[0].description).toContain("$400M+");
    expect(parsed.roles[0].description).not.toContain("**");
  });

  it("keeps the scope line, which has no Workday field of its own", () => {
    expect(parsed.roles[0].description).toContain("Marketing Strategy · Marketing Budget");
  });

  it("splits education into school, degree and field", () => {
    expect(parsed.education[0]).toMatchObject({
      school: "Boston College, Carroll School of Management",
      degree: "B.S.",
      field: "Management Information Systems",
    });
  });

  it("lists skills individually, because Workday adds them one at a time", () => {
    expect(parsed.skills).toContain("Customer Journey Design");
    expect(parsed.skills).toContain("Workfront");
  });

  it("keeps earlier experience separate from the main roles", () => {
    expect(parsed.earlier.length).toBe(2);
    expect(parsed.earlier[0]).toContain("Group Technology Director");
  });

  it("applies US spelling on the way out", () => {
    // This page reads variants raw and puts them in front of an employer, so
    // it has to enforce the same rule generation does.
    const out = parseWorkday(VARIANT.replace("Built the customer-data ecosystem.", "Built a centre of excellence."));
    expect(out.roles[1].description).toContain("center of excellence");
  });

  it("returns empty structures for an empty variant rather than throwing", () => {
    const empty = parseWorkday("");
    expect(empty.roles).toEqual([]);
    expect(empty.education).toEqual([]);
  });
});
