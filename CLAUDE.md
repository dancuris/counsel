@AGENTS.md

# Counsel

A private job-search assistant. One deployment per person, with its own
database: pipeline, honest fit evaluations, tailored resume and cover letter
generation, interview prep, and recruiter correspondence. See `README.md` for
the stack and how to run it.

This file is the engineering practice. Every rule here exists because the
opposite reached production once, and none of them are caught by a compiler:
the code builds, the button renders, the save succeeds, and the wrong thing is
stored.

`PRIVATE.md` holds the specifics behind each rule and is not published. It is
the case notes; this is the ruling. When a rule below seems arbitrary, the story
that produced it is in there.

## The user's own data is data, never a constant

**A fact about the person belongs in their database row, not in the source.**

This has to be checked before adding any capability that touches career facts.
An employer list written as a constant reads as correct forever on the machine
where it was written and is wrong on every other deployment, and it fails
silently: no exception, no failed build, just a confident well-formatted
document that is a lie about somebody's career.

Two derived rules:

- **Derive rather than list.** `src/lib/career.ts` reads employers off the
  resume itself. A hardcoded equivalent was found to be both stale and
  incomplete the moment the two were compared, which is the general case: a
  list stops matching the data the day after it is written.
- **Keep prompt examples fictional.** `Northwind Health`, never a real
  employer, so a format example can never be mistaken for an instruction.

## Model output is untrusted input

Tool definitions use `strict: true` with `additionalProperties: false`. Keep it.
It is not sufficient.

- **Check shape before iterating or interpolating.** A field specified as an
  array once came back as a string; `for...of` walked it character by character
  and wrote a 318,000-character document of `## undefined` to the database.
- **`strict` does not stop the model leaking its own tool syntax.** Fragments
  arrive *inside* well-formed string values, so the schema is satisfied.
  `stripToolCallLeak` removes them and returns null when only meta-commentary is
  left, so the caller can retry. It is intermittent, so one retry clears it.
- **Ask for the fewest fields the caller needs.** A tool taking both a subject
  and a body returned the greeting as the subject on every call. Collapsing it
  to one field fixed it permanently.
- **Validate before persisting.** An error the user can retry always beats
  malformed data in a live database.
- **When the model omitting something produces a silently wrong document rather
  than an error, repair it in code.** A prompt instruction is a request.

## A rule duplicated into code is not a rule

The same standing preference was once written in four places, and changing the
one that looked authoritative left three contradicting it.

So: preferences live in the profile data. Before changing one, **check the
routes are not holding their own copy**, because a preference hardcoded as a
budget or a schema description is a constant wearing a preference's clothes.

The same applies to sequences. Where two code paths do the same job, they
diverge, and the divergence is silent until somebody's output differs depending
on which ran.

## Never call `new Date()` on a `datetime-local` value

The field carries no offset, so it parses in the runtime's zone, which in
production is UTC. This shipped an interview four hours early into a real
calendar, and nothing looked wrong at any point: the parse was right, the
display was right, and the stored value was not.

`src/lib/local-time.ts` holds the only correct pair, and `FormDateValue` is an
object rather than a branded string specifically so that `new Date(value)` does
not compile.

## Nullable columns and `not:`

`{ field: { not: X } }` compiles to SQL `<> X`, which is **NULL-unsafe** and
silently drops every row where the column is null. Spell it out:

```ts
OR: [{ field: null }, { field: { not: X } }]
```

A query built this way once matched zero rows while reading as though it
matched most of them.

## Hidden is not unrendered

CSS visibility, `<details>`, and conditional rendering inside a client component
all hide things that were already built, serialized and sent. One page shipped
96 table rows to display three items.

**If the user cannot see it, do not build it.** Where the hidden thing is
expensive, gate the query as well as the markup.

## A form showing server data needs a key

An uncontrolled field keeps whatever it first rendered. `router.refresh()`
re-runs the server component but will not reset the input, so the box goes on
showing a value the database no longer holds, and saving writes it back.

Key each form on the fields it edits, not on the row's `updatedAt`, or an
unrelated write throws away what is being typed.

## Counts, and the things they count

- **A number in a headline needs its referent on the page.** A count with
  nothing to click tells you something is happening and gives you no way to
  reach it.
- **A count and its destination must come from one definition**, or they drift
  and the number becomes a lie about the page it links to.
- **A row must land on the thing it names, not near it.** Read the row's text
  aloud, then check the link does that exact thing. Every failure here went
  somewhere sensible, which is why they survived.

## Controls

- **Write the close before the content.** Anything that opens needs Escape and
  click-outside; a disclosure that pushes layout needs a visible close too,
  because the trigger may no longer be on screen.
- **A control that can do nothing must say so before it is pressed**, and one
  that did something must show that it did. A save that works and reports
  nothing reads as a broken button.
- **Destructive actions arm in place and name the specific thing.** Inline, so
  the row stays visible while you decide.
- **No native dialogs.** `window.confirm` and `window.prompt` cannot be themed
  and take the whole screen on iOS.
- **A patch that adds a control is usually the wrong patch.** One panel reached
  twenty-six controls, each added to clarify the last. The fix was deletion.
- **Show state before offering actions.**

## Writing surfaces

One composer. **If it can produce or change the text of a message, it belongs in
the existing editor or it does not exist.** A second editor is never a smaller
change than adding to the first.

When a surface is missing a capability, check whether another surface already
has it before building a third.

