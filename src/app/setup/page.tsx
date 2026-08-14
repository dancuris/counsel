import Link from "next/link";
import { setupSteps } from "@/lib/setup-state";
import { buttonClass } from "@/lib/button";
import { PAGE_TITLE, PAGE_LEDE, PAGE_READING, PAGE_HEADER, SECTION_GAP } from "@/lib/type";

export const dynamic = "force-dynamic";

/**
 * Setting up, as a page rather than a terminal session.
 *
 * An instance used to be configured the way a developer configures things, and
 * the instructions lived in somebody's head. This is the same information, in
 * the app, checking itself as it goes.
 *
 * It is deliberately **not a wizard**. There is no step one of six, no next
 * button and no finish line, because the app is genuinely useful before any of
 * this is done: paste a role and it tracks it. Everything here is a capability
 * you turn on when it is worth it to you, and the page says what each one buys
 * rather than what is broken without it. A setup screen that reports faults
 * teaches somebody their app is half-broken; one that reports capabilities lets
 * them choose.
 *
 * Every state is read from the data, so this is a live view rather than a
 * checklist somebody once ticked. Disconnect the mailbox and that row goes back
 * to offering a connection.
 */
export default async function SetupPage() {
  const steps = await setupSteps();
  const connected = steps.filter((s) => s.connected).length;

  return (
    <div className={PAGE_READING}>
      <header className={PAGE_HEADER}>
        <h1 className={PAGE_TITLE}>Getting started</h1>
        <p className={PAGE_LEDE}>
          Nothing here is required. The app tracks roles the moment you paste one, and each of these turns on
          something more. {connected} of {steps.length} connected.
        </p>
      </header>

      {/*
        The run-once path, offered first. This page is the standing view of what
        is connected; the wizard is how somebody gets from an empty instance to
        a working one without being asked for six essays.
      */}
      <Link
        href="/setup/start"
        className="mb-6 block rounded-xl border border-line-2 bg-[var(--surface-2)] p-4 transition-colors hover:bg-[var(--surface)]"
      >
        <span className="text-[15px] font-semibold text-[var(--tx)]">Answer a few questions instead</span>
        <span className="mt-1.5 block max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
          Paste your resume, answer eight short questions, and the app writes your positioning, career narrative and
          the rules it judges roles by. You correct what it got wrong.
        </span>
      </Link>

      <ol className="space-y-3">
        {steps.map((step, i) => (
          <li
            key={step.id}
            className={`rounded-xl border p-4 ${
              step.connected ? "border-line bg-[var(--surface)]" : "border-line-2 bg-[var(--surface-2)]"
            }`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h2 className="text-[15px] font-semibold text-[var(--tx)]">
                <span className="mr-2 font-mono text-[12px] text-[var(--tx-3)]">{i + 1}</span>
                {step.title}
              </h2>
              {step.connected ? (
                <span className="text-[11.5px] text-[var(--mint)]">
                  on{step.detail ? ` · ${step.detail}` : ""}
                </span>
              ) : (
                <span className="text-[11.5px] text-[var(--tx-3)]">not set up</span>
              )}
            </div>

            <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">{step.why}</p>

            {/* What it buys, not what it breaks. */}
            <p className="mt-1.5 max-w-[62ch] text-[12.5px] leading-relaxed text-[var(--tx-3)]">
              <span className="font-medium">Turns on:</span> {step.unlocks}
            </p>

            <Link
              href={step.href}
              className={`mt-3 inline-block ${buttonClass(step.connected ? "outline" : "primary", "sm")}`}
            >
              {step.action}
            </Link>
          </li>
        ))}
      </ol>

      <section className={`${SECTION_GAP} border-t border-line pt-6`}>
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">
          What this instance is
        </h2>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
          This deployment is yours alone: its own database, its own Google connections, its own model keys. There is
          no shared tenancy, so there is no query in the app that could reach somebody else&apos;s job search, and
          none that could reach yours. That is a deliberate trade. It means updates arrive as new deployments rather
          than appearing silently, and it means the only account billed for model calls is yours.
        </p>
        <p className="mt-2 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">
          Model keys are encrypted before they are stored, under a secret held only in this deployment&apos;s
          environment, and are never displayed again once saved.
        </p>
      </section>
    </div>
  );
}
