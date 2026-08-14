/**
 * Every failure mode this app has actually shipped, as a check that can be
 * re-run.
 *
 * All of these were found by hand after something looked wrong on screen, and
 * every one of them is invisible in a build: the code compiles, the button
 * renders, the save succeeds. That is the whole reason for the file.
 *
 * Run: npx tsx --env-file=.env.local scripts/audit.ts
 */
import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";
import { prisma } from "../src/lib/prisma";

const SRC = "src";

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "generated" || name === "node_modules") continue;
      walk(path, out);
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

const files = walk(SRC);
const read = (f: string) => readFileSync(f, "utf8");
const rel = (f: string) => f.replace(/^src\//, "");

type Finding = { check: string; detail: string };
const findings: Finding[] = [];
const add = (check: string, detail: string) => findings.push({ check, detail });

// 1. CSS variables that do not exist. Renders as an invisible element rather
//    than a broken one, so it survives review and a build.
{
  const css = read("src/app/globals.css");
  const defined = new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]));
  // Comments are stripped first. A comment naming the wrong variable in order
  // to warn about it is exactly the kind of false positive that teaches people
  // to skim past this whole report.
  const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // `.ts` as well as `.tsx`. Shared class strings live in `src/lib` - the
  // button, input and error constants - and scanning only components let an
  // `ERROR_BLOCK` referring to a `var(--flame)` that exists solely inside
  // `@theme` slip straight through the check written to catch exactly that.
  for (const f of files.filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))) {
    if (f.includes("scripts/")) continue;
    for (const m of stripComments(read(f)).matchAll(/var\((--[a-zA-Z0-9-]+)\)/g)) {
      if (!defined.has(m[1])) add("undefined CSS variable", `${rel(f)} uses ${m[1]}`);
    }
  }
}

// 1b. Em-dashes and en-dashes in rendered UI text. Dan's standing preference
//     is that they never appear, and it had drifted back into sixteen places
//     across eight files - separators in pickers, role labels, meeting dates.
//     Comments are exempt: the rule is about what he reads on screen.
{
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const f of files.filter((f) => f.endsWith(".tsx"))) {
    const bare = stripComments(read(f));
    const n = (bare.match(/[\u2013\u2014]/g) ?? []).length;
    if (n > 0) add("em-dash in UI text", `${rel(f)} has ${n}`);
  }
}