## Claims about the outside world

`status: "sent"` means the mail API returned an id, and exactly one code path
may write it. Everything else writes `draft`.

A weaker claim gets a weaker word: `sent_externally` means the user says they
sent it, and the interface says so rather than pretending. Any code testing for
"sent" has to decide consciously which of the two it means.

The app never overstates what it knows.

## Best-effort work never fails the thing it follows

Activity logging, Drive sync and deploy markers all run after the change has
committed and never throw. A status change that worked must not report as failed
because a log write did not.

Conversely, anything that would leave the system inconsistent must fail loudly
and change nothing.

## Bulk writes

Before any script that rewrites content across many rows:

- **Verify there is something to repair.** One repair appended a missing
  sign-off to 69 documents without asking whether there was a letter under it.
  56 were empty pointers, and the fix overwrote the real files.
- **Check the whole artifact, not the field you touched.** That repair was
  verified by confirming the letters were signed. They were. They were also
  empty.
- **"Content exists" is not "content is right".**
- **A crying-wolf check is not merely ignorable.** The audit that motivated
  that repair was itself a false positive.

## Append-only records

Documents and activity entries are never updated in place; a new row is the
current one and everything behind it is history. A log you can edit is not a
log.

## Soft deletes

Deleting sets a timestamp. **Every list read must filter it**, including
modules that reach the row through a relation. Reading a single record by id
deliberately still works, so a deleted one can be viewed and restored.

## Theme colors are tokens, not literals

The palette is declared in `@theme`, which produces utilities. Only variables
declared *outside* `@theme` are safe inside an arbitrary-value class.

`bg-[var(--accent)]` therefore resolves to nothing: CSS drops the declaration,
the background falls back to transparent, and text on top leaves a
correctly-sized, fully invisible element. It type-checks and it builds.

A literal color in a class name is a bug unless it is semantic.

## Layout

Something must constrain the width, or truncation and column widths do nothing.
Tables need `table-fixed`; grids need an explicit `grid-cols-1` even where it
looks redundant, because that is what emits `minmax(0, 1fr)`.

Verify with DOM measurements, never screenshots. Screenshots in an embedded
browser pane render at unreliable scale and have both invented bugs and hidden
real ones.

## US English everywhere, including the app's own screens

Interface copy, headings, button labels, error messages, release stories, commit
subjects. The rule was once enforced only on outbound documents, and the drift
went straight into the product: the style guide shipped with a British spelling
in a section header, on the page whose subject is this rule.

Check 16 in `scripts/audit.ts` reads JSX text and the props that reach the
screen, and fails the ship. **Content that teaches a rule looks exactly like
content that breaks it**, so a word being named rather than used goes in single
quotes. Do not exempt a whole file: an exemption also covers the next mistake in
it.

Comments and identifiers are out of scope. Commit subjects already in git are
immutable.

## No em-dashes or en-dashes

Anywhere. Plain first-person voice in documents, nothing over-eager, no preachy
closing lines.

## Ship with the script

`./scripts/ship.sh "message"` builds, tests, lints, audits, then commits and
pushes, and **exits** on a lint error or any audit finding.

It exists because a change once reached production carrying both a lint error
and an unchecked fetch, caught by the very commands running on the same shell
line as the push. Their output arrived after the deploy. "I ran the checks" and
"the checks passed" looked identical.

A check you read afterwards is not a gate. The same reasoning gives the story
gate: every ship carries a user-facing story, because a habit that depends on
remembering is not a habit.

## Run the audit after a run of changes

```bash
npx tsx --env-file=.env.local scripts/audit.ts
```

Every check exists because that exact fault reached production and was found by
hand afterwards. Keep them honest: tighten a check rather than living with false
positives, because an audit that cries wolf gets ignored.

## Read the backlog before starting work

```bash
npx tsx --env-file=.env.local scripts/backlog.ts
```

People running other instances can ask for things; approved and queued requests
are the backlog. Run it at the start of a session and say what is in it. Mark
something done when it ships.

## Local dev writes to the production database

There is no dev database and no seed data. Any write made while running locally
is immediately live, so never run resets or destructive queries, and test
against a throwaway record rather than a real one.

Conversely, data-only changes need no deploy.

## Deploying

`main` does not deploy to production; the production branch does. This is
deliberate, so an accidental push cannot reach the live site.

- **Fast-forward merges can skip the production deploy.** Both branches end up
  on the same sha and the build is attributed to whichever was seen first.
  Confirm the deploy actually moved rather than assuming.
- **Preview shares the production database.** It is a real environment, not a
  sandbox. Migrations therefore run only on production deploys.
- **Never copy secrets between environments with `vercel env pull`.** It writes
  the literal string `[SENSITIVE]` for protected variables.
- Schema changes need a committed migration, and `npm run changelog` runs
  before shipping because the build container has no git history.
- **Restart the dev server after any schema change**, or it keeps a stale
  generated client and fails with "Unknown field" long after the migration
  succeeded.

## Handing an instance to somebody else

One deployment per person is what makes the isolation real. Two consequences
that are easy to get wrong:

- **Provisioned instances are pinned to a commit and carry no git link**, so a
  push cannot rebuild everybody at once. Updates are pushed deliberately from
  the Instances page.
- **Hosting somebody means you can read their data**, whatever the app does,
  because the database is on your account. The only version of "I cannot see
  your search" that is a fact rather than a promise is them deploying on their
  own accounts.
