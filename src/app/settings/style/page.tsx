import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { buttonClass, inputClass } from "@/lib/button";
import { toUSSpelling, enforceHouseLanguage } from "@/lib/contact-block";
import { ThemeTokens } from "@/components/ThemeTokens";
import { ThemePalette } from "@/components/ThemePalette";
import { StatusBadge } from "@/components/StatusBadge";
import { RecommendationBadge } from "@/components/RecommendationBadge";
import { PAGE_TITLE, PAGE_TITLE_HERO, PAGE_TITLE_COMPACT, PAGE_LEDE, SECTION_GAP } from "@/lib/type";
import { TENANT_ID } from "@/lib/tenant";

export const dynamic = "force-dynamic";

/**
 * The design system, rendered by the code that implements it.
 *
 * A style guide that restates its rules in prose is another copy of them, and
 * this project knows what that costs: the single-page resume rule lived in four
 * places and changing one left three contradicting it. So nothing here is
 * described where it can be shown. The type scale is set in the real constants,
 * the buttons are `buttonClass`, the badges are the real components, the
 * spelling runs through the real normalizer, the contrast ratios are computed
 * from the running page, and the writing rules are read from the Profile row
 * every model call is grounded in.
 *
 * If this page and the app ever disagree, the page is not stale. Something is
 * broken.
 *
 * The first version was a list of rules with a swatch dump attached, which Dan
 * correctly said was not what a design system looks like. What was missing was
 * the part that makes one useful: the scale shown at size, components in every
 * state including the ones you forget, contrast measured rather than asserted,
 * and paired examples of the thing and its common mistake.
 */

const SPELLING_EXAMPLES = ["traveller", "centre", "centred", "organisation", "modernised", "SPECIALIST", "expertise"];

const TYPE_SCALE: { name: string; cls: string; use: string }[] = [
  { name: "PAGE_TITLE_HERO", cls: PAGE_TITLE_HERO, use: "Today only. One statement, nothing beside it." },
  { name: "PAGE_TITLE", cls: PAGE_TITLE, use: "Every other page title." },
  { name: "PAGE_TITLE_COMPACT", cls: PAGE_TITLE_COMPACT, use: "Transient narrow pages, currently /share." },
  { name: "PAGE_LEDE", cls: PAGE_LEDE, use: "The sentence under a page title." },
  { name: "Section heading", cls: "text-[17px] font-semibold text-[var(--tx)]", use: "A section within a page." },
  { name: "Panel heading", cls: "text-sm font-semibold text-[var(--tx)]", use: "The title of a panel." },
  { name: "Body", cls: "text-[13px] leading-relaxed text-[var(--tx-2)]", use: "Most prose." },
  { name: "Detail", cls: "text-[12.5px] text-[var(--tx-3)]", use: "Supporting lines under a row." },
  { name: "Micro", cls: "text-[11px] font-medium uppercase tracking-wide text-[var(--tx-3)]", use: "Field labels." },
];

