/**
 * Who somebody has worked for, read off their own resume.
 *
 * This exists because Dan's career was a constant in the source code:
 *
 *     const FINISHED_EMPLOYERS = ["Delta", "Charter", "McGarryBowen", "VML", "Ogilvy", "Deutsch"];
 *
 * and the generation prompts told the model to list "Delta first" and to open
 * an introduction letter "naming Delta Air Lines and Charter Communications".
 * On his instance that is correct and invisible. On anybody else's it instructs
 * the model to lead with an employer they have never worked at, which is the
 * worst class of fault this app has: it does not throw, it produces a
 * confident, well-formatted document that is a lie about someone's career.
 *
 * It is the same shape as the single-page rule that CLAUDE.md records living in
 * four places at once. **A fact about the person belongs in their data.** A
 * constant naming an employer is data wearing a constant.
 *
 * Pure on purpose, like `drive-match.ts` and `activity.ts`: the parsing rules
 * decide what goes on a resume, so they are tested against fabricated text
 * rather than by generating documents against a live profile.
 */

export type Employer = {
  name: string;
  /** Job titles held there, most recent first. */
  titles: string[];
  /** True when a role there has no end date: "to Present", "to Current". */
  current: boolean;
  /**
   * True when it appeared under EARLIER EXPERIENCE, the compressed list at the
   * bottom rather than a full role block. Prose treats the two differently:
   * an introduction letter names the recent employers and then says "and
   * earlier, at ...", so the sentence needs to know which is which.
   */
  earlier: boolean;
};

/** Common words that make a poor short form on their own. */
const WEAK_SHORT_FORMS = new Set(["the", "and", "for", "group", "global", "north", "united"]);

/**
 * A shorter name the same employer is likely to be called in prose.
 *
 * The tense rewriter matches employer names inside sentences, and a cover
 * letter says "at Delta", never "at Delta Air Lines, Inc." So each employer
 * contributes both forms. A lowercase first word is skipped because that is
 * how agency holding companies are written: "dentsu McGarryBowen" is referred
 * to as McGarryBowen.
 */
export function shortFormOf(name: string): string | null {
  for (const word of name.split(/\s+/)) {
    const bare = word.replace(/[^A-Za-z0-9&]/g, "");
    if (bare.length < 4) continue;
    if (WEAK_SHORT_FORMS.has(bare.toLowerCase())) continue;
    // Lowercase words are not the recognizable part of the name.
    if (bare[0] !== bare[0].toUpperCase()) continue;
    return bare === name ? null : bare;
  }
  return null;
}

const CURRENT_ROLE = /\b(?:to|-|–)\s*(present|current|now)\b/i;

/**
 * Dates written onto the same line as the employer, in any of the three shapes
 * the real documents use: a tab before them, a ` :: ` separator, or a bare
 * "Aug 2022 to Jun 2026" trailing the name.
 */
function withoutDates(segment: string): string {
  return segment
    .split("\t")[0]
    .split(" :: ")[0]
    .replace(/\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{4}\s*(?:to|-|–)[\s\S]*$/i, "")
    .replace(/\s*[·|,]\s*$/, "")
    .trim();
}

/**
 * Every employer named in a base resume, most recent first.
 *
 * Two shapes are read, because the base variants use both:
 *
 *   ### Vice President, Digital Marketing | Charter Communications
 *   Jan 2013 to May 2022 · Stamford, CT
 *
 * and, under EARLIER EXPERIENCE, a compressed list:
 *
 *   - Group Technology Director, VML (2010 to 2011)
 *
 * Anything it cannot parse is skipped rather than guessed at. A wrong employer
 * name is worse than a missing one: it would put a past-tense rewrite on the
 * role somebody currently holds.
 */
