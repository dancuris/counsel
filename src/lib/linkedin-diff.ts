/**
 * Comparing what LinkedIn says against what the resume says.
 *
 * Recruiters read both. Every one Dan is talking to has looked at the profile,
 * and in one case it is how a recruiter heard of him before he wrote. So the resume
 * moving on while the profile stands still is not a tidiness problem, it is
 * two different accounts of the same career in front of the same person.
 *
 * The split here is deliberate and matches how the rest of this app treats
 * model output. **Extraction is a model job**: a pasted profile is freeform
 * prose and only a model can reliably turn it into roles. **Comparison is
 * not.** Whether two date ranges agree is checkable, so it is checked in code.
 * Handing "do these match?" to a model would produce a confident paragraph
 * with no way to know whether it actually looked.
 *
 * That matters most for dates, which are the one claim a recruiter can verify
 * in ten seconds, and which this project has already got wrong once today.
 */

export type Role = {
  title: string;
  employer: string;
  /** As written, e.g. "Aug 2022". Empty when the source did not say. */
  start: string;
  /** "Jun 2026", or "Present". */
  end: string;
};

export type Finding = {
  kind: "missing-from-linkedin" | "missing-from-resume" | "dates-disagree" | "title-differs";
  employer: string;
  what: string;
  resume?: string;
  linkedin?: string;
};

/**
 * Pulls the roles out of a resume variant.
 *
 * The format is fixed by the generator: `### Title | Employer` and the dates on
 * the line beneath as `Aug 2022 to Dec 2025 · Atlanta, GA`. Parsing rather than
 * asking a model, because this side of the comparison is structured already and
 * a model reading it could only introduce error.
 */
export function rolesFromVariant(content: string): Role[] {
  const lines = content.split("\n");
  const roles: Role[] = [];

  for (const [i, line] of lines.entries()) {
    const heading = line.match(/^###\s+(.+?)\s*\|\s*(.+?)\s*$/);
    if (!heading) continue;

    const dateLine = (lines[i + 1] ?? "").split("·")[0].trim();
    const range = dateLine.match(/^(.+?)\s+to\s+(.+?)$/i);

    roles.push({
      title: heading[1].trim(),
      employer: heading[2].trim(),
      start: range ? range[1].trim() : "",
      end: range ? range[2].trim() : "",
    });
  }
  return roles;
}

/** Case, punctuation and common suffixes removed, so "Delta Air Lines" and "Delta" match. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|group|communications|air lines|airlines)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** "Aug 2022" and "August 2022" and "08/2022" all reduce to the same thing. */
function monthKey(s: string): string {
  const t = s.trim().toLowerCase();
  if (!t || /^(present|current|now)$/.test(t)) return "present";

  const year = t.match(/\b(19|20)\d{2}\b/)?.[0] ?? "";
  const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const named = months.findIndex((m) => t.includes(m));
  const numeric = t.match(/\b(0?[1-9]|1[0-2])\s*[/-]\s*(19|20)?\d{2}\b/);

  const month = named >= 0 ? named + 1 : numeric ? Number(numeric[1]) : 0;
  // A year with no month still compares usefully against another year.
  return month ? `${year}-${String(month).padStart(2, "0")}` : year;
}

function sameRange(a: Role, b: Role): boolean {
  return monthKey(a.start) === monthKey(b.start) && monthKey(a.end) === monthKey(b.end);
}

/**
 * What differs, employer by employer.
 *
 * Matched on employer plus title rather than employer alone, because Delta
 * holds two titles and a promotion is exactly the case worth getting right: a
 * profile showing only the newer one is a real gap, not a duplicate.
 */
export function diffRoles(resume: Role[], linkedin: Role[]): Finding[] {
  const findings: Finding[] = [];
  const key = (r: Role) => `${normalise(r.employer)}::${normalise(r.title)}`;
  const byKey = new Map(linkedin.map((r) => [key(r), r]));
  const usedKeys = new Set<string>();

  for (const r of resume) {
    const exact = byKey.get(key(r));
    if (exact) {
      usedKeys.add(key(r));
      if (!sameRange(r, exact)) {
        findings.push({
          kind: "dates-disagree",
          employer: r.employer,
          what: `${r.title}: the dates do not match.`,
          resume: `${r.start} to ${r.end}`,
          linkedin: `${exact.start} to ${exact.end}`,
        });
      }
      continue;
    }

    // Same employer, different title. Usually a wording drift rather than a
    // missing role, and worth reporting as such so it is not read as a gap.
    const sameEmployer = linkedin.find(
      (l) => normalise(l.employer) === normalise(r.employer) && !usedKeys.has(key(l))
    );
    if (sameEmployer) {
      usedKeys.add(key(sameEmployer));
      findings.push({
        kind: "title-differs",
        employer: r.employer,
        what: "The title is written differently in each place.",
        resume: r.title,
        linkedin: sameEmployer.title,
      });
      if (!sameRange(r, sameEmployer)) {
        findings.push({
          kind: "dates-disagree",
          employer: r.employer,
          what: `${r.title}: the dates do not match.`,
          resume: `${r.start} to ${r.end}`,
          linkedin: `${sameEmployer.start} to ${sameEmployer.end}`,
        });
      }
      continue;
    }

    findings.push({
      kind: "missing-from-linkedin",
      employer: r.employer,
      what: `${r.title} is on the resume and not on LinkedIn.`,
      resume: `${r.start} to ${r.end}`,
    });
  }

  for (const l of linkedin) {
    if (usedKeys.has(key(l))) continue;
    if (resume.some((r) => key(r) === key(l))) continue;
    findings.push({
      kind: "missing-from-resume",
      employer: l.employer,
      what: `${l.title} is on LinkedIn and not on the resume.`,
      linkedin: `${l.start} to ${l.end}`,
    });
  }

  // Dates first: they are the only finding a recruiter can check independently.
  const rank = { "dates-disagree": 0, "missing-from-linkedin": 1, "title-differs": 2, "missing-from-resume": 3 };
  return findings.sort((a, b) => rank[a.kind] - rank[b.kind]);
}
