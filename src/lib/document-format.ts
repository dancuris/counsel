// Shared "markdown-lite" contract used for AI-drafted resume/cover-letter content,
// and rendered into both docx and pdf from the same parsed representation.
//
//   ## SECTION                            section heading, navy, rule beneath
//   ### Company | descriptor :: dates     company block, tenure right-aligned
//   #### Title :: dates                   nested sub-role, bold italic
//   > Domain · Domain · Domain            the remit held under that title
//   - **Lead phrase**, rest of bullet     bullet with a bolded lead phrase
//   anything else                         paragraph
//
// Two of these exist because Dan's own strongest resumes do things the old
// format could not express, and the app was quietly producing a flatter
// document than the one he was hand-making elsewhere:
//
//   - ` :: ` splits a line into left text and a RIGHT-ALIGNED tail. That is how
//     a tenure sits on the same line as the company rather than under it.
//   - `#### ` is a sub-role inside a company block. Where Dan held two titles at
//     one employer, they render as one company runway with nested titles, which
//     shows a promotion instead of stranding a short recent title on a thin base.
//
// `**bold**` is parsed inline rather than shown literally, because the house
// style bolds the lead phrase of every bullet (the Google X-Y-Z formula).

export type DocLine =
  | { kind: "heading"; text: string }
  | { kind: "subheading"; text: string; right?: string }
  | { kind: "subrole"; text: string; right?: string }
  | { kind: "scope"; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string };

/** A run of text, bold or not. `**` pairs become bold runs. */
export type DocRun = { text: string; bold: boolean };

/**
 * Splits `a **b** c` into runs. Unmatched `**` is left as literal text rather
 * than swallowing the rest of the line, since a stray asterisk in a draft
 * should not silently bold everything after it.
 */
export function parseRuns(text: string): DocRun[] {
  const runs: DocRun[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index), bold: false });
    runs.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), bold: false });
  return runs.length ? runs : [{ text, bold: false }];
}

/** Pulls a right-aligned tail off a line: "Company | place :: Aug 2022 to Jun 2026". */
function splitRight(text: string): { text: string; right?: string } {
  const i = text.indexOf(" :: ");
  if (i === -1) return { text };
  return { text: text.slice(0, i).trim(), right: text.slice(i + 4).trim() };
}

export function parseDocLines(content: string): DocLine[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // A markdown horizontal rule is not part of this format, and a model
    // writing free-form prose emits them between sections out of habit. With
    // no case for them they fell through to "paragraph" and rendered as a
    // literal "---" plus its paragraph spacing: five of them on the master
    // resume, which is a visible line of junk and a chunk of a page. Dropped
    // here rather than at one call site, so an imported or adopted document
    // gets the same treatment.
    .filter((line) => !/^([-*_]\s*){3,}$/.test(line))
    .map((line) => {
      // Longest prefix first: "#### " would otherwise be read as "### " plus a
      // stray hash, which is how an unsupported level used to leak into the page.
      if (line.startsWith("#### ")) return { kind: "subrole" as const, ...splitRight(line.slice(5).trim()) };
      if (line.startsWith("### ")) return { kind: "subheading" as const, ...splitRight(line.slice(4).trim()) };
      if (line.startsWith("## ")) return { kind: "heading" as const, text: line.slice(3).trim() };
      if (line.startsWith("- ")) return { kind: "bullet" as const, text: line.slice(2).trim() };
      // The remit held under a title, as a "·"-separated line.
      //
      // A promotion is easiest to read as a diff: Strategy and Budget appear on
      // the upper line and nowhere below it, so the reader sees what was gained
      // without a sentence explaining it - and at Delta, what was let go too.
      // A paragraph would have rendered at body weight and read as prose; this
      // is deliberately lighter, so it labels the role rather than competing
      // with the bullets under it.
      if (line.startsWith("> ")) return { kind: "scope" as const, text: line.slice(2).trim() };
      return { kind: "paragraph" as const, text: line };
    });
}
