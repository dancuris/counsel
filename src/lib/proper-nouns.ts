import { prisma } from "@/lib/prisma";

/**
 * Names the spelling pass must not touch.
 *
 * `enforceHouseLanguage` rewrites any word it recognises and cannot tell Dan's
 * prose from an employer's name. Every company and contact in the database is
 * a name he might write in a letter, and several of them are the exact shapes
 * the normalizer targets. A Canadian employer in the pipeline uses "Centre"
 * in its own department names, and was interviewing at the time.
 *
 * Read fresh per call rather than cached. It is two indexed reads of small
 * tables, this runs on paths that already make a model call taking seconds,
 * and a stale list here means silently renaming a company that was added five
 * minutes ago.
 */
export async function protectedNames(): Promise<string[]> {
  const [companies, contacts] = await Promise.all([
    prisma.company.findMany({ select: { name: true } }),
    prisma.contact.findMany({ select: { name: true, company: true, role: true } }),
  ]);

  const names = [
    ...companies.map((c) => c.name),
    ...contacts.flatMap((c) => [c.name, c.company, c.role]),
  ];

  return [
    ...new Set(
      names
        .map((n) => (n ?? "").trim())
        // Two characters or fewer cannot collide with anything the normalizer
        // rewrites, and a very short token would mask far too much text.
        .filter((n) => n.length > 2)
    ),
  ];
}
