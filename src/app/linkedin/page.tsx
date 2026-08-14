import Link from "next/link";
import { LinkedInCompare } from "@/components/LinkedInCompare";
import { PAGE_TITLE } from "@/lib/type";

export const dynamic = "force-dynamic";

export const metadata = { title: "LinkedIn vs resume - Counsel" };

export default function LinkedInPage() {
  return (
    <div className="mx-auto max-w-2xl py-8">
      <h1 className={PAGE_TITLE}>LinkedIn against the resume</h1>
      <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-[var(--tx-2)]">
        Recruiters read both. Every one you are talking to has looked at the profile, and Matt Menough heard about you
        through Marie before he ever saw a resume. The two telling different stories is worth catching.
      </p>

      <div className="panel mt-5 p-5">
        <h2 className="text-[13px] font-semibold">Paste your profile</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--tx-3)]">
          There is no API for this. LinkedIn returns an authwall to anything reading a profile page, and the official
          APIs never exposed profile content. Two ways in, and you own the data in both: open your profile, select all,
          and paste. Or take the proper export from Settings, Data Privacy, Get a copy of your data, and paste the
          Positions and Profile files.
        </p>
        <div className="mt-4">
          <LinkedInCompare />
        </div>
      </div>

      <p className="mt-5 text-[12.5px] leading-relaxed text-[var(--tx-3)]">
        Dates are compared in code rather than judged by a model, because whether two ranges agree is checkable and a
        tenure is the one claim a recruiter can verify in ten seconds. What belongs on the profile is your call: this
        reports the difference and stops there. When you know what you want to change,{" "}
        <Link href="/profile" className="text-accent hover:underline">
          your profile and variants
        </Link>{" "}
        are where the resume side lives.
      </p>
    </div>
  );
}
