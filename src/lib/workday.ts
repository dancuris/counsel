/**
 * The resume, rearranged into the boxes Workday actually asks for.
 *
 * Workday's resume parser mangles Dan's resume every time, so every
 * application means retyping the same career into the same twenty fields. The
 * upload is not the problem to solve - the parser is theirs and cannot be
 * fixed from here. What can be fixed is the retyping: the facts already exist,
 * structured, in the resume variants, and they are being read off a PDF by
 * hand because nothing ever presented them as fields.
 *
 * So this is a transformation, not a new source of truth. Everything comes out
 * of the chosen variant and the Profile row, which means it cannot drift from
 * the resume he actually sends. When the career changes, the variants change,
 * and this changes with them.
 *
 * Pure, and takes the variant text as a string, so the shapes are testable
 * without a database - same reasoning as `drive-match.ts`, `activity.ts` and
 * `contact-grouping.ts`.
 *
 * House spelling is applied on the way out. Generation already normalises what
 * it writes, so the resumes that get attached were always clean; a British
 * spelling sitting in a variant reached nobody until this page started reading
 * variants directly and putting them in front of an employer. A surface that
 * renders source text for pasting has to enforce the same rule the generator
 * does, or it becomes the one route around it.
 */

import { toUSSpelling } from "@/lib/contact-block";

export type WorkdayRole = {
  title: string;
  employer: string;
  location: string;
  /** As written on the resume, e.g. "Aug 2022". */
  startLabel: string;
  endLabel: string;
  /** MM/YYYY, which is the format Workday's date boxes want. */
  start: string;
  end: string;
  current: boolean;
  /** The bullets, as plain lines. Workday's description box is not markdown. */
  description: string;
};

export type WorkdayEducation = {
  school: string;
  degree: string;
  field: string;
};

export type WorkdayProfile = {
  roles: WorkdayRole[];
  education: WorkdayEducation[];
  /** "Core expertise", split into the individual skills Workday adds one by one. */
  skills: string[];
  earlier: string[];
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export type WorkdayAddress = { line1: string; city: string; state: string; postal: string; country: string };

/**
 * One address string, split into the four boxes Workday insists on.
 *
 * The Profile stores addresses as single lines because that is how they appear
 * on a resume header. Workday will not take a line: it wants street, city,
 * state and postal code separately, and refuses to advance the form until each
 * is filled. Splitting is guessy, so anything it cannot work out comes back
 * empty and the page shows the whole line beside the parts, which lets a bad
 * split be spotted rather than pasted.
 */
export function splitAddress(value: string): WorkdayAddress {
  const empty = { line1: "", city: "", state: "", postal: "", country: "United States of America" };
  const parts = value.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return { ...empty, line1: value.trim() };

  // The tail is usually "CT 06890" or just "CT".
  const tail = parts[parts.length - 1];
  const stateZip = tail.match(/^([A-Za-z .]+?)\s*(\d{5}(?:-\d{4})?)?$/);
  const state = stateZip ? stateZip[1].trim() : "";
  const postal = stateZip?.[2] ?? "";

  return {
    ...empty,
    line1: parts.slice(0, -2).join(", "),
    city: parts.length >= 2 ? parts[parts.length - 2] : "",
    state,
    postal,
  };
}

/** "Aug 2022" to "08/2022". Workday's boxes are month and year, nothing else. */
export function toMonthYear(label: string): string {
  const t = label.trim().toLowerCase();
  if (!t || /^(present|current|now)$/.test(t)) return "";
  const year = t.match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
  const month = MONTHS.findIndex((m) => t.includes(m));
  if (!year) return "";
  return month >= 0 ? `${String(month + 1).padStart(2, "0")}/${year}` : year;
}

/**
 * Markdown out, plain text in.
 *
 * The variants carry `**bold**` on the bullets that must never be dropped, and
 * a Workday textarea renders those asterisks literally. The emphasis was a
 * signal for the resume generator, not for the employer.
 */
function plain(line: string): string {
  return line
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^[-*]\s+/, "")
    .trim();
}

