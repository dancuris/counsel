import { describe, expect, it } from "vitest";
import { employersFrom, finishedEmployers, mostRecentEmployer, orderingRule, shortFormOf } from "@/lib/career";

/**
 * Fabricated resumes, not Dan's. The point of this module is that it works for
 * somebody whose career nobody has hardcoded, so the fixtures are somebody
 * else's on purpose.
 */

// The shape a person writes by hand: title first, dates on their own line.
const HAND_WRITTEN = `
## EXECUTIVE PROFILE
Operator.

## PROFESSIONAL EXPERIENCE

### Chief Technology Officer | Northwind Health
Mar 2021 to Present · Boston, MA
- Ran the platform.

### Director, Engineering | Contoso Logistics
Jun 2016 to Feb 2021 · Chicago, IL
- I own the delivery roadmap.

## EARLIER EXPERIENCE
- Senior Engineer, Fabrikam Systems (2012 to 2016)
- Analyst, Tailspin Toys (2010 to 2012)

## EDUCATION
- BSc, Somewhere
`;

// The shape this app generates: employer first, descriptor and dates after.
const GENERATED = `
## PROFESSIONAL EXPERIENCE

### Northwind Health | Regional insurer, Boston, MA :: Mar 2021 to Present
- Ran the platform.

### Contoso Logistics | Freight, Chicago, IL :: Jun 2016 to Feb 2021
- Shipped things.

## EARLIER EXPERIENCE
- Senior Engineer, Fabrikam Systems (2012 to 2016)
`;

describe("employersFrom", () => {
  it("reads the hand-written title-first shape", () => {
    const found = employersFrom(HAND_WRITTEN);
    expect(found.map((e) => e.name)).toEqual([
      "Northwind Health",
      "Contoso Logistics",
      "Fabrikam Systems",
      "Tailspin Toys",
    ]);
  });

  it("reads the generated employer-first shape", () => {
    // The regression that mattered: `masterResume` is generated, so a parser
    // that only knew the hand-written shape returned the descriptor
    // ("Regional insurer, Boston, MA") as the employer name.
    expect(employersFrom(GENERATED).map((e) => e.name)).toEqual([
      "Northwind Health",
      "Contoso Logistics",
      "Fabrikam Systems",
    ]);
  });

  it("strips dates written onto the employer's own line", () => {
    const tabbed = "### Head of Data | Globex Corp\tJan 2020 - Jun 2024";
    expect(employersFrom(tabbed).map((e) => e.name)).toEqual(["Globex Corp"]);
  });

  it("collapses two titles at one employer into a single entry", () => {
    const promoted = `
### Managing Director | Globex Corp
Jan 2024 to Present
### Director | Globex Corp
Jan 2020 to Dec 2023
`;
    const found = employersFrom(promoted);
    expect(found).toHaveLength(1);
    expect(found[0].titles).toEqual(["Managing Director", "Director"]);
  });

  it("marks an open-ended role as current and a dated one as finished", () => {
    const found = employersFrom(HAND_WRITTEN);
    expect(found[0]).toMatchObject({ name: "Northwind Health", current: true });
    expect(found[1]).toMatchObject({ name: "Contoso Logistics", current: false });
  });

  it("returns nothing rather than guessing when there is no experience section", () => {
    expect(employersFrom("## EDUCATION\n- BSc, Somewhere")).toEqual([]);
  });
});

describe("finishedEmployers", () => {
  it("excludes the employer the person still works for", () => {
    const finished = finishedEmployers(HAND_WRITTEN);
    expect(finished).not.toContain("Northwind Health");
    expect(finished).toContain("Contoso Logistics");
  });

  it("includes the short form prose actually uses", () => {
    // A cover letter says "at Contoso", never "at Contoso Logistics".
    expect(finishedEmployers(HAND_WRITTEN)).toContain("Contoso");
  });

  it("returns every employer for somebody between jobs", () => {
    // Dan's own case: his last role ended, so nothing is current and every
    // employer should read in the past tense.
    const betweenJobs = HAND_WRITTEN.replace("Mar 2021 to Present", "Mar 2021 to Jun 2026");
    expect(finishedEmployers(betweenJobs)).toContain("Northwind Health");
  });
});

describe("shortFormOf", () => {
  it("skips a lowercase holding-company prefix", () => {
    // "dentsu McGarryBowen" is referred to as McGarryBowen.
    expect(shortFormOf("dentsu McGarryBowen")).toBe("McGarryBowen");
  });

  it("returns null when the name is already one word", () => {
    expect(shortFormOf("Ogilvy")).toBeNull();
  });

  it("skips a weak leading word", () => {
    expect(shortFormOf("The Trade Desk")).toBe("Trade");
  });
});

describe("orderingRule", () => {
  it("names the employer to lead with", () => {
    expect(orderingRule(HAND_WRITTEN)).toContain("Northwind Health");
  });

  it("stays a valid instruction when no employer can be read", () => {
    // It must never fall back to naming an employer from anyone else's career,
    // which is the whole reason this module exists.
    const rule = orderingRule("");
    expect(rule).toContain("most recent employer FIRST");
    expect(rule).not.toContain("(that is");
  });
});

describe("mostRecentEmployer", () => {
  it("is null on an empty resume", () => {
    expect(mostRecentEmployer("")).toBeNull();
  });
});
