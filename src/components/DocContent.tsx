import { parseDocLines } from "@/lib/document-format";

// Renders the shared markdown-lite document contract inline in the app, so a
// generated document is readable without downloading the docx/pdf.
export function DocContent({ content }: { content: string }) {
  const lines = parseDocLines(content);
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        if (line.kind === "heading") {
          return (
            <h3 key={i} className="pt-3 text-sm font-semibold tracking-tight text-[var(--tx)] first:pt-0">
              {line.text}
            </h3>
          );
        }
        if (line.kind === "bullet") {
          return (
            <p key={i} className="flex gap-2 pl-1 text-sm leading-relaxed text-[var(--tx-2)]">
              <span aria-hidden className="text-[var(--tx-3)]">
                •
              </span>
              <span>{line.text}</span>
            </p>
          );
        }
        return (
          <p key={i} className="text-sm leading-relaxed text-[var(--tx-2)]">
            {line.text}
          </p>
        );
      })}
    </div>
  );
}
