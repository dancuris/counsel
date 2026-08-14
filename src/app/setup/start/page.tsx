import Link from "next/link";
import { onboardingState, SEARCH_QUESTIONS } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";
import { TENANT_ID } from "@/lib/tenant";
import { credentialStatuses } from "@/lib/credentials";
import { parseLabelled, formatLabelledLines } from "@/lib/contact-block";
import { buttonClass, inputClass } from "@/lib/button";
import { SubmitButton } from "@/components/SubmitButton";
import { PAGE_TITLE, PAGE_LEDE, PAGE_READING, PAGE_HEADER } from "@/lib/type";
import { DeriveProfile } from "@/components/DeriveProfile";
import { saveIdentity, saveResume, saveAnswers, saveVoiceSample, saveModelKey } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Setting the app up by answering questions, rather than by filling in the
 * fields it stores.
 *
 * The distinction is the whole design. `/setup` is the standing view of what is
 * connected, returned to whenever something changes. This is the run somebody
 * makes once, and the reason it can be finished is that it never asks for the
 * long prose: eight short questions and a resume paste go in, and the model
 * writes the positioning, the narrative and the evaluation rules, which are
 * then shown back to be corrected.
 *
 * Each step saves on submit, so there is no accumulated state to lose, and the
 * step somebody is on is derived from the data rather than remembered. Coming
 * back later lands on the first thing still unanswered.
 */