export function employersFrom(resume: string): Employer[] {
  const found: Employer[] = [];
  const byName = new Map<string, Employer>();

  const add = (rawName: string, title: string, current: boolean, earlier: boolean) => {
    const name = withoutDates(rawName);
    if (!name || name.length > 80) return;
    const existing = byName.get(name.toLowerCase());
    if (existing) {
      if (title) existing.titles.push(title);
      existing.current ||= current;
      return;
    }
    const employer: Employer = { name, titles: title ? [title] : [], current, earlier };
    byName.set(name.toLowerCase(), employer);
    found.push(employer);
  };

  const lines = resume.split("\n");
  let inEarlier = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (/^##\s+EARLIER EXPERIENCE/i.test(line)) {
      inEarlier = true;
      continue;
    }
    if (/^##\s+(EDUCATION|SKILLS|CERTIFICATION)/i.test(line)) {
      inEarlier = false;
      continue;
    }

    // Two heading shapes, and which side the employer sits on differs.
    //
    // The base variants somebody writes by hand put the title first:
    //     ### Vice President, Digital Marketing | Charter Communications
    //
    // Generated resumes put the employer first, followed by a descriptor and
    // the dates, because that is what the generation schema asks for:
    //     ### Delta Air Lines | Global carrier, Atlanta, GA :: Aug 2022 to Jun 2026
    //
    // Reading both is not optional: `masterResume` is itself generated, so a
    // parser that only understood the hand-written shape returned "Global
    // carrier, Atlanta, GA" as an employer name and missed Delta entirely.
    if (/^###\s+/.test(line) && line.includes("|")) {
      const parts = line.replace(/^###\s+/, "").split("|");
      const last = parts[parts.length - 1];
      const employerFirst = parts.length >= 2 && / :: /.test(last);
      const employer = employerFirst ? parts[0] : last;
      const title = employerFirst ? "" : parts.slice(0, -1).join("|").trim();
      // The role is current when its own date line says so. Look at the next
      // couple of lines only: further down belongs to another role.
      const window = `${line}\n${lines[i + 1] ?? ""}\n${lines[i + 2] ?? ""}`;
      add(employer, title, CURRENT_ROLE.test(window), false);
      continue;
    }

    // "- Title, Employer (2010 to 2011)" in the compressed list.
    if (inEarlier && /^[-*]\s+/.test(line)) {
      const withoutYears = line.replace(/^[-*]\s+/, "").split("(")[0].trim();
      const comma = withoutYears.lastIndexOf(",");
      if (comma === -1) continue;
      add(withoutYears.slice(comma + 1), withoutYears.slice(0, comma).trim(), false, true);
    }
  }

  return found;
}

/**
 * Names to treat as past tense, including the short forms prose actually uses.
 *
 * An employer counts as finished when no role there is open-ended. Somebody
 * between jobs has no current employer and every name comes back, which is
 * exactly right and is Dan's own case: his last role ended in June.
 */
export function finishedEmployers(resume: string): string[] {
  const names: string[] = [];
  for (const employer of employersFrom(resume)) {
    if (employer.current) continue;
    names.push(employer.name);
    const short = shortFormOf(employer.name);
    if (short) names.push(short);
  }
  return names;
}

/** Joins names the way prose does: "A", "A and B", "A, B and C". */
export function nameList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The employers to name when a letter places somebody, split the way a
 * sentence about them is built.
 *
 * The introduction letter used to hardcode "naming Delta Air Lines and Charter
 * Communications, AND agency experience before that at dentsu McGarryBowen,
 * VML and Ogilvy". That is one person's career written into a prompt, and the
 * structure underneath it is general: name the substantial recent employers,
 * then the earlier ones, because the earlier ones are what usually get left
 * out and are often the reason somebody can talk to two audiences at once.
 */
export function placementNames(resume: string): { recent: string[]; earlier: string[] } {
  const employers = employersFrom(resume);
  return {
    recent: employers.filter((e) => !e.earlier).map((e) => e.name),
    earlier: employers.filter((e) => e.earlier).map((e) => e.name),
  };
}

/**
 * How to group titles under employers, stated from the data.
 *
 * The rule is general - an employer with several titles gets one block with
 * the titles nested, an employer with one puts it on the company line - but it
 * was written as "Nest the two Delta titles under one Delta block; Charter's
 * single title goes on its company line", which only instructs Dan's instance.
 */
export function nestingRule(resume: string): string {
  const multi = employersFrom(resume).filter((e) => !e.earlier && e.titles.length > 1);
  const base =
    "Where one employer holds several titles, give it ONE employer block with the titles nested inside it. Where an employer holds a single title, that title goes on its company line.";
  return multi.length ? `${base} Here that applies to ${nameList(multi.map((e) => e.name))}.` : base;
}

/** The employer a resume should lead with, or null when none can be read. */
export function mostRecentEmployer(resume: string): string | null {
  return employersFrom(resume)[0]?.name ?? null;
}

/**
 * The ordering instruction handed to the model, built from the resume itself.
 *
 * The prompts used to say "Delta listed FIRST in reverse-chronological order",
 * which is one true statement about Dan wrapped around one universal rule. The
 * universal half is kept and the name is interpolated, so the instruction is
 * equally specific on any instance and never names the wrong company.
 */
export function orderingRule(resume: string): string {
  const first = mostRecentEmployer(resume);
  return first
    ? `Reverse chronological order, most recent employer FIRST (that is ${first}).`
    : "Reverse chronological order, most recent employer FIRST.";
}