/**
 * Reads the variant into Workday's fields.
 *
 * The heading format is fixed by the generator - `### Title | Employer`, dates
 * and location on the line beneath, an optional `>` scope line, then bullets.
 * One entry in the real data breaks it: the agency block is written as
 * `| dentsu McGarryBowen · VML · Ogilvy` with no title before the pipe. That is
 * a genuine employer group with no single title, so it is kept with an empty
 * title rather than dropped - a missing decade is far worse than a blank box,
 * and the page says outright when a field could not be filled.
 */
export function parseWorkday(variantContent: string, opts: { skillsFallback?: string } = {}): WorkdayProfile {
  // Normalised once, up front, rather than per field. Titles, employers and
  // the skills list do not pass through `plain()`, so spelling applied there
  // would cover the bullets and quietly miss everything else.
  const lines = toUSSpelling(variantContent).split("\n");
  const roles: WorkdayRole[] = [];
  const education: WorkdayEducation[] = [];
  const earlier: string[] = [];
  let skills: string[] = [];

  let section = "";
  let current: WorkdayRole | null = null;
  let bullets: string[] = [];

  const flush = () => {
    if (current) {
      current.description = bullets.join("\n");
      roles.push(current);
    }
    current = null;
    bullets = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const heading = line.match(/^##\s+(.+)$/);
    if (heading && !line.startsWith("###")) {
      flush();
      section = heading[1].trim().toUpperCase();
      continue;
    }

    if (section === "CORE EXPERTISE") {
      // The expertise line is separator-delimited; the "Platforms & Tools" line
      // beneath it is semicolon-delimited and worth having as skills too.
      if (line.startsWith("Platforms & Tools:")) {
        skills = skills.concat(
          line
            .replace(/^Platforms & Tools:\s*/, "")
            .split(/;|·/)
            .map((s) => s.trim())
            .filter(Boolean)
        );
      } else if (line.includes("·")) {
        skills = skills.concat(
          line
            .split("·")
            .map((s) => s.trim())
            .filter(Boolean)
        );
      }
      continue;
    }

    if (section === "EARLIER EXPERIENCE") {
      if (line.trim().startsWith("-")) earlier.push(plain(line));
      continue;
    }

    if (section === "EDUCATION") {
      const text = line.trim();
      if (!text) continue;
      // "Boston College, Carroll School of Management · B.S., Management Information Systems"
      const [schoolPart, degreePart = ""] = text.split("·").map((s) => s.trim());
      const [degree, ...fieldParts] = degreePart.split(",").map((s) => s.trim());
      education.push({ school: schoolPart, degree: degree ?? "", field: fieldParts.join(", ") });
      continue;
    }

    if (section !== "PROFESSIONAL EXPERIENCE") continue;

    // `### Title | Employer`, or the untitled `| Employer` the agency block uses.
    const role = line.match(/^###\s+(.*?)\s*\|\s*(.+?)\s*$/) ?? line.match(/^\|\s*(.*)$/);
    if (role) {
      flush();
      const isUntitled = !line.startsWith("###");
      const title = isUntitled ? "" : role[1].trim();
      const employer = isUntitled ? role[1].trim() : role[2].trim();

      // The next line carries `Start to End · Location`.
      const dateLine = (lines[i + 1] ?? "").trim();
      const [range, location = ""] = dateLine.split("·").map((s) => s.trim());
      const m = range.match(/^(.+?)\s+to\s+(.+?)$/i);
      const startLabel = m ? m[1].trim() : "";
      const endLabel = m ? m[2].trim() : "";

      current = {
        title,
        employer,
        location,
        startLabel,
        endLabel,
        start: toMonthYear(startLabel),
        end: toMonthYear(endLabel),
        current: /^(present|current|now)$/i.test(endLabel),
        description: "",
      };
      continue;
    }

    // The `>` scope line is the remit under a title. It belongs in the
    // description: Workday has no field for it, and it is the clearest single
    // statement of what the job covered.
    if (current && line.trim().startsWith(">")) {
      bullets.push(plain(line.replace(/^>\s*/, "")));
      continue;
    }

    if (current && line.trim().startsWith("-")) bullets.push(plain(line));
  }
  flush();

  if (skills.length === 0 && opts.skillsFallback) {
    skills = opts.skillsFallback
      .split(/[·;,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return { roles, education, skills, earlier };
}