export default async function SetupStartPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; saved?: string }>;
}) {
  const { step: requested, saved } = await searchParams;
  const state = await onboardingState();

  // The step asked for, else the first unfinished one, else the last.
  const current =
    state.steps.find((s) => s.id === requested) ?? state.next ?? state.steps[state.steps.length - 1];
  const done = state.steps.filter((s) => s.done).length;

  return (
    <div className={PAGE_READING}>
      <header className={PAGE_HEADER}>
        <h1 className={PAGE_TITLE}>Set up Counsel</h1>
        <p className={PAGE_LEDE}>
          A few questions, and a resume to paste. The app writes the rest and shows it to you to correct.{" "}
          {done} of {state.steps.length} done.
        </p>
      </header>

      {/* The rail. Every step is reachable, so nothing traps you. */}
      <ol className="mb-8 flex flex-wrap gap-1.5">
        {state.steps.map((s, i) => {
          const active = s.id === current.id;
          return (
            <li key={s.id}>
              <Link
                href={`/setup/start?step=${s.id}`}
                aria-current={active ? "step" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-colors ${
                  active
                    ? "border-line-2 bg-[var(--surface-2)] font-medium text-[var(--tx)]"
                    : "border-line text-[var(--tx-3)] hover:bg-[var(--surface-2)]"
                }`}
              >
                <span className={s.done ? "text-[var(--mint)]" : "font-mono text-[var(--tx-3)]"}>
                  {s.done ? "✓" : i + 1}
                </span>
                {s.title}
              </Link>
            </li>
          );
        })}
      </ol>

      <section>
        <h2 className="text-[17px] font-semibold text-[var(--tx)]">
          {current.title}
          {current.optional && <span className="ml-2 text-[12px] font-normal text-[var(--tx-3)]">optional</span>}
        </h2>
        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-relaxed text-[var(--tx-2)]">{current.purpose}</p>

        <div className="mt-6">
          {current.id === "identity" && <IdentityStep />}
          {current.id === "resume" && <ResumeStep />}
          {current.id === "search" && <SearchStep answers={state.answers} />}
          {current.id === "voice" && <VoiceStep />}
          {current.id === "model" && <ModelStep />}
          {current.id === "derive" && <DeriveStep saved={saved === "1"} />}
        </div>
      </section>

      <p className="mt-10 border-t border-line pt-4 text-[13px] text-[var(--tx-3)]">
        You can leave and come back. Everything is saved as you answer it, and{" "}
        <Link href="/setup" className="underline hover:text-[var(--tx)]">
          the setup page
        </Link>{" "}
        shows what is connected at any time.
      </p>
    </div>
  );
}

const LABEL = "block text-[12.5px] font-medium text-[var(--tx)]";
const HINT = "mt-1 max-w-[62ch] text-[12px] leading-relaxed text-[var(--tx-3)]";
const FIELD = "mt-5 first:mt-0";

async function IdentityStep() {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: {
      contactName: true,
      contactPhone: true,
      contactLinks: true,
      contactEmails: true,
      contactAddresses: true,
    },
  });

  return (
    <form action={saveIdentity}>
      <div className={FIELD}>
        <label className={LABEL} htmlFor="contactName">
          Your name
        </label>
        <p className={HINT}>As it should appear at the top of a resume.</p>
        <input
          id="contactName"
          name="contactName"
          required
          defaultValue={profile?.contactName ?? ""}
          placeholder="Alex Moreno"
          className={`mt-2 ${inputClass("md")}`}
        />
      </div>

      <div className={FIELD}>
        <label className={LABEL} htmlFor="contactEmails">
          Email addresses
        </label>
        <p className={HINT}>
          One per line. Label them if you have more than one, like <code>Work: alex@example.com</code>, and the app
          will let you pick which goes on a given document.
        </p>
        <textarea
          id="contactEmails"
          name="contactEmails"
          required
          rows={3}
          defaultValue={formatLabelledLines(parseLabelled(profile?.contactEmails))}
          placeholder={"Personal: alex@example.com\nJob search: alex.moreno.jobs@example.com"}
          className={`mt-2 ${inputClass("md")}`}
        />
      </div>

      <div className={FIELD}>
        <label className={LABEL} htmlFor="contactPhone">
          Phone
        </label>
        <input
          id="contactPhone"
          name="contactPhone"
          defaultValue={profile?.contactPhone ?? ""}
          placeholder="203-555-0142"
          className={`mt-2 ${inputClass("md")}`}
        />
      </div>

      <div className={FIELD}>
        <label className={LABEL} htmlFor="contactAddresses">
          Addresses
        </label>
        <p className={HINT}>One per line, labeled the same way. Only the city and state reach a cover letter.</p>
        <textarea
          id="contactAddresses"
          name="contactAddresses"
          rows={3}
          defaultValue={formatLabelledLines(parseLabelled(profile?.contactAddresses))}
          placeholder={"Home: 12 Some Street, Southport, CT 06890"}
          className={`mt-2 ${inputClass("md")}`}
        />
      </div>

      <div className={FIELD}>
        <label className={LABEL} htmlFor="contactLinks">
          Links
        </label>
        <p className={HINT}>LinkedIn, a portfolio, anything you want on the letterhead.</p>
        <input
          id="contactLinks"
          name="contactLinks"
          defaultValue={profile?.contactLinks ?? ""}
          placeholder="linkedin.com/in/alex-moreno"
          className={`mt-2 ${inputClass("md")}`}
        />
      </div>

      <SubmitButton className={buttonClass("primary", "md", "mt-7")} pendingLabel="Saving">
        Save and continue
      </SubmitButton>
    </form>
  );
}

async function ResumeStep() {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: { masterResume: true },
  });

  return (
    <form action={saveResume}>
      <div className={FIELD}>
        <label className={LABEL} htmlFor="masterResume">
          Paste your resume
        </label>
        <p className={HINT}>
          The whole thing, plain text, straight out of Word or a PDF. Formatting does not matter and neither do stray
          line breaks: the next step reads it and lays it out. What matters is that nothing is missing, because
          everything the app writes later is cut from this and it will never add a job that is not here.
        </p>
        <textarea
          id="masterResume"
          name="masterResume"
          required
          rows={18}
          defaultValue={profile?.masterResume ?? ""}
          placeholder="Alex Moreno&#10;&#10;EXPERIENCE&#10;&#10;Vice President, Engineering | Northwind Health&#10;Mar 2021 to present&#10;- Ran the platform team..."
          className={`mt-2 font-mono text-[12px] ${inputClass("md")}`}
        />
      </div>
      <SubmitButton className={buttonClass("primary", "md", "mt-7")} pendingLabel="Saving">
        Save and continue
      </SubmitButton>
    </form>
  );
}

function SearchStep({ answers }: { answers: Record<string, string> }) {
  return (
    <form action={saveAnswers}>
      {SEARCH_QUESTIONS.map((question) => (
        <div key={question.name} className={FIELD}>
          <label className={LABEL} htmlFor={question.name}>
            {question.label}
            {question.optional && <span className="ml-2 font-normal text-[var(--tx-3)]">optional</span>}
          </label>
          <p className={HINT}>{question.hint}</p>
          <textarea
            id={question.name}
            name={question.name}
            rows={question.rows ?? 3}
            defaultValue={answers[question.name] ?? ""}
            placeholder={question.placeholder}
            className={`mt-2 ${inputClass("md")}`}
          />
        </div>
      ))}
      <SubmitButton className={buttonClass("primary", "md", "mt-7")} pendingLabel="Saving">
        Save and continue
      </SubmitButton>
    </form>
  );
}

async function VoiceStep() {
  const sample = await prisma.coverLetterSample.findFirst({ orderBy: { updatedAt: "desc" } });

  return (
    <form action={saveVoiceSample}>
      <div className={FIELD}>
        <label className={LABEL} htmlFor="voice-name">
          What to call it
        </label>
        <input
          id="voice-name"
          name="name"
          defaultValue={sample?.name ?? "My letter"}
          className={`mt-2 ${inputClass("md")}`}
        />
      </div>
      <div className={FIELD}>
        <label className={LABEL} htmlFor="content">
          Paste a cover letter you are happy with
        </label>
        <p className={HINT}>
          It is read as a reference for how you write, never copied. The company it names and anything it claims stay
          with that application: the app is told explicitly that its facts do not belong to any other role.
        </p>
        <textarea
          id="content"
          name="content"
          rows={14}
          defaultValue={sample?.content ?? ""}
          placeholder="Dear hiring manager,&#10;&#10;I am writing about..."
          className={`mt-2 ${inputClass("md")}`}
        />
      </div>
      <div className="mt-7 flex items-center gap-3">
        <SubmitButton className={buttonClass("primary", "md")} pendingLabel="Saving">
          Save and continue
        </SubmitButton>
        <Link href="/setup/start?step=model" className="text-[13px] text-[var(--tx-3)] underline hover:text-[var(--tx)]">
          Skip this
        </Link>
      </div>
    </form>
  );
}

async function ModelStep() {
  const credentials = await credentialStatuses();

  return (
    <div>
      <ul className="mb-6 space-y-2">
        {credentials.map((credential) => (
          <li
            key={credential.kind}
            className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line bg-[var(--surface)] px-3 py-2 text-[13px]"
          >
            <span className="text-[var(--tx)]">{credential.label}</span>
            <span className="text-[12px] text-[var(--tx-3)]">
              {credential.configured
                ? `set${credential.hint ? ` · ends ${credential.hint}` : ""}${
                    credential.source === "environment" ? " · from the environment" : ""
                  }`
                : "not set"}
            </span>
          </li>
        ))}
      </ul>

      <form action={saveModelKey}>
        <div className={FIELD}>
          <label className={LABEL} htmlFor="kind">
            Which one
          </label>
          <p className={HINT}>
            Either works. Whichever you set is the one billed, and the key is encrypted before it is stored and never
            shown again.
          </p>
          <select id="kind" name="kind" defaultValue="anthropic" className={`mt-2 ${inputClass("md")}`}>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Google Gemini</option>
          </select>
        </div>
        <div className={FIELD}>
          <label className={LABEL} htmlFor="key">
            The key
          </label>
          <input
            id="key"
            name="key"
            type="password"
            autoComplete="off"
            placeholder="sk-ant-..."
            className={`mt-2 ${inputClass("md")}`}
          />
        </div>
        <div className="mt-7 flex items-center gap-3">
          <SubmitButton className={buttonClass("primary", "md")} pendingLabel="Saving">
            Save and continue
          </SubmitButton>
          <Link
            href="/setup/start?step=derive"
            className="text-[13px] text-[var(--tx-3)] underline hover:text-[var(--tx)]"
          >
            Skip this
          </Link>
        </div>
      </form>
    </div>
  );
}

async function DeriveStep({ saved }: { saved: boolean }) {
  const [profile, providers] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: TENANT_ID },
      select: {
        positioning: true,
        careerNarrative: true,
        personalLogistics: true,
        evaluationFramework: true,
        standingPreferences: true,
        masterResume: true,
      },
    }),
    credentialStatuses(),
  ]);

  return (
    <DeriveProfile
      hasResume={Boolean(profile?.masterResume?.trim())}
      hasModel={providers.some((p) => p.configured)}
      saved={saved}
      profile={{
        positioning: profile?.positioning ?? "",
        careerNarrative: profile?.careerNarrative ?? "",
        personalLogistics: profile?.personalLogistics ?? "",
        evaluationFramework: profile?.evaluationFramework ?? "",
        standingPreferences: profile?.standingPreferences ?? "",
      }}
    />
  );
}
