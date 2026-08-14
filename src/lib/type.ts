/**
 * One answer to "how big is a page title".
 *
 * There were four, across nine pages: 34/52, 34/46, 32/40 and 30/38, with
 * three different ledes underneath them. Nothing was broken and nothing looked
 * obviously wrong on any single page, which is exactly why it survived - the
 * drift is only visible in the transition. Dan found it by toggling Pipeline,
 * Contacts and Companies in sequence and feeling the type change size: 40, then
 * 46, then 40 again.
 *
 * Same shape as `buttonClass`, and for the same reason. The primary button had
 * eleven spellings because nothing answered the question, so every new one was
 * eyeballed against its neighbour. A page heading had four for the same reason.
 *
 * These are class strings rather than components because headings live in
 * server components, client components and inside `<Link>`, and a component
 * would have to be threaded through all three.
 */

/**
 * Every page title except Today.
 *
 * 32/40 because it was already the most common, and because it needs to sit a
 * clear step below the hero rather than compete with it.
 */
export const PAGE_TITLE =
  "text-[32px] font-semibold leading-tight tracking-[-0.02em] text-[var(--tx)] sm:text-[40px]";

/**
 * Today, and only Today.
 *
 * Deliberately larger. The dashboard headline is one statement set large with
 * nothing beside it, which is the whole visual argument of that page: type
 * carries the hierarchy so the chrome can go. It is an exception with a reason,
 * not a fourth size.
 */
export const PAGE_TITLE_HERO =
  "max-w-[18ch] text-[34px] font-semibold leading-[1.08] tracking-[-0.025em] sm:text-[52px]";

/** The sentence under a page title, where there is one. */
export const PAGE_LEDE = "mt-2 text-[15px] leading-relaxed text-[var(--tx-3)]";

/**
 * Transient, narrow pages: `/share`, and anything else you land on mid-task
 * and leave immediately.
 *
 * A third size, and named rather than left to drift. `/share` is a confirmation
 * you see for two seconds after the OS share sheet hands over a link, in a
 * `max-w-xl` column. The full page title there reads as a shout on a page that
 * is barely a page. The test for adding a fourth: it needs a reason that can be
 * written down, like this one, not "it looked better".
 */
export const PAGE_TITLE_COMPACT = "text-[22px] font-semibold tracking-[-0.02em] text-[var(--tx)]";

/**
 * Two page widths, and a rule for choosing.
 *
 * There were four behaviours across ten pages, inside a `<main>` that is
 * already `max-w-[1240px]` with its own padding: full width, 768 centred, 896
 * centred, and 768 **left-aligned** because two pages omitted `mx-auto` and
 * nobody noticed they hugged the edge while their siblings sat in the middle.
 * Companies and Settings then added their own `px`/`py` on top of main's, so
 * they were double-padded.
 *
 * Dan described it as the pipeline being wide, contacts narrow and companies
 * neither, which is exactly right and understates it.
 *
 * The rule: a page whose content is a dense list or table gets the full width,
 * because the columns need it. Everything else gets reading width, because a
 * paragraph or a form at 1240px is unreadable. Nothing sets its own horizontal
 * padding; `<main>` owns that.
 */

/**
 * Dense lists and tables: Today, Pipeline, Inbox, Companies, Contacts.
 *
 * Contacts was reading width at first, on the reasoning that a directory of
 * names is prose-ish. That was wrong in the way that matters: Pipeline,
 * Contacts and Companies sit next to each other in the nav and get toggled
 * between constantly, so the one narrow page among three wide ones reads as
 * the app being inconsistent rather than as a considered choice. Adjacency in
 * the navigation beats the content argument.
 */
export const PAGE_WIDE = "space-y-5";

/** Forms, prose and detail pages. Centred, and never left-aligned by accident. */
export const PAGE_READING = "mx-auto max-w-3xl";

/**
 * The title of a record: a role, a company, a prep document.
 *
 * A fourth size, and it earns the place. Every other title is a page *label* -
 * "Pipeline", "Contacts" - written by us, short, and predictable. A record
 * title is content: "AVP, Marketing Investment Planning, Agency Strategy &
 * Operations" set at 40px wraps to three lines and buries the badges and
 * metadata that sit with it in the header.
 *
 * The test for a fifth remains the same: a reason that can be written down.
 */
export const PAGE_TITLE_RECORD = "text-xl font-semibold tracking-tight text-[var(--tx)] sm:text-2xl";

/**
 * Two ways to say "nothing here", instead of fourteen.
 *
 * A sweep found fourteen distinct stylings across eighteen empty states, in
 * five different text sizes, some centered and some not. An empty state is the
 * first thing a new user sees on most of these pages, so it is a strange place
 * for the interface to look least considered.
 *
 * `EMPTY_INLINE` is a note where a list would have been, inside a section that
 * has its own heading and border. `EMPTY_BLOCK` is for when the whole panel is
 * the empty state and needs to hold the space.
 */
export const EMPTY_INLINE = "text-[13px] leading-relaxed text-[var(--tx-3)]";
export const EMPTY_BLOCK = "px-4 py-8 text-center text-[13px] leading-relaxed text-[var(--tx-3)]";

/**
 * The gap above a major section within a page.
 *
 * There were five (`mt-5`, `mt-6`, `mt-8`, `mt-9`, `mt-12`), which is not a
 * rhythm, it is whatever looked right in each file. Smaller margins inside a
 * component are left alone: those are composition, not page structure.
 */
export const SECTION_GAP = "mt-10";

/**
 * One way to show a failure, instead of thirteen.
 *
 * A sweep found thirteen distinct error stylings across twenty-four places, in
 * three different reds (`red-500`, `red-600`, `red-700`), some as a tinted pill
 * and some as bare text. An error is the worst thing in an interface to be
 * casual about: the user is already stuck, and an unfamiliar-looking message is
 * one more thing to decode.
 *
 * `ERROR_TEXT` sits under the control that failed. `ERROR_BLOCK` is the tinted
 * form for a failure that belongs to a whole panel rather than one field.
 *
 * Both use a real `--danger` token rather than Tailwind's red scale, for the
 * reason the hardcoded greys were removed: a literal cannot follow the theme,
 * and `bg-red-50` under a dark theme is a bright white-pink block.
 *
 * The token had to be created. The palette had `--amber` for 'needs
 * attention' and nothing for 'this failed', so the two were sharing one
 * colour and every error in the app reached past the theme for a literal
 * `red-600`. A warning and a failure are different states.
 */
export const ERROR_TEXT = "mt-1.5 text-xs leading-relaxed text-[var(--danger)]";
export const ERROR_BLOCK =
  "mt-2 rounded-lg border border-[var(--danger-line)] bg-[var(--danger-dim)] px-2.5 py-1.5 text-xs leading-relaxed text-[var(--danger)]";

/**
 * The block holding a page title and its lede.
 *
 * The fourth axis of the same drift, and the one Dan felt last: the heading
 * itself was already identical everywhere, but the space above it was not.
 * Companies had none, Pipeline 12px, Contacts and Follow-ups 48px, so the title
 * physically sat lower on some pages than others and toggling between them read
 * as the page jumping.
 *
 * `<main>` already supplies 20px above this, so the values here are the gap on
 * top of that.
 */
export const PAGE_HEADER = "pb-7 pt-2 sm:pb-8 sm:pt-3";

/**
 * Today's header block. Deliberately roomier, for the same reason its title is
 * larger: the dashboard headline is one statement with nothing beside it.
 */
export const PAGE_HEADER_HERO = "pb-10 pt-8 sm:pb-14 sm:pt-12";
