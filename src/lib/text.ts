/**
 * Cleanup for short single-line fields that came out of a web page: role
 * titles, company names, salary strings.
 *
 * These are written from three places that all touch raw page content - the
 * quick-add and job-search extractions (Claude reading a pasted posting, which
 * echoes whatever markup was in the paste) and the ATS board parsers, which
 * take `title` straight off the provider's JSON. Nothing on those paths
 * stripped tags or decoded entities, so a title could reach the database as
 * `Executive Director, Payments &amp; Onboarding` or with a `<span>` still
 * wrapped round it. React escapes on render, which is exactly right for safety
 * and exactly wrong to look at: the markup shows up as literal text next to
 * the role title on the application page.
 *
 * Only for one-line fields. Job description bodies keep their own converter in
 * job-boards.ts, which preserves paragraph and list breaks.
 */

// Deliberately maps the dash entities to a plain hyphen rather than to the
// characters they name: no em-dashes or en-dashes anywhere is a standing rule
// here, and a title flows straight into generated documents.
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  lsquo: "'",
  rsquo: "'",
  sbquo: "'",
  ldquo: '"',
  rdquo: '"',
  bdquo: '"',
  mdash: "-",
  ndash: "-",
  minus: "-",
  hellip: "...",
  middot: "·",
  bull: "·",
  trade: "",
  reg: "",
  copy: "",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      // Same rule as the named table: the dash code points become a hyphen.
      if (code === 0x2013 || code === 0x2014) return "-";
      return String.fromCodePoint(code);
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * Model output that leaked its own tool-call syntax as text.
 *
 * This has now happened in three different routes: a salary that arrived as
 * "</antml...>", and a drafted email whose subject held the whole body wrapped
 * in `<parameter name="content">`. It survives `strict: true`, because the
 * fragment is inside a perfectly well-formed string value.
 *
 * Returns null when nothing usable is left, so the caller can retry rather than
 * hand a mangled draft to the user.
 */
export function stripToolCallLeak(raw: string): string | null {
  let out = raw;

  // The body is sometimes wrapped in a parameter tag; keep the inside.
  const wrapped = out.match(/<parameter name="[^"]*">([\s\S]*?)(?:<\/parameter>|$)/);
  if (wrapped) out = wrapped[1];

  out = out
    .replace(/<\/?antml[^>]*>/g, "")
    .replace(/<\/?(?:parameter|invoke|function_calls)[^>]*>/g, "")
    .trim();

  // Meta-commentary means the model was talking about the attempt rather than
  // making it. Half a retraction is worse than a clean retry.
  if (/^(?:let me|i made an error|i apologi[sz]e|actually,? let me)\b/i.test(out)) return null;
  return out || null;
}

const TAG = /<[^>]*>/g;

// Takes unknown rather than string on purpose. Most callers are handing it
// something a model just returned, and a field coming back in the wrong shape
// entirely has happened here before; a non-string is nothing to interpolate, so
// it becomes the empty string and the caller's own "is it missing" check fires.
export function cleanInlineText(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";

  // Tags first, then entities, then tags again. The second pass is what
  // catches the common double-encoded case (`&lt;b&gt;Director&lt;/b&gt;`),
  // which a single pass would decode into visible angle brackets rather than
  // removing. A job title never legitimately contains markup, so there is
  // nothing here worth preserving.
  let out = raw.replace(TAG, " ");
  out = decodeEntities(out);
  out = out.replace(TAG, " ");

  return out
    // Non-breaking and zero-width characters survive a paste and are invisible
    // in the input box, so they can only ever be noise here.
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same cleanup, but preserves null for optional columns. */
export function cleanInlineTextOrNull(raw: unknown): string | null {
  return cleanInlineText(raw) || null;
}

/**
 * Removes notes the model wrote to Dan rather than to the recipient.
 *
 * A draft to a CMO ended with "[Dan: add a line here with one
 * specific detail from your conversation, and adjust anything about the Erin
 * introduction you want reflected.]" - sound advice, addressed to the wrong
 * person, sitting inside the email body where it could go out.
 *
 * `general-documents.ts` already refuses bracket placeholders before filing a
 * document. Correspondence never checked, and correspondence is the path that
 * actually reaches a stranger.
 *
 * Only whole lines wrapped in brackets are removed. A bracketed aside inside a
 * sentence is ordinary writing and is left alone; a line that is nothing but a
 * bracket is never something Dan meant to send.
 */
export function stripDraftNotes(text: string): string {
  return text
    .split("\n")
    .filter((line) => !/^\s*[[(]\s*(dan|note|todo|tbd|optional|editor)?\b[\s\S]*[\])]\s*$/i.test(line.trim()) || line.trim().length === 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}
