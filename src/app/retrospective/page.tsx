import type { Metadata } from "next";
import Link from "next/link";
import { getRetrospective, type Cohort } from "@/lib/retrospective";
import { PatternAnalysis } from "@/components/PatternAnalysis";
import { PAGE_TITLE, PAGE_LEDE, PAGE_READING } from "@/lib/type";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Retrospective - Counsel" };

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "-");

/**
 * The fourth mode. Three of the four things Dan does with this app had a home -
 * decide, apply, interview - and "why did that not work" had none, across
 * twenty-two closed roles.
 *
 * Every figure is counted, not generated, and the page says out loud where the
 * numbers are too thin to carry an argument. A retrospective that overstates
 * its evidence is worse than none: it would send him rewriting a resume that
 * was never the problem.
 */
export default async function RetrospectivePage() {
  const r = await getRetrospective();

  const rows: { label: string; get: (c: Cohort) => string }[] = [
    { label: "Tailored resume sent", get: (c) => `${pct(c.withResume, c.count)}  (${c.withResume}/${c.count})` },
    { label: "Cover letter sent", get: (c) => `${pct(c.withCoverLetter, c.count)}  (${c.withCoverLetter}/${c.count})` },
    { label: "Evaluated before applying", get: (c) => `${pct(c.evaluatedFirst, c.count)}  (${c.evaluatedFirst}/${c.count})` },
    { label: "Job description on file", get: (c) => `${pct(c.withJd, c.count)}  (${c.withJd}/${c.count})` },
  ];

  return (
    <div className={PAGE_READING}>
      <h1 className={PAGE_TITLE}>Retrospective</h1>
      <p className={PAGE_LEDE}>
        What the applications that went somewhere had in common, and what the ones that did not were missing.
      </p>

      <section className="panel mt-6 overflow-hidden">
        <table className="w-full table-fixed text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[11.5px] text-[var(--tx-3)]">
              <th className="w-2/5 px-4 py-3 font-medium"> </th>
              <th className="px-4 py-3 font-medium text-[var(--mint)]">
                Reached a conversation
                <span className="ml-1 font-normal text-[var(--tx-3)]">n={r.reached.count}</span>
              </th>
              <th className="px-4 py-3 font-medium">
                Never heard back
                <span className="ml-1 font-normal text-[var(--tx-3)]">n={r.didNot.count}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="px-4 py-3 text-[var(--tx-2)]">{row.label}</td>
                <td className="px-4 py-3 tabular-nums text-[var(--tx)]">{row.get(r.reached)}</td>
                <td className="px-4 py-3 tabular-nums text-[var(--tx-2)]">{row.get(r.didNot)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Stated before the reader draws a conclusion, not in a footnote after. */}
      <section className="mt-4 rounded-xl border border-amber-line bg-[var(--amber-dim)] p-4">
        <h2 className="text-[13px] font-semibold text-[var(--amber)]">Read this before drawing a conclusion</h2>
        <ul className="mt-2 space-y-1.5 text-[12.5px] text-[var(--tx-2)]">
          <li>
            <b>{r.reached.count} is a small sample.</b> One more interview moves every percentage above by a lot.
          </li>
          <li>
            <b>The causality probably runs backwards.</b> You tailored documents for the roles you cared most about,
            and those were likely the better fits to begin with. &ldquo;Tailoring wins interviews&rdquo; is not shown
            here. &ldquo;You did not tailor for most of the ones that went nowhere&rdquo; is simply true.
          </li>
          <li>
            <b>
              {r.closedWithoutJd} of {r.closedTotal} closed roles have no job description stored.
            </b>{" "}
            Without it nothing can compare what they asked for against what you sent, which is where the real answer
            lives. That gap is the single biggest limit on this page.{" "}
            <Link href="/?stage=needs-posting" className="underline hover:text-[var(--tx)]">
              Fill it in
            </Link>
            .
          </li>
        </ul>
      </section>

      {r.byVerdict.length > 0 && (
        <section className="panel mt-4 p-4">
          <h2 className="text-[13px] font-semibold">Verdict against outcome</h2>
          <p className="mt-0.5 text-[11.5px] text-[var(--tx-3)]">
            Only counts roles evaluated before the outcome was known, so most applications are not in here.
          </p>
          <ul className="mt-2.5 space-y-1.5">
            {r.byVerdict.map((v) => (
              <li key={v.verdict} className="flex items-center justify-between text-[13px]">
                <span className="capitalize text-[var(--tx-2)]">{v.verdict}</span>
                <span className="tabular-nums text-[var(--tx-3)]">
                  {v.reached} of {v.total} reached a conversation
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PatternAnalysis />

      <section className="panel mt-4 p-4">
        <h2 className="text-[13px] font-semibold">The ones that went somewhere</h2>
        <p className="mt-0.5 text-[11.5px] text-[var(--tx-3)]">Worth reading for the shape of what works.</p>
        <ul className="mt-2.5 space-y-1.5">
          {r.wins.map((w) => (
            <li key={`${w.company}-${w.roleTitle}`} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="font-medium text-[var(--tx)]">{w.company}</span>
              <span className="min-w-0 flex-1 truncate text-[var(--tx-2)]">{w.roleTitle}</span>
              {w.verdict && <span className="text-[11.5px] capitalize text-[var(--tx-3)]">{w.verdict}</span>}
            </li>
          ))}
          {r.wins.length === 0 && <li className="text-[13px] text-[var(--tx-3)]">Nothing has reached a conversation yet.</li>}
        </ul>
      </section>
    </div>
  );
}
