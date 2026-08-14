import { describe, expect, it } from "vitest";
import { enforceHouseLanguage, toUSSpelling } from "./contact-block";

/**
 * The house language rules, which run over every word Dan sends to anyone.
 *
 * Two bugs lived in here undetected: a no-op rule that rebuilt `SPECIALIST` as
 * `SpecialisT`, and a `centre(s|d)?` pattern that would have turned `centred`
 * into `centerd`. Both were found by reading the code, not by running it,
 * which is the argument for this file.
 */
describe("toUSSpelling", () => {
  it("converts the spellings that actually reached documents", () => {
    expect(toUSSpelling("a single view of the traveller")).toBe("a single view of the traveler");
    expect(toUSSpelling("a true centre of excellence")).toBe("a true center of excellence");
    expect(toUSSpelling("contact-centre systems")).toBe("contact-center systems");
    expect(toUSSpelling("prioritisation and modernised and analyse")).toBe(
      "prioritization and modernized and analyze"
    );
  });

  it("handles centred, which drops an e the American form keeps", () => {
    expect(toUSSpelling("Name centred in navy")).toBe("Name centered in navy");
    expect(toUSSpelling("centring the block")).toBe("centering the block");
  });

  it("preserves all three capitalization forms", () => {
    // The old wrapper only asked "does it start with a capital", so an all-caps
    // word came back title-cased with the captured group's own case.
    expect(toUSSpelling("ORGANISATION in caps")).toBe("ORGANIZATION in caps");
    expect(toUSSpelling("Organisation title case")).toBe("Organization title case");
    expect(toUSSpelling("organisation lower")).toBe("organization lower");
  });

  it("leaves SPECIALIST alone in every case", () => {
    // Same on both sides of the Atlantic. A rule that replaced it with itself
    // corrupted the all-caps form.
    expect(toUSSpelling("SPECIALIST and specialist and Specialist")).toBe(
      "SPECIALIST and specialist and Specialist"
    );
  });

  it("does not touch words that merely end in -ise", () => {
    expect(toUSSpelling("expertise, promise and franchise")).toBe("expertise, promise and franchise");
  });
});

describe("enforceHouseLanguage", () => {
  it("removes em-dashes and en-dashes", () => {
    expect(enforceHouseLanguage("A sentence — with a dash — in it.")).toBe(
      "A sentence - with a dash - in it."
    );
  });

  it("writes a numeric range with a bare hyphen", () => {
    expect(enforceHouseLanguage("2013–2022")).toBe("2013-2022");
  });

  it("applies spelling and dashes together", () => {
    expect(enforceHouseLanguage("the centre — our organisation")).toBe("the center - our organization");
  });
});

describe("proper nouns are not spelling mistakes", () => {
  it("leaves a protected employer name alone", () => {
    // A Canadian employer uses "Centre" in its own department names, and Dan
    // is interviewing there. Renaming a company inside a letter addressed to
    // that company is worse than any spelling it would fix.
    expect(
      enforceHouseLanguage("Their Guest Experience Centre is excellent.", ["Guest Experience Centre"])
    ).toBe("Their Guest Experience Centre is excellent.");
  });

  it("still fixes the same word in his own prose", () => {
    expect(enforceHouseLanguage("I would centre the work on Centre Technologies.", ["Centre Technologies"])).toBe(
      "I would center the work on Centre Technologies."
    );
  });

  it("normalizes normally when nothing is protected", () => {
    expect(enforceHouseLanguage("Their Guest Experience Centre is excellent.")).toBe(
      "Their Guest Experience Center is excellent."
    );
  });

  it("matches a name whatever case it was written in", () => {
    expect(enforceHouseLanguage("we met LABOUR PARTY organisers", ["Labour Party"])).toBe(
      "we met LABOUR PARTY organizers"
    );
  });

  it("prefers the longest name, so an overlapping shorter one cannot half-consume it", () => {
    expect(
      enforceHouseLanguage("Centre Technologies Centre", ["Centre", "Centre Technologies Centre"])
    ).toBe("Centre Technologies Centre");
  });

  it("ignores tokens too short to be worth protecting", () => {
    // A two-character name would mask far too much text to be safe.
    expect(enforceHouseLanguage("the centre", ["ce"])).toBe("the center");
  });
});
