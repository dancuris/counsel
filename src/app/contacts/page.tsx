import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { ContactSearch } from "@/components/ContactSearch";
import { PAGE_TITLE, PAGE_WIDE, PAGE_HEADER, PAGE_LEDE } from "@/lib/type";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contacts - Counsel" };

/**
 * Everyone, alphabetically, searchable, and every row goes somewhere.
 *
 * The first version of this page was a directory that did not click through -
 * a list you could read and not use. Sorting was by application id, which is
 * to say arbitrary, so finding a person meant scanning all of them.
 *
 * People with an outstanding action come first, because that is the reason to
 * open this page at all. Everyone else is A to Z.
 */
export default async function ContactsPage() {
  const contacts = await prisma.contact.findMany({
    include: {
      application: { select: { id: true, roleTitle: true, company: { select: { name: true } } } },
      _count: { select: { correspondence: true } },
    },
  });

  const sorted = [...contacts].sort((a, b) => a.name.localeCompare(b.name));
  const owed = sorted.filter((c) => c.nextAction?.trim() && c.threadStatus !== "closed");
  const rest = sorted.filter((c) => !owed.includes(c));

  const rows = [...owed, ...rest].map((c) => {
    const relatedCompany = c.application?.company.name ?? null;
    return {
      id: c.id,
      name: c.name,
      role: c.role,
      email: c.email,
      // Where they work. Falling back to the role's company is what filed a
      // connector under an employer they do not work for, so the fallback is
      // now the honest one: unknown.
      // The migrated threads carry "Warm thread" or "Warm thread - Optimum" in
      // `relationship`. The bare form names no employer, so it must not become
      // a group heading called "Warm thread".
      where: c.company ?? (c.relationship?.startsWith("Warm thread - ") ? c.relationship.slice(14) : "") ?? "",
      // Shown as a second label only when the role sits at a different company:
      // a recruiter at the hiring company needs no such label, a connector or a
      // search firm does.
      relatesTo: relatedCompany && relatedCompany !== c.company ? `${relatedCompany} · ${c.application!.roleTitle}` : null,
      // Always carried, whether or not it differs, because the list sub-groups
      // by it when one employer has people against more than one role.
      relatedRole: c.application?.roleTitle ?? null,
      nextAction: owed.includes(c) ? c.nextAction : null,
      messages: c._count.correspondence,
    };
  });

  return (
    <div className={PAGE_WIDE}>
      {/* One statement, set large, matching Today. The count was a caption
          beside a one-word title; it is the sentence now. */}
      <section className={PAGE_HEADER}>
        <h1 className={PAGE_TITLE}>
          {rows.length} {rows.length === 1 ? "person" : "people"}.
          {owed.length > 0 && (
            <>
              <br />
              <span className="text-[var(--amber)]">
                {owed.length} owed something.
              </span>
            </>
          )}
        </h1>
        <p className={`${PAGE_LEDE} max-w-[52ch]`}>
          Everyone in the search, grouped by employer. Where someone works and which role they matter to are
          different things, so the role only appears when the two differ.
        </p>
      </section>

      <ContactSearch rows={rows} />
    </div>
  );
}
