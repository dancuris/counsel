import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { parseLabelled } from "@/lib/contact-block";
import { parseWorkday, splitAddress } from "@/lib/workday";
import { CopyChip, CopyField } from "@/components/CopyField";
import { PAGE_TITLE, SECTION_GAP } from "@/lib/type";
import { TENANT_ID } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * Everything a Workday application asks for, as fields you can copy.
 *
 * Workday's resume parser mangles Dan's resume on every application, so the
 * upload saves nothing and the whole career gets retyped into their boxes. The
 * parser is theirs and cannot be fixed from here; the retyping can. Every fact
 * below is read out of the chosen resume variant and the Profile row, so this
 * page cannot disagree with the resume he actually attaches - and when the
 * career changes, the variants change and this follows.
 *
 * Laid out in Workday's own order and using Workday's own field names rather
 * than the resume's, because the job is matching a box on their screen to a
 * value on this one. "Company" and "Location" are what they call things, even
 * though this app calls them employer and city.
 *
 * Which variant matters: they carry different Core Expertise lines and lead
 * with different material, so the one to read from is the one the application
 * was tailored from. `?variant=` picks it and defaults to the default.
 */
export default async function WorkdayPage({
  searchParams,
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  const { variant: variantId } = await searchParams;

  const [profile, variants] = await Promise.all([
    prisma.profile.findUnique({ where: { id: TENANT_ID } }),
    prisma.resumeVariant.findMany({ select: { id: true, name: true, isDefault: true, content: true }, orderBy: { name: "asc" } }),
  ]);

  const chosen =
    variants.find((v) => v.id === variantId) ?? variants.find((v) => v.isDefault) ?? variants[0] ?? null;

  const emails = parseLabelled(profile?.contactEmails);
  const addresses = parseLabelled(profile?.contactAddresses);
  const email =
    emails.find((e) => e.label === profile?.defaultEmailLabel)?.value ?? emails[0]?.value ?? "";
  const addressLine =
    addresses.find((a) => a.label === profile?.defaultAddressLabel)?.value ?? addresses[0]?.value ?? "";
  const address = splitAddress(addressLine);

  const name = (profile?.contactName ?? "").trim();
  const nameParts = name.split(/\s+/);
  const firstName = nameParts[0] ?? "";
  const lastName = nameParts.slice(1).join(" ");

  const w = chosen ? parseWorkday(chosen.content) : { roles: [], education: [], skills: [], earlier: [] };

  return (
    <div className="max-w-3xl pb-16">
      <p className="text-[12.5px] text-[var(--tx-3)]">
        <Link href="/profile" className="hover:underline">
          Profile
        </Link>{" "}
        / Workday
      </p>
      <h1 className={`mt-1 ${PAGE_TITLE}`}>
        Workday fields
      </h1>
      <p className="mt-2.5 max-w-[62ch] text-[13.5px] leading-relaxed text-[var(--tx-2)]">
        Their parser will still make a mess of the upload. Fix it from here rather than retyping: every box
        below matches a field on the Workday form, and the values come straight from the resume variant, so
        what you paste is what you attached.
      </p>

      {variants.length > 1 && (
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-[var(--tx-3)]">Read from:</span>
          {variants.map((v) => (
            <Link
              key={v.id}
              href={`/profile/workday?variant=${v.id}`}
              className={`rounded-full border px-2.5 py-1 text-[12px] ${
                v.id === chosen?.id
                  ? "border-transparent bg-accent text-white"
                  : "border-line text-[var(--tx-2)] hover:border-line-2"
              }`}
            >
              {v.name}
            </Link>
          ))}
        </div>
      )}

      {!chosen && (
        <p className="mt-8 text-[13px] text-[var(--amber)]">
          There is no resume variant to read from, so there is nothing to fill these with yet.
        </p>
      )}

      <Section title="My Information" note="The first screen, and the one their parser gets least wrong.">
        <Grid>
          <CopyField label="First Name" value={firstName} />
          <CopyField label="Last Name" value={lastName} />
          <CopyField label="Email Address" value={email} />
          <CopyField label="Phone Number" value={profile?.contactPhone ?? ""} hint="Device type: Mobile" />
        </Grid>
        <Grid>
          <CopyField label="Address Line 1" value={address.line1} />
          <CopyField label="City" value={address.city} />
          <CopyField label="State" value={address.state} />
          <CopyField label="Postal Code" value={address.postal} />
          <CopyField label="Country" value={address.country} />
        </Grid>
        {addressLine && (
          <p className="mt-3 text-[11.5px] text-[var(--tx-3)]">
            Split from <span className="text-[var(--tx-2)]">{addressLine}</span>. Change which address this uses
            on the Profile page.
          </p>
        )}
      </Section>

      <Section
        title="Work Experience"
        note="Workday asks for these one job at a time, in this order. Dates are MM/YYYY, which is the format its boxes accept."
      >
        <div className="space-y-8">
          {w.roles.map((r, i) => (
            <div key={i} className="border-t border-line pt-5 first:border-t-0 first:pt-0">
              <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-[var(--tx-3)]">
                Job {i + 1} of {w.roles.length}
              </p>
              <Grid>
                <CopyField
                  label="Job Title"
                  value={r.title}
                  hint={r.title ? undefined : "This block covers three agencies with three titles. See Earlier Experience below."}
                />
                <CopyField label="Company" value={r.employer} />
                <CopyField label="Location" value={r.location} />
                <CopyField label="From" value={r.start} hint={r.startLabel} />
                <CopyField label="To" value={r.end} hint={r.current ? "Tick 'I currently work here'" : r.endLabel} />
              </Grid>
              <div className="mt-4">
                <CopyField label="Role Description" value={r.description} multiline />
              </div>
            </div>
          ))}
        </div>
      </Section>

      {w.earlier.length > 0 && (
        <Section
          title="Earlier Experience"
          note="Not usually entered into Workday, but it holds the individual titles behind the agency block above."
        >
          <ul className="space-y-1.5">
            {w.earlier.map((e, i) => (
              <li key={i} className="text-[13px] text-[var(--tx-2)]">
                {e}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Education">
        {w.education.map((e, i) => (
          <Grid key={i}>
            <CopyField label="School or University" value={e.school} />
            <CopyField label="Degree" value={e.degree} />
            <CopyField label="Field of Study" value={e.field} />
          </Grid>
        ))}
      </Section>

      <Section title="Skills" note="Workday takes these one at a time, so they are listed individually rather than as a block.">
        <div className="flex flex-wrap gap-1.5">
          {w.skills.map((s, i) => (
            <CopyChip key={i} value={s} />
          ))}
        </div>
        <div className="mt-4">
          <CopyField label="All of them, comma separated" value={w.skills.join(", ")} multiline />
        </div>
      </Section>

      <Section title="Websites">
        <Grid>
          <CopyField label="LinkedIn" value={profile?.contactLinks ?? ""} />
        </Grid>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className={`${SECTION_GAP}`}>
      <h2 className="text-[17px] font-semibold text-[var(--tx)]">{title}</h2>
      {note && <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-[var(--tx-3)]">{note}</p>}
      <div className="mt-4 rounded-xl border border-line p-4">{children}</div>
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">{children}</div>;
}