// 1c. A wholesale body replacement in the composer that bypasses replaceBody.
//     The signature has been lost three times, twice from a path that set
//     `html` directly and left the checkbox claiming it was on. An updater
//     callback keeps whatever is there, and anything that builds the signature
//     itself is fine; a bare replacement is the shape that drops it.
//
//     Reads a window after the call rather than to end-of-line, because the
//     safe ones are formatted across several lines and a line-bounded check
//     reported all of them. An audit that cries wolf gets ignored.
{
  const src = read("src/components/ContactComposer.tsx");
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const m of stripped.matchAll(/setHtml\(/g)) {
    const window = stripped.slice(m.index, m.index + 260);
    if (/^setHtml\(\s*\(\s*(current|cur)\b/.test(window)) continue;
    if (window.includes("withSignature")) continue;
    if (/^setHtml\(\s*""\s*\)/.test(window)) continue;
    add(
      "composer sets the body without replaceBody",
      window.slice(0, 70).replace(/\s+/g, " ")
    );
  }
}

// 2. Model output written to a one-line field without cleanInlineText. This is
//    how a leaked tool-call fragment ended up stored as a salary.
{
  for (const f of files.filter((f) => f.includes("/api/") || f.endsWith("actions.ts"))) {
    const src = read(f);
    for (const field of ["roleTitle", "salaryRange", "companyName"]) {
      const re = new RegExp(`${field}:\\s*(input\\.|text|body\\?\\.|data\\.)[^,\\n]*`, "g");
      for (const m of src.matchAll(re)) {
        if (!m[0].includes("cleanInlineText")) add("unsanitised field write", `${rel(f)}: ${m[0].trim().slice(0, 70)}`);
      }
    }
  }
}

// 3. Slow routes with no time budget. Vercel kills them mid-call and the UI
//    shows a spinner that quietly stops.
{
  for (const f of files.filter((f) => f.endsWith("route.ts"))) {
    const src = read(f);
    const slow = /generateStructured|anthropic\.messages|models\.generateContent|renderPdf|renderDocx|googleapis\.com/.test(src);
    if (slow && !src.includes("maxDuration")) add("no maxDuration on a slow route", rel(f));
  }
}

// 4. A fetch whose failure is never checked. `.catch()` on res.json() is a
//    fine guard against a non-JSON body, so the thing to look for is the
//    absence of an `.ok` test anywhere near the call - that is what makes a
//    dead request look identical to a successful one.
{
  for (const f of files.filter((f) => f.endsWith(".tsx"))) {
    const src = read(f);
    for (const m of src.matchAll(/await fetch\(/g)) {
      const after = src.slice(m.index ?? 0, (m.index ?? 0) + 700);
      // Cut at the end of the enclosing function so the next call's check does
      // not cover for this one.
      const scope = after.split(/\n\s{0,4}\}\n/)[0];
      if (!/\.ok\b/.test(scope)) {
        const line = src.slice(0, m.index).split("\n").length;
        const url = after.match(/fetch\(\s*[`"']([^`"']+)/)?.[1] ?? "?";
        add("fetch with no res.ok check", `${rel(f)}:${line} -> ${url}`);
      }
    }
  }
}

// 5. Uncontrolled fields showing a value something else writes. Stale box plus
//    Save is silent data loss, not just a stale display.
{
  const WRITTEN_ELSEWHERE = ["notes", "salaryRange", "postingLink", "rawText", "status"];
  for (const f of files.filter((f) => f.endsWith(".tsx"))) {
    const src = read(f);
    for (const m of src.matchAll(/<form[\s\S]{0,900}?<\/form>/g)) {
      const form = m[0];
      if (!/defaultValue=/.test(form)) continue;
      if (/key=/.test(form)) continue;
      const risky = WRITTEN_ELSEWHERE.filter((n) => new RegExp(`name="${n}"`).test(form));
      if (risky.length) add("unkeyed form over server-written data", `${rel(f)}: ${risky.join(", ")}`);
    }
  }
}

// 6. Reads that can surface soft-deleted applications.
//
//    `NOT_DELETED` from `lib/data/applications` counts, and is the preferred
//    form: the filter was written by hand in sixteen places and a rule with
//    sixteen copies is a rule that will hold in fifteen. A literal `deletedAt`
//    still passes, because a query with a more specific condition sometimes
//    needs to spell it out.
{
  for (const f of files) {
    const src = read(f);
    if (f.includes("scripts/") || f.endsWith("data/applications.ts")) continue;
    for (const m of src.matchAll(/prisma\.jobApplication\.findMany\(\{[\s\S]{0,260}?\}\)/g)) {
      if (!m[0].includes("deletedAt") && !m[0].includes("NOT_DELETED")) {
        add("findMany without the soft-delete filter", `${rel(f)}`);
      }
    }
  }
}

// 11. A detail-page panel that no tab renders, or a tab with nothing in it.
//     Re-cutting the tabs is exactly when a section quietly disappears.
{
  const page = read("src/app/applications/[id]/page.tsx");
  // The mapping moved to a shared module when the page started building only
  // the active tab: it needs it too, so it could not stay a component
  // constant. Reading the old file made every panel look like an orphan.
  const tabs = read("src/lib/app-tabs.ts");
  // Props span lines, so this cannot be a single-line match.
  const rendered = new Set([...page.matchAll(/<Panel[\s\S]{0,80}?id="([a-z]+)"/g)].map((m) => m[1]));
  const mapped = new Set(
    [...tabs.matchAll(/panels: \[([^\]]+)\]/g)].flatMap((m) => m[1].split(",").map((x) => x.trim().replace(/"/g, "")))
  );
  for (const r of rendered) if (!mapped.has(r)) add("panel rendered but in no tab", r);
  for (const m of mapped) if (!rendered.has(m)) add("tab with no panel behind it", m);
}

// 12. Removed, and worth recording why.
//
//     There was a check here for `new Date(formValue)`. Its first run produced
//     three findings and all three were correct code. Tightening it meant
//     naming the legitimate cases, and once they were named the whole thing
//     could move into the type system: `readDateField` returns an object, so
//     `new Date(value)` no longer compiles and there is nothing left to detect.
//
//     The general point, since this file is full of pattern-matching: a check
//     is what you write when the type system cannot say it. Where it can, the
//     check is the worse tool, because it runs late, it has false positives,
//     and it needs maintaining. Deleting one is progress.

// 13. Two names for one timezone. `APP_TIMEZONE` is the constant; a literal
//     beside it is a second source of truth for the thing every displayed
//     time depends on.
{
  for (const f of files) {
    if (f.includes("scripts/") || f.endsWith("format.ts")) continue;
    const src = read(f);
    if (src.includes('"America/New_York"')) {
      add("hardcoded timezone; import APP_TIMEZONE", rel(f));
    }
  }
}

// 14. A helper exported from lib and redefined locally somewhere else.
//     `toLocalInput` existed twice and the two disagreed, so one page showed
//     the right interview time while the other stored the wrong one.
//     `looksLikeAPerson` was the same shape: the Inbox had its own copy.
{
  const exported = new Map<string, string>();
  for (const f of files) {
    if (!f.includes("/lib/")) continue;
    for (const m of read(f).matchAll(/^export function ([a-zA-Z][a-zA-Z0-9]*)/gm)) exported.set(m[1], rel(f));
  }
  for (const f of files) {
    if (f.includes("/lib/") || f.includes("scripts/")) continue;
    const src = read(f);
    for (const m of src.matchAll(/^(?:export )?function ([a-zA-Z][a-zA-Z0-9]*)/gm)) {
      const home = exported.get(m[1]);
      if (home) add(`"${m[1]}" is already exported from ${home}`, rel(f));
    }
  }
}

// 15. Employer-facing prose that skips the house rules.
//     Everything Dan sends outward runs through `enforceHouseLanguage`: em and
//     en dashes out, US spelling in. The application-answer route did not, and
//     that text is pasted straight into an employer's portal.
{
  const OUTWARD = [
    "src/app/api/applications/[id]/answer/route.ts",
    "src/app/api/contacts/[id]/draft/route.ts",
    "src/app/api/correspondence/route.ts",
    "src/app/api/correspondence/refine/route.ts",
    "src/app/api/documents/refine/route.ts",
    "src/app/api/generate-documents/route.ts",
  ];
  for (const p of OUTWARD) {
    const src = read(p);
    if (src && !src.includes("enforceHouseLanguage")) {
      add("outward-facing prose without enforceHouseLanguage", p);
    }
  }
}

// 16. British spelling in the app's own interface copy.
//
//     The house rule was only ever enforced on text sent outward - documents,
//     correspondence, employer answers. The interface itself was never checked,
//     and the person writing it defaults to British English, so the style guide
//     shipped with a section header reading "Colour". Dan found it on the page
//     whose entire subject is that rule.
//
//     Two deliberate exemptions, both the same shape as the Profile line that
//     must keep "optimize not optimise":
//       - `contact-block.ts` holds the replacement patterns, which are British
//         by definition.
//       - A word inside single quotes is being named rather than used, which is
//         how the release stories refer to 'traveller' and 'centre'.
{
  const BRITISH =
    /\b(colour|colours|behaviour|behavioural|favour|favours|labour|honour|centre|centres|centred|centring|organisation|organisations|organise|organises|organised|organising|recognise|recognises|recognised|modernise|modernises|modernised|optimise|optimises|optimised|prioritise|prioritisation|capitalise|capitalisation|normalise|normalises|normalised|normaliser|normalising|customise|customises|utilise|utilises|analyse|analyses|analysed|analysing|programme|programmes|licence|defence|practise|catalogue|dialogue|whilst|amongst|towards|traveller|travellers|cancelled|cancelling|modelled|modelling|labelled|labelling|judgement|enrolment|fulfilment|summarise|summarises|categorise|apologise|emphasise|standardise|realise|realises|minimise|maximise)\b/gi;

  for (const f of files) {
    if (f.endsWith("contact-block.ts") || f.includes("scripts/")) continue;
    const src = read(f);
    // Comments are not interface copy. Strip them before looking.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    const texts: string[] = [
      // JSX text nodes.
      ...[...code.matchAll(/>([^<>{}\n][^<>{}]{3,})</g)].map((m) => m[1]),
      // Props that reach the screen.
      ...[...code.matchAll(/(?:title|note|label|placeholder|question|confirmLabel|pendingLabel|hint|story|problem)[:=]\s*\{?"([^"]{3,})"/g)].map((m) => m[1]),
    ];

    const seen = new Set<string>();
    for (const t of texts) {
      for (const m of t.matchAll(BRITISH)) {
        // Quoted means named, not used.
        if (new RegExp(`'${m[0]}'`, "i").test(t)) continue;
        const key = `${m[0].toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        add(`British spelling in interface copy: "${m[0]}"`, rel(f));
      }
    }
  }
}

// 17. A page heading written by hand instead of using the shared scale.
//
//     There were four different page-title treatments across nine pages -
//     34/52, 34/46, 32/40 and 30/38 - with three ledes underneath them. No
//     single page looked wrong, which is why it lasted: the drift is only
//     visible in the transition between them, and Dan found it by toggling
//     Pipeline, Contacts and Companies and feeling the type change size.
//
//     Same fault and same fix as the eleven spellings of a primary button.
{
  for (const f of files.filter((f) => f.endsWith("page.tsx"))) {
    const src = read(f);
    for (const m of src.matchAll(/<h1[^>]*className="([^"]*)"/g)) {
      // Arbitrary values and Tailwind's own scale both count: `text-3xl` on
      // /releases slipped past a check that only looked for `text-[Npx]`.
      if (/text-\[\d/.test(m[1]) || /\btext-(xs|sm|base|lg|xl|\dxl)\b/.test(m[1])) {
        add("page heading not using the shared type scale", `${rel(f)}: ${m[1].slice(0, 60)}`);
      }
    }
  }
}

// 18. A form control or an action button styled by hand.
//
//     A sweep found seventeen spellings of a text input and eleven border
//     radii, three of them arbitrary values a pixel or two off the scale. None
//     of it was broken and no page looked wrong on its own; the drift is only
//     visible moving between pages, which is how Dan kept finding it and I
//     kept not.
//
//     Icon buttons are exempt: a 30px circular avatar is not an action button
//     and forcing it through `buttonClass` would be worse.
{
  for (const f of files.filter((f) => f.endsWith(".tsx"))) {
    if (f.endsWith("button.ts")) continue;
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "");

    for (const m of src.matchAll(/<input\b[^>]*className="([^"]*border[^"]*)"/g)) {
      add("input styled by hand; use inputClass", `${rel(f)}: ${m[1].slice(0, 50)}`);
    }

    for (const m of src.matchAll(/<button\b[^>]*className="([^"]*)"/g)) {
      const cls = m[1];
      if (/\bh-\[\d+px\]|\bh-\d+ w-\d+\b/.test(cls)) continue; // icon button
      if (/\b(bg-accent|bg-red-|border border-line)/.test(cls)) {
        add("button styled by hand; use buttonClass", `${rel(f)}: ${cls.slice(0, 50)}`);
      }
    }

    for (const m of src.matchAll(/\brounded-\[(\d+)px\]/g)) {
      add("arbitrary border radius; use the scale", `${rel(f)}: rounded-[${m[1]}px]`);
    }
  }
}

async function data() {
  // 7. Markup or model artefacts stored in one-line fields.
  const apps = await prisma.jobApplication.findMany({ where: { deletedAt: null }, include: { company: true } });
  for (const a of apps) {
    const blob = `${a.roleTitle} ${a.salaryRange ?? ""} ${a.company.name}`;
    if (/antml|<[a-z/]|&[a-z]{2,6};/i.test(blob)) add("markup in a stored field", `${a.company.name} - ${a.roleTitle}`);
  }

  // 8. Companies that are the same employer spelled two ways.
  const companies = await prisma.company.findMany({
    where: { applications: { some: { deletedAt: null } } },
    select: { name: true },
  });
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const byNorm = new Map<string, string[]>();
  for (const c of companies) byNorm.set(norm(c.name), [...(byNorm.get(norm(c.name)) ?? []), c.name]);
  for (const [, names] of byNorm) if (names.length > 1) add("duplicate company", names.join("  vs  "));

  // 9. Documents that can neither be rendered nor opened.
  const orphaned = await prisma.document.count({
    where: { content: "", driveFileIdDocx: null, driveFileIdPdf: null },
  });
  if (orphaned) add("document with no content and no file", `${orphaned} rows`);

  // 10. A pointer document that would upload a blank file over the real one.
  //     Guarded in code now; this catches a regression.
  const pointers = await prisma.document.findMany({
    where: { content: "", driveFileIdDocx: { not: null } },
    select: { id: true },
  });
  if (pointers.length) add("info: Drive pointer documents", `${pointers.length} (expected - adopted from Drive)`);

  // 11. Earlier Experience is copied verbatim out of the chosen variant, so an
  //     entry that does not match its neighbours reaches every generated resume
  //     unaltered. The LEGO line was added with a trailing description clause
  //     and a full stop while the three around it were bare, and nothing caught
  //     it until a finished resume was read by eye. Every other check here is
  //     about code; this is the first one about what goes to an employer.
  // 12. A cover letter with no sign-off. `buildLetterHead` adds the salutation
  //     and nothing added the close, so all 69 letters in the archive ended on
  //     the last sentence of the body with no "Sincerely" and no name. The
  //     model is told the app supplies it and the app did not, which made the
  //     omission silent on both sides.
  const letters = await prisma.document.findMany({
    where: { type: "cover_letter" },
    orderBy: { generatedAt: "desc" },
    select: { applicationId: true, content: true, application: { select: { company: { select: { name: true } } } } },
  });
  const seenApp = new Set<string>();
  for (const l of letters) {
    // Only the newest per application is live; older rows are history.
    if (seenApp.has(l.applicationId)) continue;
    seenApp.add(l.applicationId);
    if (!l.content.trim()) continue;
    // Anchored to a line of its own near the end, not a word anywhere in the
    // body. The loose version missed a bare "Best," - which is how twenty of
    // the letters written before Counsel actually close - and reported them as
    // unsigned. That is the reading that motivated the bulk sign-off repair
    // which then destroyed 56 of them, so a false positive here is not a
    // cosmetic problem. It also used to match "regards" inside a sentence.
    const tail = l.content.trim().slice(-220);
    if (!/^\s*(sincerely|best|best regards|kind regards|regards|warmly|yours (sincerely|truly))\s*,?\s*$/im.test(tail)) {
      add("cover letter has no sign-off", l.application?.company.name ?? l.applicationId);
    }
  }

  const variants = await prisma.resumeVariant.findMany({ select: { name: true, content: true } });
  const prof = await prisma.profile.findFirst({ select: { masterResume: true } });
  const resumeSources = [
    ...variants.map((v) => ({ label: v.name, content: v.content })),
    ...(prof?.masterResume ? [{ label: "masterResume", content: prof.masterResume }] : []),
  ];

  for (const { label, content } of resumeSources) {
    const start = content.search(/earlier experience/i);
    if (start === -1) continue;
    const section = content.slice(start).split(/\n#{1,3} /)[0];
    const entries = section.split("\n").filter((l) => l.trim().startsWith("- "));

    // Each should read "Title, Employer (dates)" and stop. Anything past the
    // closing bracket is prose the other entries do not carry.
    for (const e of entries) {
      if (!e.includes("(")) continue;
      const tail = e.slice(e.lastIndexOf(")") + 1).trim();
      if (tail.length > 0) add("Earlier Experience entry differs in shape", `${label}: ${e.trim().slice(0, 72)}`);
    }
  }

  // A resume or cover letter that is too short to be one.
  //
  // The sign-off repair turned 56 cover letters into the 26 characters
  // "\n\nSincerely,\n\nDaniel Curis" and the Drive sync then wrote that over
  // the real files. Nothing failed: the rows saved, the uploads succeeded, the
  // letters were correctly signed. It surfaced only because a review pass
  // happened to read one months later, which is exactly the kind of silent
  // wrongness this audit exists to catch.
  //
  // Only the newest of each type per application, since earlier versions are
  // history and a short draft in the past is not a fault.
  const liveDocs = await prisma.document.findMany({
    where: { type: { in: ["resume", "cover_letter"] }, application: { deletedAt: null } },
    orderBy: { generatedAt: "desc" },
    select: {
      content: true,
      type: true,
      application: { select: { id: true, roleTitle: true, company: { select: { name: true } } } },
    },
  });
  const newestDoc = new Map<string, (typeof liveDocs)[number]>();
  for (const d of liveDocs) {
    const key = `${d.application.id}:${d.type}`;
    if (!newestDoc.has(key)) newestDoc.set(key, d);
  }
  // House language, checked rather than trusted. Both rules were in the
  // prompts from the start and both still leaked: toUSSpelling ran in one
  // route and nothing stripped a literal em-dash at all.
  // Named stems, not a suffix rule. "-ising" caught "raising" and "praising",
  // and an audit that cries wolf gets ignored - the reason check 4 was
  // tightened too.
  const BRITISH = new RegExp(
    "\\b(?:organis|modernis|recognis|prioritis|optimis|standardis|centralis|specialis(?!t)|" +
      "analyse|utilis|summaris|categoris|realis|personalis|customis|digitis|initialis|minimis|maximis|" +
      "apologis|emphasis(?=e)|harmonis|normalis|monetis)\\w*",
    "gi"
  );
  const ALLOWED = /^$/;
  for (const d of newestDoc.values()) {
    const dashes = (d.content.match(/[\u2014\u2013]/g) ?? []).length;
    if (dashes) add("Em-dash or en-dash in a document", `${d.application.company.name} ${d.type}: ${dashes}`);
    const brit = [...new Set(d.content.match(BRITISH) ?? [])].filter((w) => !ALLOWED.test(w));
    if (brit.length) add("British spelling in a document", `${d.application.company.name} ${d.type}: ${brit.join(", ")}`);
  }

  for (const d of newestDoc.values()) {
    const len = d.content.trim().length;
    // Zero is the adopted-from-Drive case, which is legitimate: the file is
    // the record and there is deliberately nothing stored here.
    if (len === 0 || len >= 600) continue;
    add(
      "Document too short to be real",
      `${d.application.company.name} - ${d.application.roleTitle} ${d.type}: ${len} chars`
    );
  }
}

// -- Identifying detail from one person's real job search --------------------
//
// This exists because the same question was answered "clean" twice and was
// wrong both times. The first sweep was case-sensitive, so uppercase forms
// survived; the second had quietly dropped the employer names from its pattern
// list. Both were done by grepping and reading the output, which is exactly
// the shape of check this codebase already says is not a gate.
//
// The names are the real recruiters, colleagues and employers this app was
// built against. They are engineering anecdotes, not data the app reads, and
// they must not travel with the code to anybody else.
//
// `PRIVATE.md` is deliberately exempt: it is the file that holds them, and it
// is excluded from anything published. `changelog.json` is generated from git
// subjects that are already immutable.
{
  // Patterns live in `.private-names`, which is gitignored. Publishing this
  // check would otherwise publish the exact list of real people and employers
  // it exists to keep out, which is the fault wearing a different hat.
  //
  // Absent file means no check. That is right for a clone that has nothing to
  // protect, and the operator's own working copy has the file.
  const patternFile = ".private-names";
  const rawPatterns = existsSync(patternFile)
    ? readFileSync(patternFile, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith("#"))
        .map((l) => l.split("=")[0])
    : [];

  if (rawPatterns.length > 0) {
    const IDENTIFYING = new RegExp(
      "\\b(" + rawPatterns.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")\\b",
      "gi"
    );

    for (const f of files) {
      const rp = rel(f);
      if (rp === "PRIVATE.md" || rp.includes("generated/changelog.json")) continue;
      const seen = new Set<string>();
      for (const m of read(f).matchAll(IDENTIFYING)) {
        const key = m[0].toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        add(`Identifying detail from the real job search: "${m[0]}"`, rp);
      }
    }
  }
}

async function main() {
  // The source checks need no database; the data checks do. CI has no
  // DATABASE_URL and should still run every static check, so `--static` skips
  // the second half rather than failing the whole run on a missing connection.
  //
  // Splitting it this way is deliberate: a check that only ever runs on one
  // laptop is a check that stops running the first time someone else ships.
  const staticOnly = process.argv.includes("--static");
  if (!staticOnly) await data();

  const groups = new Map<string, string[]>();
  for (const f of findings) groups.set(f.check, [...(groups.get(f.check) ?? []), f.detail]);

  console.log(`${files.length} source files checked${staticOnly ? " (source only)" : ""}\n`);
  if (groups.size === 0) {
    console.log("nothing found");
    process.exit(0);
  }
  for (const [check, details] of groups) {
    const info = check.startsWith("info:");
    console.log(`${info ? "  " : "! "}${check} (${details.length})`);
    for (const d of [...new Set(details)].slice(0, 12)) console.log(`     ${d}`);
    console.log();
  }
  const real = findings.filter((f) => !f.check.startsWith("info:")).length;
  console.log("=".repeat(58));
  console.log(`${real} to look at`);
  process.exit(0);
}

main();
