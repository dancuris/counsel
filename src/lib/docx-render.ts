import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  BorderStyle,
  AlignmentType,
  TabStopType,
} from "docx";
import { parseDocLines, parseRuns, type DocRun } from "./document-format";

// Values lifted verbatim from the resumes Dan hand-builds outside the app,
// by unzipping the docx and reading the OOXML rather than eyeballing a PDF.
// docx sizes are half-points, so 34 is 17pt.
const NAVY = "1F4E79";
const INK = "222222";

const NAME_SIZE = 34; // 17pt, centred navy
const HEAD_SIZE = 20; // 10pt, section header
const COMPANY_SIZE = 21; // 10.5pt, company name
const BODY_SIZE = 19; // 9.5pt, bullets and prose
const META_SIZE = 18; // 9pt, tagline, contact line, employer tenure
const SUBROLE_DATE_SIZE = 17; // 8.5pt, dates beside a nested title

// Right-aligned tenures hang off a single tab stop at the text-width edge.
const RIGHT_TAB = 9026;

function runs(text: string, opts: { size: number; color?: string; bold?: boolean; italics?: boolean }): TextRun[] {
  return parseRuns(text).map(
    (r: DocRun) =>
      new TextRun({
        text: r.text,
        bold: opts.bold || r.bold,
        italics: opts.italics,
        font: "Arial",
        size: opts.size,
        color: opts.color ?? INK,
      })
  );
}

/**
 * A letter is not a resume, so the two layouts are separate functions. Rendering
 * a letter with the resume layout is what once produced a cover letter with no
 * header and a centred name.
 */
