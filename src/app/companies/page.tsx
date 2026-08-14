import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { formatDate } from "@/lib/format";
import { PAGE_TITLE, PAGE_LEDE, PAGE_WIDE, PAGE_HEADER } from "@/lib/type";

export const dynamic = "force-dynamic";

/**
 * Every employer, whether or not a role is being tracked there.
 *
 * There was no index at all: the only way to reach a company was to open one
 * of its postings and click the name, which makes an employer with no posting
 * unreachable by design. That is exactly the case this page exists for - an
 * introduction to somebody at a company Dan has never applied to is where a
 * search often starts, and it had nowhere to live.
 */
export default async function CompaniesPage() {
  const companies = await prisma.company.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      applications: {
        where: { deletedAt: null },
        select: { id: true, roleTitle: true, status: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
      },
      _count: { select: { mailMessages: true } },
    },
  });

  // Contacts carry an employer of their own, which is not always a company
  // with a posting - the whole point of Contact.company. Counted by name,
  // since that is the only thing the two share.
  const contacts = await prisma.contact.findMany({
    where: { NOT: { company: null } },
    select: { company: true },
  });
  const contactsByCompany = new Map<string, number>();
  for (const c of contacts) {
    const key = (c.company ?? "").trim().toLowerCase();
    if (key) contactsByCompany.set(key, (contactsByCompany.get(key) ?? 0) + 1);
  }

  return (
    <div className={PAGE_WIDE}>
      <header className={PAGE_HEADER}>
        <h1 className={PAGE_TITLE}>Companies</h1>
        <p className={PAGE_LEDE}>
          Every employer in the search, including the ones with no posting yet.
        </p>
      </header>

      <ul className="mt-8 divide-y divide-[var(--line)] border-t border-line">
        {companies.map((c) => {
          const people = contactsByCompany.get(c.name.trim().toLowerCase()) ?? 0;
          return (
            <li key={c.id}>
              <Link href={`/companies/${c.id}`} className="block py-3.5 transition-colors hover:bg-[var(--surface-2)]">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-[15px] font-medium text-[var(--tx)]">{c.name}</span>
                  <span className="text-[11.5px] text-[var(--tx-3)]">
                    {[
                      c.applications.length
                        ? `${c.applications.length} role${c.applications.length === 1 ? "" : "s"}`
                        : "no roles tracked",
                      people ? `${people} contact${people === 1 ? "" : "s"}` : null,
                      c._count.mailMessages ? `${c._count.mailMessages} message${c._count.mailMessages === 1 ? "" : "s"}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {c.applications.length > 0 && (
                  <p className="mt-0.5 truncate text-[12.5px] text-[var(--tx-2)]">
                    {c.applications.map((a) => a.roleTitle).join(" · ")}
                  </p>
                )}
                {c.applications[0] && (
                  <p className="mt-0.5 text-[11px] text-[var(--tx-3)]">
                    Last touched {formatDate(c.applications[0].updatedAt)}
                  </p>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
