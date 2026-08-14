import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { parseDocLines, parseRuns } from "./document-format";

// react-pdf ships without a built-in Arial; Helvetica is metrically compatible
// and is what most PDF viewers substitute for Arial anyway.
//
// These values mirror docx-render.ts deliberately. The two used to drift - the
// docx had navy headings and a rule while the pdf was flat black Helvetica - so
// the same resume looked like two different documents depending on which file a
// recruiter opened. Change one, change the other.
const NAVY = "#1F4E79";
const INK = "#222222";

const styles = StyleSheet.create({
  page: { paddingTop: 32, paddingBottom: 26, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 9.5, color: INK, lineHeight: 1.35 },
  name: { fontFamily: "Helvetica-Bold", fontSize: 17, color: NAVY, textAlign: "center", marginBottom: 7 },
  headerLine: { fontSize: 9, textAlign: "center", marginBottom: 1 },
  heading: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    color: NAVY,
    marginTop: 8,
    marginBottom: 3,
    paddingBottom: 2,
    borderBottomWidth: 0.75,
    borderBottomColor: NAVY,
  },
  headingAts: { fontFamily: "Helvetica-Bold", fontSize: 10, color: NAVY, marginTop: 8, marginBottom: 3 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 6, marginBottom: 1 },
  company: { fontFamily: "Helvetica-Bold", fontSize: 10.5, color: NAVY },
  companyMeta: { fontSize: 9 },
  tenure: { fontFamily: "Helvetica-Bold", fontSize: 9 },
  subrole: { fontFamily: "Helvetica-BoldOblique", fontSize: 9.5 },
  subroleDates: { fontSize: 8.5 },
  scope: { fontSize: 8.5, color: "#5A6472", marginTop: 1, marginBottom: 3 },
  paragraph: { marginBottom: 4 },
  bullet: { marginBottom: 2.5, marginLeft: 12 },
  bulletAts: { marginBottom: 2.5 },
  // Letter
  letterPage: { paddingVertical: 45, paddingHorizontal: 54, fontFamily: "Helvetica", fontSize: 10, color: INK },
  letterName: { fontFamily: "Helvetica-Bold", fontSize: 15, color: NAVY, textAlign: "center", marginBottom: 1 },
  // The rule that closes the letterhead, matching the docx.
  letterContact: { fontSize: 8.5, textAlign: "center", paddingBottom: 3, marginBottom: 6, borderBottomWidth: 0.75, borderBottomColor: NAVY },
  letterDate: { fontSize: 10, marginBottom: 8 },
  letterRecipient: { fontSize: 10, marginBottom: 1 },
  letterRecipientLast: { fontSize: 10, marginBottom: 8 },
  letterBody: { fontSize: 10, marginBottom: 8, lineHeight: 1.32 },
});

/** Renders `**bold**` as bold spans inside a Text, matching the docx. */
function Runs({ text, bold }: { text: string; bold?: boolean }) {
  return (
    <>
      {parseRuns(text).map((r, i) => (
        <Text key={i} style={r.bold || bold ? { fontFamily: "Helvetica-Bold" } : undefined}>
          {r.text}
        </Text>
      ))}
    </>
  );
}

export async function renderPdf(
  content: string,
  isAtsSafe: boolean,
  kind: "resume" | "letter" = "resume"
): Promise<Buffer> {
  const lines = parseDocLines(content);
  let seenName = false;
  let headerLines = 0;
  const salutationAt = lines.findIndex((l) => /^(Dear\b|Re:)/i.test(l.text));

  const body = lines.map((line, i) => {
    if (line.kind === "heading") {
      if (!seenName) {
        seenName = true;
        return (
          <Text key={i} style={kind === "letter" ? styles.letterName : styles.name}>
            {line.text.toUpperCase()}
          </Text>
        );
      }
      return (
        <Text key={i} style={isAtsSafe ? styles.headingAts : styles.heading}>
          {line.text.toUpperCase()}
        </Text>
      );
    }

    if (line.kind === "subheading") {
      const [company, ...rest] = line.text.split(" | ");
      return (
        <View key={i} style={styles.row}>
          <Text>
            <Text style={styles.company}>{company.trim()}</Text>
            {rest.length ? <Text style={styles.companyMeta}>{`   |   ${rest.join(" | ").trim()}`}</Text> : null}
          </Text>
          {line.right ? <Text style={styles.tenure}>{line.right}</Text> : null}
        </View>
      );
    }

    if (line.kind === "scope") {
      return (
        <Text key={i} style={styles.scope}>
          {line.text}
        </Text>
      );
    }

    if (line.kind === "subrole") {
      return (
        <View key={i} style={styles.row}>
          <Text style={styles.subrole}>{line.text}</Text>
          {line.right ? <Text style={styles.subroleDates}>{line.right}</Text> : null}
        </View>
      );
    }

    if (line.kind === "bullet") {
      return (
        <Text key={i} style={isAtsSafe ? styles.bulletAts : styles.bullet}>
          {isAtsSafe ? "- " : "•  "}
          <Runs text={line.text} />
        </Text>
      );
    }

    if (kind === "letter") {
      // Same positional head as the docx: contact line, date, recipient block
      // (tight), then everything from the subject line onward as body copy.
      if (seenName && headerLines === 0) {
        headerLines += 1;
        return (
          <Text key={i} style={styles.letterContact}>
            <Runs text={line.text} />
          </Text>
        );
      }
      if (seenName && headerLines === 1) {
        headerLines += 1;
        return (
          <Text key={i} style={styles.letterDate}>
            <Runs text={line.text} />
          </Text>
        );
      }
      if (salutationAt !== -1 && i < salutationAt) {
        return (
          <Text key={i} style={i === salutationAt - 1 ? styles.letterRecipientLast : styles.letterRecipient}>
            <Runs text={line.text} />
          </Text>
        );
      }
      return (
        <Text key={i} style={styles.letterBody}>
          <Runs text={line.text} />
        </Text>
      );
    }

    const isHeaderLine = seenName && headerLines < 2;
    if (isHeaderLine) headerLines += 1;
    return (
      <Text key={i} style={isHeaderLine ? styles.headerLine : styles.paragraph}>
        <Runs text={line.text} />
      </Text>
    );
  });

  return renderToBuffer(
    <Document>
      <Page size="LETTER" style={kind === "letter" ? styles.letterPage : styles.page}>
        {body}
      </Page>
    </Document>
  );
}