export async function renderDocx(
  content: string,
  isAtsSafe: boolean,
  kind: "resume" | "letter" = "resume"
): Promise<Buffer> {
  if (kind === "letter") return renderLetter(content);
  const lines = parseDocLines(content);

  // The first heading is the name; every later one is a section title, and the
  // two are styled very differently, so the distinction has to be tracked.
  let seenName = false;
  let headerLines = 0;

  const paragraphs = lines.map((line) => {
    if (line.kind === "heading") {
      if (!seenName) {
        seenName = true;
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          // 2pt under a 17pt name read as no gap at all. The name is the first
          // thing on the page and it was touching the line beneath it.
          spacing: { after: 140 },
          children: [
            new TextRun({ text: line.text.toUpperCase(), bold: true, font: "Arial", size: NAME_SIZE, color: NAVY }),
          ],
        });
      }
      return new Paragraph({
        spacing: { before: 150, after: 40 },
        // ATS parsers can trip over paragraph borders, so the rule is dropped in
        // ATS-safe mode while the hierarchy survives through weight and colour.
        border: isAtsSafe ? undefined : { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 1 } },
        children: [new TextRun({ text: line.text.toUpperCase(), bold: true, font: "Arial", size: HEAD_SIZE, color: NAVY })],
      });
    }

    // "Company | descriptor, location" with the tenure pushed to the right
    // margin. The company itself is navy and a size up; the descriptor stays
    // small and grey so the eye lands on the employer.
    if (line.kind === "subheading") {
      const [company, ...rest] = line.text.split(" | ");
      const children: TextRun[] = [
        new TextRun({ text: company.trim(), bold: true, font: "Arial", size: COMPANY_SIZE, color: NAVY }),
      ];
      if (rest.length) {
        children.push(
          new TextRun({ text: `   |   ${rest.join(" | ").trim()}`, font: "Arial", size: META_SIZE, color: INK })
        );
      }
      if (line.right) {
        children.push(new TextRun({ text: `\t${line.right}`, bold: true, font: "Arial", size: META_SIZE, color: INK }));
      }
      return new Paragraph({
        spacing: { before: 120, after: 20 },
        tabStops: line.right ? [{ type: TabStopType.RIGHT, position: RIGHT_TAB }] : undefined,
        children,
      });
    }

    // A title held inside a company block: bold italic, dates to the right.
    if (line.kind === "subrole") {
      const children: TextRun[] = [
        new TextRun({ text: line.text, bold: true, italics: true, font: "Arial", size: BODY_SIZE, color: INK }),
      ];
      if (line.right) {
        children.push(new TextRun({ text: `\t${line.right}`, font: "Arial", size: SUBROLE_DATE_SIZE, color: INK }));
      }
      return new Paragraph({
        spacing: { before: 60, after: 20 },
        tabStops: line.right ? [{ type: TabStopType.RIGHT, position: RIGHT_TAB }] : undefined,
        children,
      });
    }

    // The remit under a title. Smaller and grey so it labels the role rather
    // than competing with the bullets beneath it.
    if (line.kind === "scope") {
      return new Paragraph({
        spacing: { before: 10, after: 50 },
        children: [new TextRun({ text: line.text, font: "Arial", size: SUBROLE_DATE_SIZE, color: "5A6472" })],
      });
    }

    if (line.kind === "bullet") {
      return new Paragraph({
        spacing: { after: 40 },
        indent: isAtsSafe ? undefined : { left: 240, hanging: 140 },
        // The lead phrase arrives bolded from parseRuns; the bullet glyph must
        // not be, or the whole line reads as a heading.
        children: [
          new TextRun({ text: isAtsSafe ? "- " : "•  ", font: "Arial", size: BODY_SIZE, color: INK }),
          ...runs(line.text, { size: BODY_SIZE }),
        ],
      });
    }

    // The two lines under the name are the positioning line and the contact
    // details: centred and smaller, which is how an executive resume opens.
    const isHeaderLine = seenName && headerLines < 2;
    if (isHeaderLine) headerLines += 1;
    return new Paragraph({
      alignment: isHeaderLine ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { after: isHeaderLine ? 20 : 60 },
      children: runs(line.text, { size: isHeaderLine ? META_SIZE : BODY_SIZE }),
    });
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: BODY_SIZE, color: INK } } } },
    sections: [
      {
        // Tight margins, because the resume is a strict single page.
        properties: { page: { margin: { top: 620, bottom: 500, left: 720, right: 720 } } },
        children: paragraphs,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// Measured off Dan's own cover letter, which is set a little smaller and
// tighter than the resume: 15pt name, 8.5pt contact line, 10pt body.
const LETTER_NAME_SIZE = 30; // 15pt
const LETTER_META_SIZE = 17; // 8.5pt
const LETTER_BODY_SIZE = 20; // 10pt
const LETTER_LINE = 264; // ~1.1 line spacing through the body

/**
 * The letterhead is centred and navy so a resume and its cover letter look like
 * one set when they land together in an inbox. Body copy stays unbolded prose:
 * a cover letter with bolded lead phrases reads like a resume in sentences.
 */
async function renderLetter(content: string): Promise<Buffer> {
  const lines = parseDocLines(content);

  // The head is positional, because the app assembles it: name, contact line,
  // date, then the recipient block, then a "Re:" line and the salutation. The
  // recipient lines are set tight against each other and everything after them
  // breathes, which is what makes it read as a letter rather than a list.
  let seenName = false;
  let seenContact = false;
  let seenDate = false;
  const salutationAt = lines.findIndex((l) => /^(Dear\b|Re:)/i.test(l.text));

  const paragraphs = lines.map((line, i) => {
    if (line.kind === "heading" && !seenName) {
      seenName = true;
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 4 },
        children: [
          new TextRun({ text: line.text.toUpperCase(), bold: true, font: "Arial", size: LETTER_NAME_SIZE, color: NAVY }),
        ],
      });
    }

    // The contact line carries the navy rule that closes the letterhead. It was
    // simply missing before, so the letter opened with a floating name and no
    // visual break before the date.
    if (seenName && !seenContact) {
      seenContact = true;
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: NAVY, space: 6 } },
        children: runs(line.text, { size: LETTER_META_SIZE }),
      });
    }

    if (seenContact && !seenDate) {
      seenDate = true;
      return new Paragraph({
        spacing: { after: 160 },
        children: runs(line.text, { size: LETTER_BODY_SIZE }),
      });
    }

    // Recipient block: tight between its own lines, then a full gap before the
    // subject line. `salutationAt` bounds it, so a letter with no recipient
    // details at all still spaces correctly.
    const inRecipient = salutationAt !== -1 && i < salutationAt;
    if (inRecipient) {
      const isLast = i === salutationAt - 1;
      return new Paragraph({
        spacing: { after: isLast ? 160 : 20 },
        children: runs(line.text, { size: LETTER_BODY_SIZE }),
      });
    }

    return new Paragraph({
      spacing: { after: 160, line: LETTER_LINE },
      children: runs(line.text, { size: LETTER_BODY_SIZE }),
    });
  });

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: LETTER_BODY_SIZE, color: INK } } } },
    sections: [
      { properties: { page: { margin: { top: 900, bottom: 900, left: 1080, right: 1080 } } }, children: paragraphs },
    ],
  });
  return Packer.toBuffer(doc);
}
