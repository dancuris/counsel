export type ContactRow = {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  where: string;
  relatesTo: string | null;
  relatedRole: string | null;
  nextAction: string | null;
  messages: number;
};

const OTHER = "Other";

export type ContactGroup = { label: string; subgroups: { label: string; rows: ContactRow[] }[] };

/**
 * "Gail Dielman" -> "Dielman, Gail". Particles stay with the surname.
 *
 * Two cases it got wrong before they were tested. Multi-word particles
 * ("van der", "van den") only had their first word listed, so "Jan van der
 * Berg" came back as "Berg, Jan van der" - the particle stranded on the wrong
 * side of the comma. And a name already written surname-first, which is how
 * corporate directories emit them ("SURNAME, FORENAME" in capitals), got
 * inverted a second time into "FORENAME, SURNAME,".
 */
export function surnameFirst(name: string): string {
  const trimmed = name.trim();
  // Already inverted. Inverting again is how a directory export gets mangled.
  if (trimmed.includes(",")) return trimmed;

  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return trimmed;
  const suffixes = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);
  const particles = new Set([
    "van", "von", "der", "den", "de", "del", "della", "di", "da", "das", "dos",
    "du", "la", "le", "ter", "ten", "mac", "mc", "st", "st.", "bin", "ibn", "al",
  ]);

  let last = parts.length - 1;
  if (suffixes.has(parts[last].toLowerCase()) && last > 0) last -= 1;
  let start = last;
  while (start > 0 && particles.has(parts[start - 1].toLowerCase())) start -= 1;

  const surname = parts.slice(start, last + 1).join(" ");
  const rest = [...parts.slice(0, start), ...parts.slice(last + 1)].join(" ");
  return rest ? `${surname}, ${rest}` : surname;
}

/**
 * Employer first, then the role inside it - but the role tier only appears for
 * a company that actually has people against more than one role.
 *
 * The tier is conditional rather than absent because the pipeline gains roles
 * constantly. Today only AT&T qualifies, and sub-grouping everything would give
 * twenty headings over one person each; the moment a second role appears at any
 * employer, the structure has to show up by itself rather than waiting to be
 * switched on. Deciding this from a snapshot of the current data is how you get
 * a list that is right this week and wrong next week.
 */
export function groupContacts(rows_: ContactRow[], grouped: boolean): ContactGroup[] {
    if (!grouped) return [{ label: "", subgroups: [{ label: "", rows: rows_ }] }];

    const owed = rows_.filter((r) => r.nextAction);
    const rest = rows_.filter((r) => !r.nextAction);

    const byCompany = new Map<string, ContactRow[]>();
    for (const r of rest) {
      const key = r.where || OTHER;
      byCompany.set(key, [...(byCompany.get(key) ?? []), r]);
    }

    // "Other" is a bucket, not a company, so it sorts to the bottom rather than
    // sitting between two other employers.
    const companyGroups = [...byCompany.entries()]
      .sort((a, b) => {
        if (a[0] === OTHER) return 1;
        if (b[0] === OTHER) return -1;
        return a[0].localeCompare(b[0]);
      })
      .map(([label, rows]) => {
        const roles = [...new Set(rows.map((r) => r.relatedRole).filter(Boolean))] as string[];

        // One role, or none, means the heading would only repeat what the
        // company heading already said.
        if (roles.length < 2) return { label, subgroups: [{ label: "", rows }] };

        const unattached = rows.filter((r) => !r.relatedRole);
        return {
          label,
          subgroups: [
            ...roles.sort((a, b) => a.localeCompare(b)).map((role) => ({
              label: role,
              rows: rows.filter((r) => r.relatedRole === role),
            })),
            // People at the company who are not tied to a specific role still
            // belong under it, not in a separate company group.
            ...(unattached.length ? [{ label: "No specific role", rows: unattached }] : []),
          ],
        };
      });

    return [
      ...(owed.length ? [{ label: "You owe these people something", subgroups: [{ label: "", rows: owed }] }] : []),
      ...companyGroups,
    ];
}

/**
 * Who to offer first when a role's follow-up says to write to someone.
 *
 * The follow-up line shipped with `contacts[0]` under `createdAt: desc`, which
 * is not a choice at all - where a role held two contacts created the same day
 * the tie broke arbitrarily, and "Write to them" went to the hiring-side
 * contact rather than the recruiter who owns the process.
 *
 * A cadence follow-up is a question about process: where are we, what happens
 * next, when. That is the recruiter's to answer, on every role in this
 * pipeline. So the recruiter sorts first.
 *
 * It is an ordering and not a filter. The hiring manager is often the person
 * Dan actually wants, and the caller names everybody, because the real fault
 * was an unnamed link hiding whichever guess the app had made.
 */
const RECRUITER = /recruit|talent acquisition|talent|search consultant|sourcer/i;

export function recruiterFirst<T extends { role?: string | null }>(contacts: T[]): T[] {
  return [...contacts].sort((a, b) => Number(RECRUITER.test(b.role ?? "")) - Number(RECRUITER.test(a.role ?? "")));
}
