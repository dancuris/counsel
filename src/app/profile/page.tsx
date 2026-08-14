import { SubmitButton } from "@/components/SubmitButton";
import { prisma } from "@/lib/prisma";
import { GeneralDocuments } from "@/components/GeneralDocuments";
import { driveFolderUrl } from "@/lib/drive-links";
import { GENERAL_KINDS, type GeneralKind } from "@/lib/general-documents";

import { updateProfile } from "./actions";
import { parseLabelled, formatLabelledLines } from "@/lib/contact-block";
import { ThemeSetting } from "@/components/ThemeSetting";
import { getThemeChoice } from "@/lib/theme-server";
import { buttonClass, inputClass } from "@/lib/button";
import Link from "next/link";
import { PAGE_TITLE, PAGE_LEDE, PAGE_READING, SECTION_GAP } from "@/lib/type";
import { TENANT_ID } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  // The connection queries went with the sections that used them. Left behind
  // they would be three round trips per load feeding nothing, which is the
  // same residue the route split left on Today and Pipeline.
  const profile = await prisma.profile.findUnique({ where: { id: TENANT_ID } });
  const generalRows = await prisma.generalDocument.findMany();
  const generalDocs = (Object.keys(GENERAL_KINDS) as GeneralKind[]).map((id) => {
    const row = generalRows.find((r) => r.id === id);
    return {
      id,
      label: GENERAL_KINDS[id].label,
      words: row?.content ? row.content.trim().split(/\s+/).length : 0,
      docx: row?.driveFileIdDocx ?? null,
      pdf: row?.driveFileIdPdf ?? null,
      updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
    };
  });
  const ruledOut: string[] = profile ? JSON.parse(profile.ruledOutCompanies) : [];
  const addresses = parseLabelled(profile?.contactAddresses);
  const emails = parseLabelled(profile?.contactEmails);
  const theme = await getThemeChoice();

  return (
    <div className={PAGE_READING}>
      <h1 className={PAGE_TITLE}>Profile</h1>
      <p className={PAGE_LEDE}>
        This is the standing context every AI evaluation and document draft is grounded in. Keep it current.
      </p>

      {/*
        The LinkedIn comparison lives under Profile rather than Settings, and
        was reachable only by typing the URL until Dan pointed that out.
        Settings is accounts and configuration; this is his career record,
        which is what this page is for.
      */}
      <Link
        href="/linkedin"
        className="mt-6 flex items-center justify-between gap-4 rounded-lg border border-line bg-[var(--surface-2)] px-4 py-3 transition-colors hover:bg-[var(--surface)]"
      >
        <span>
          <span className="block text-[13px] font-medium text-[var(--tx)]">Check LinkedIn against the resume</span>
          <span className="block text-[12.5px] text-[var(--tx-3)]">
            Recruiters read both. Dates that disagree are the ones worth catching.
          </span>
        </span>
        <span className="text-[var(--tx-3)]">&#8250;</span>
      </Link>

      {/*
        Beside the LinkedIn check for the same reason: both are the career
        record pointed at somewhere outside the app, rather than configuration.
      */}
      <Link
        href="/profile/workday"
        className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-line bg-[var(--surface-2)] px-4 py-3 transition-colors hover:bg-[var(--surface)]"
      >
        <span>
          <span className="block text-[13px] font-medium text-[var(--tx)]">Workday fields</span>
          <span className="block text-[12.5px] text-[var(--tx-3)]">
            Their parser mangles the upload every time. Copy the boxes from here instead of retyping.
          </span>
        </span>
        <span className="text-[var(--tx-3)]">&#8250;</span>
      </Link>

      <div className="mt-6">
        <ThemeSetting current={theme} />
      </div>

      <section className={`${SECTION_GAP} panel p-4 shadow-sm`}>
        <h2 className="text-sm font-semibold text-[var(--tx)]">Send-anywhere documents</h2>
        <p className="mt-0.5 text-xs text-[var(--tx-2)]">
          For a networking call, where someone asks for your resume and there is no role to tailor to. The master is
          merged from every variant rather than cut for a posting, so nothing you have done is missing from it.
        </p>
        <div className="mt-3">
          <GeneralDocuments
            docs={generalDocs}
            folderUrl={profile?.driveRootFolderId ? driveFolderUrl(profile.driveRootFolderId) : null}
          />
        </div>
      </section>

      <p className="mt-3 rounded-lg border border-line bg-[var(--surface-2)] px-3 py-2.5 text-xs text-[var(--tx-2)]">
        The mailbox and Google Drive connections moved to{" "}
        <a href="/settings" className="text-accent hover:underline">Settings</a>. Profile is what the app knows about
        you; connecting an account is how it is wired.
      </p>

      <form action={updateProfile} className="mt-6 space-y-5" key={profile?.updatedAt?.toISOString() ?? "new"}>
        <div className="panel p-4">
          <h2 className="text-sm font-semibold text-[var(--tx)]">Contact block</h2>
          <p className="mt-0.5 text-xs text-[var(--tx-2)]">
            Written onto every generated resume by the app itself, never by Claude, so it can&apos;t come out with
            placeholders. Give addresses and emails one per line as <code>Label: value</code>, then pick which to use
            by default. You can switch per document at generation time.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-[var(--tx-2)]">Name</span>
              <input name="contactName" defaultValue={profile?.contactName ?? ""} className={`mt-1 ${inputClass("md")}`} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--tx-2)]">Phone</span>
              <input name="contactPhone" defaultValue={profile?.contactPhone ?? ""} className={`mt-1 ${inputClass("md")}`} />
            </label>
          </div>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-[var(--tx-2)]">Links (LinkedIn, portfolio)</span>
            <input name="contactLinks" defaultValue={profile?.contactLinks ?? ""} className={`mt-1 ${inputClass("md")}`} />
          </label>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-[var(--tx-2)]">Addresses</span>
              <textarea name="contactAddresses" rows={4} defaultValue={formatLabelledLines(addresses)} placeholder={"Label: address, one per line"} className={`mt-1 font-mono ${inputClass("sm")}`} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--tx-2)]">Emails</span>
              <textarea name="contactEmails" rows={4} defaultValue={formatLabelledLines(emails)} placeholder={"Label: address, one per line"} className={`mt-1 font-mono ${inputClass("sm")}`} />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-[var(--tx-2)]">Default address</span>
              <select name="defaultAddressLabel" defaultValue={profile?.defaultAddressLabel ?? ""} className={`mt-1 ${inputClass("md")}`}>
                <option value="">First in the list</option>
                {addresses.map((a) => (<option key={a.label} value={a.label}>{a.label}</option>))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium text-[var(--tx-2)]">Default email</span>
              <select name="defaultEmailLabel" defaultValue={profile?.defaultEmailLabel ?? ""} className={`mt-1 ${inputClass("md")}`}>
                <option value="">First in the list</option>
                {emails.map((e) => (<option key={e.label} value={e.label}>{e.label}</option>))}
              </select>
            </label>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-[var(--tx-2)]">Master resume</label>
          <p className="mt-0.5 text-xs text-[var(--tx-3)]">
            Paste your real resume: contact block first, then every role with dates and bullets, education, skills.
            Tailored resumes are built by editing this down for each job, never written from scratch, so anything
            missing here (phone, email, LinkedIn) cannot appear in a generated document.
          </p>
          <textarea
            name="masterResume"
            defaultValue={profile?.masterResume ?? ""}
            rows={14}
            placeholder={"Your name\nCity, State | Phone | Email | LinkedIn\n\n## Experience\n### Employer - Job title (dates)\n- Achievement\n- Achievement"}
            className="mt-1.5 w-full rounded border border-line-2 p-2 font-mono text-xs"
          />
          {!profile?.masterResume && (
            <p className="mt-1 text-xs text-amber-700">
              Not set. Resume generation is disabled until this is filled in.
            </p>
          )}
        </div>
        <Field label="Positioning" name="positioning" defaultValue={profile?.positioning} rows={8} />
        <Field label="Career narrative" name="careerNarrative" defaultValue={profile?.careerNarrative} rows={8} />
        <Field label="Personal / logistics" name="personalLogistics" defaultValue={profile?.personalLogistics} rows={5} />
        <Field label="Standing document preferences" name="standingPreferences" defaultValue={profile?.standingPreferences} rows={6} />
        <Field label="Role evaluation framework" name="evaluationFramework" defaultValue={profile?.evaluationFramework} rows={6} />
        <div>
          <label className="text-xs font-medium text-[var(--tx-2)]">Never consider (one per line)</label>
          <textarea
            name="ruledOutCompanies"
            defaultValue={ruledOut.join("\n")}
            rows={6}
            className={`mt-1 font-mono ${inputClass("md")}`}
          />
          <p className="mt-1 text-xs text-[var(--tx-3)]">
            Employers you would never work for, whatever the role. Yours to maintain: nothing adds to this list
            automatically. It is not a record of roles you passed on, because a role that did not work out at a
            company says nothing about the next one there.
          </p>
        </div>
        <SubmitButton className={buttonClass("primary", "md")}>Save profile</SubmitButton>
      </form>
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  rows,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  rows: number;
}) {
  return (
    <div>
      <label className="text-xs font-medium text-[var(--tx-2)]">{label}</label>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ""}
        rows={rows}
        className={`mt-1 ${inputClass("md")}`}
      />
    </div>
  );
}