export default async function StyleGuidePage() {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: { standingPreferences: true },
  });

  const houseRules = (profile?.standingPreferences ?? "")
    .split("\n")
    .filter((l) => /US English|US spelling|em-dash|en-dash|preposition|complete sentence|Arial/i.test(l))
    .map((l) => l.replace(/^[-\d.\s]+/, "").trim())
    .filter(Boolean);

  // Escapes, not the characters. The audit forbids a literal em-dash in UI
  // text and it caught this page on its first ship, correctly: an example that
  // teaches a rule looks exactly like a violation of it.
  const dashExample = "A sentence \u2014 with an em-dash \u2014 and a range 2013\u20132022.";

  // Assembled from parts. Tailwind scans every source file including comments,
  // so writing this class out generates a rule from a deliberately invalid
  // variable name, which is invalid CSS and took down globals.css twice.
  const D = "-".repeat(2);
  const BG = "bg-";
  const invisibleExample = `${BG}[var(${D}accent)]`;
  const validExample = `${BG}[var(${D}amber)]`;

  return (
    <div className="max-w-3xl pb-20">
      <p className="text-[12.5px] text-[var(--tx-3)]">
        <Link href="/settings" className="hover:underline">
          Settings
        </Link>{" "}
        / Style
      </p>
      <h1 className={`mt-1 ${PAGE_TITLE}`}>Design system</h1>
      <p className="mt-2.5 max-w-[62ch] text-[13.5px] leading-relaxed text-[var(--tx-2)]">
        Everything below is rendered by the code that implements it. The scale comes from the real constants, the
        buttons from <span className="font-mono text-[12px]">buttonClass</span>, the badges are the components
        themselves, and the contrast ratios are measured on this page as you look at it. Nothing here is a
        description that could quietly stop being true.
      </p>

      <Group title="Foundations" />

      <Section
        title="Type scale"
        note="Nine levels, each shown at its real size. Adding a tenth needs a reason that can be written down, not a page that looked better slightly bigger."
      >
        <div className="space-y-5">
          {TYPE_SCALE.map((t) => (
            <div key={t.name} className="border-t border-line pt-4 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[11px] text-[var(--tx-3)]">{t.name}</span>
                <span className="text-[11.5px] text-[var(--tx-3)]">{t.use}</span>
              </div>
              <p className={`mt-1.5 ${t.cls}`}>The quick brown fox</p>
            </div>
          ))}
        </div>
        <Note>
          There were four page-title treatments before this existed, and no single page looked wrong. The drift
          was only visible in the transition: Pipeline, Contacts and Companies went 40, 46, 40 across the desktop
          breakpoint, which reads as the interface changing under you.
        </Note>
      </Section>

      <Section
        title="Color, measured"
        note="Contrast ratios for the pairings the interface actually uses, computed live from the running page. Switch themes and these follow."
      >
        <ThemePalette />
      </Section>

      <Section title="Tokens" note="Every color variable in force right now, in the active theme.">
        <ThemeTokens />
        <Note>
          Tokens declared inside <span className="font-mono">@theme</span> become utilities, so write{" "}
          <span className="font-mono">bg-accent</span>. Only variables declared outside it are safe in an
          arbitrary value like <span className="font-mono">{validExample}</span>. Writing{" "}
          <span className="font-mono">{invisibleExample}</span> resolves to nothing and leaves a correctly sized,
          completely invisible button. The audit checks this on every ship.
        </Note>
      </Section>

      <Group title="Components" />

      <Section title="Buttons" note="Four variants, two sizes, and the states that get forgotten.">
        <div className="space-y-3">
          {(["primary", "danger", "outline", "quiet"] as const).map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-3">
              <span className="w-16 shrink-0 text-[11px] uppercase tracking-wide text-[var(--tx-3)]">{variant}</span>
              <span className={buttonClass(variant, "sm")}>Small</span>
              <span className={buttonClass(variant, "md")}>Medium</span>
              <button type="button" disabled className={buttonClass(variant, "md")}>
                Disabled
              </button>
            </div>
          ))}
        </div>
        <Note>
          The primary fill was written eleven different ways before <span className="font-mono">buttonClass</span>{" "}
          existed, because nothing answered the question and each new one was measured by eye against its
          neighbour. Destructive actions go through <span className="font-mono">ConfirmButton</span>, which arms
          in place and names the specific thing. No <span className="font-mono">window.confirm</span> anywhere: it
          renders outside the page, cannot be themed, and takes the whole screen on iOS.
        </Note>
      </Section>

      <Section title="Status and verdict" note="The two badge families, rendered by the real components.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {(["TARGET", "LIVE_POSTING_FOUND", "APPLIED", "INTERVIEWING", "OFFER", "PASSED", "CLOSED_REJECTED"] as const).map(
              (s) => (
                <StatusBadge key={s} status={s} />
              )
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(["swing", "stretch", "pass"] as const).map((r) => (
              <RecommendationBadge key={r} recommendation={r} />
            ))}
          </div>
        </div>
        <Note>
          Status is what Dan decided. The verdict is what the models think. They are kept apart deliberately,
          because a verdict changes when an evaluation is re-run and a status mirroring it would drift.
        </Note>
      </Section>

      <Section title="Form fields" note="One shape, so a form does not read as assembled from parts.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-[var(--tx-2)]">Text field</span>
            <input
              readOnly
              defaultValue="Managing Director"
              className={`mt-1 ${inputClass("md")}`}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-[var(--tx-2)]">Select</span>
            <select className={`mt-1 ${inputClass("md")}`} defaultValue="a">
              <option value="a">Interviewing</option>
            </select>
          </label>
        </div>
        <Note>
          Any form rendering server data carries a <span className="font-mono">key</span> derived from that data.
          React will not reset an uncontrolled input, so a stale box plus Save is silent data loss, and several
          fields here are written by the mail sync and the importer as well as by hand.
        </Note>
      </Section>

      <Group title="Patterns" />

      <Section title="Do and do not" note="The mistakes this interface has actually made, beside the fix.">
        <div className="space-y-5">
          <DoDont
            wrong="4 live conversations"
            right="4 live conversations, each listed underneath"
            why="A count with nothing to click tells you something is happening and gives you no way to reach it. A number and its destination must be computed from one definition."
          />
          <DoDont
            wrong={`"Draft to this person not sent yet" opens the role page`}
            right={`"Draft to this person not sent yet" opens the draft`}
            why="Read the row aloud, then check the link does that exact thing. A row is a sentence promising one action."
          />
          <DoDont
            wrong="Collapse an expensive section in a <details>"
            right="Put it behind the URL and gate the query"
            why="Hidden is not unrendered. The dashboard shipped 96 table rows to display 3 open items, all built, serialized and sent, then hidden with CSS."
          />
          <DoDont
            wrong="window.confirm('Are you sure?')"
            right="Arm in place, naming the thing: Delete this contact?"
            why="The row stays on screen while you decide, which a modal covering the page destroys."
          />
          <DoDont
            wrong="Save, and the page looks unchanged"
            right="The button becomes Saved once the values match"
            why="A control that did something must show that it did, and one that can do nothing must say so before it is pressed."
          />
        </div>
      </Section>

      <Section title="Page anatomy" note="The order every page follows.">
        <ol className="space-y-2 text-[13px] leading-relaxed text-[var(--tx-2)]">
          <li>
            <span className="font-medium text-[var(--tx)]">1. Title</span>, from the scale above, with nothing
            parked beside it.
          </li>
          <li>
            <span className="font-medium text-[var(--tx)]">2. One sentence</span> saying what the page answers.
          </li>
          <li>
            <span className="font-medium text-[var(--tx)]">3. The work</span>, in the order it is done.
          </li>
          <li>
            <span className="font-medium text-[var(--tx)]">4. Reference and archive</span>, behind the URL.
          </li>
        </ol>
        <Note>
          One route, one question. If a page needs the word &ldquo;and&rdquo; to describe it, it is two pages, and
          the nav label must be the same sentence as the page&apos;s job.
        </Note>
      </Section>

      <Group title="Writing" />

      <Section
        title="House rules"
        note="Read from the Profile row every model call is grounded in, so this is literally what Claude is told."
      >
        {houseRules.length > 0 ? (
          <ul className="space-y-2">
            {houseRules.map((r, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-[var(--tx-2)]">
                {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-[var(--tx-3)]">No writing rules found in the Profile row.</p>
        )}
      </Section>

      <Section title="US spelling" note="Run through the real normalizer at request time.">
        <div className="grid grid-cols-1 gap-x-8 gap-y-1.5 sm:grid-cols-2">
          {SPELLING_EXAMPLES.map((word) => {
            const fixed = toUSSpelling(word);
            const changed = fixed !== word;
            return (
              <div key={word} className="flex items-baseline gap-2 text-[13px]">
                <span className={changed ? "text-[var(--tx-3)] line-through" : "text-[var(--tx-3)]"}>{word}</span>
                {changed && (
                  <>
                    <span className="text-[var(--tx-3)]">&#8594;</span>
                    <span className="text-[var(--tx)]">{fixed}</span>
                  </>
                )}
                {!changed && <span className="text-[11px] text-[var(--mint)]">already correct</span>}
              </div>
            );
          })}
        </div>
        <Note>
          Capitalization is preserved in three forms, not two: ALL CAPS stays all caps, Title Case stays title
          case, everything else lowers. A version that only asked whether a word started with a capital rewrote
          SPECIALIST as SpecialisT.
        </Note>
      </Section>

      <Section title="Dashes" note="None, anywhere, in documents or in the interface.">
        <p className="text-[13px] text-[var(--tx-3)]">{dashExample}</p>
        <p className="mt-1 text-[13px] text-[var(--tx)]">{enforceHouseLanguage(dashExample)}</p>
      </Section>

      <Group title="Principles" />

      <Section title="Why so little of this page is prose">
        <p className="text-[13px] leading-relaxed text-[var(--tx-2)]">
          A prompt instruction is a request. Where a model getting it wrong produces something silently wrong
          rather than an error, it is repaired in code instead. That is why US spelling is a function and not a
          sentence, why a resume missing an employer refuses to save, why a form value cannot reach the{" "}
          <span className="font-mono">Date</span> constructor, and why{" "}
          <span className="font-mono">scripts/audit.ts</span> blocks a ship with findings. Every check in it
          exists because something reached production and was found by hand afterwards.
        </p>
      </Section>
    </div>
  );
}

function Group({ title }: { title: string }) {
  return (
    <h2 className="mt-14 border-b border-line pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--tx-3)]">
      {title}
    </h2>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className={`${SECTION_GAP}`}>
      <h3 className="text-[17px] font-semibold text-[var(--tx)]">{title}</h3>
      {note && <p className="mt-1 max-w-[62ch] text-[12.5px] leading-relaxed text-[var(--tx-3)]">{note}</p>}
      <div className="mt-4 rounded-xl border border-line p-4">{children}</div>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-relaxed text-[var(--tx-3)]">{children}</p>;
}

function DoDont({ wrong, right, why }: { wrong: string; right: string; why: string }) {
  return (
    <div className="border-t border-line pt-4 first:border-t-0 first:pt-0">
      <p className="text-[13px] text-flame">
        <span className="mr-1.5 font-medium">Not</span>
        {wrong}
      </p>
      <p className="mt-1 text-[13px] text-[var(--mint)]">
        <span className="mr-1.5 font-medium">But</span>
        {right}
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--tx-3)]">{why}</p>
    </div>
  );
}
