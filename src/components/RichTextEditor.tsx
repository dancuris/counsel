"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/lib/button";

/**
 * A formatting surface for messages that go to real people.
 *
 * This is a `contenteditable` driven by `execCommand`, which is deprecated and
 * chosen anyway: it is the only formatting API every browser still implements
 * identically, and the alternative is a several-hundred-kilobyte editor
 * framework for bold, italic and bullets. If the needs grow past a list and a
 * link, that trade flips.
 *
 * The parent owns the value as HTML. The plain-text version is derived at save
 * time rather than stored twice, because `content` remains the record and two
 * copies of the same message drift.
 */
const BUTTONS: { cmd: string; label: string; title: string }[] = [
  { cmd: "bold", label: "B", title: "Bold" },
  { cmd: "italic", label: "I", title: "Italic" },
  { cmd: "insertUnorderedList", label: "•", title: "Bulleted list" },
  { cmd: "insertOrderedList", label: "1.", title: "Numbered list" },
];

export function RichTextEditor({
  html,
  onChange,
  placeholder,
}: {
  html: string;
  onChange: (html: string) => void;
  placeholder?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // window.prompt cannot be styled, cannot be themed, and drops the selection
  // on some browsers by the time it returns. The range is captured before the
  // field opens so the link still lands on the text that was highlighted.
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState("");
  const savedRange = useRef<Range | null>(null);

  // Only write into the node when the value genuinely differs, or every
  // keystroke would re-render the element and throw the caret to the start.
  useEffect(() => {
    const el = ref.current;
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }, [html]);

  function applyLink() {
    const href = url.trim();
    if (!href) return;
    ref.current?.focus();
    // Restore what was highlighted before the field took focus, or
    // createLink has nothing to wrap.
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    document.execCommand("createLink", false, href);
    onChange(ref.current?.innerHTML ?? "");
    setUrl("");
    setLinking(false);
  }

  function exec(cmd: string) {
    ref.current?.focus();
    document.execCommand(cmd, false);
    onChange(ref.current?.innerHTML ?? "");
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-line bg-[var(--surface-2)]">
      <div className="flex flex-wrap items-center gap-0.5 border-b border-line px-1.5 py-1">
        {BUTTONS.map((b) => (
          <button
            key={b.cmd}
            type="button"
            title={b.title}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(b.cmd)}
            className="min-w-7 rounded px-1.5 py-1 text-[12px] text-[var(--tx-2)] transition hover:bg-[var(--bg)] hover:text-[var(--tx)]"
          >
            {b.cmd === "bold" ? <b>{b.label}</b> : b.cmd === "italic" ? <i>{b.label}</i> : b.label}
          </button>
        ))}
        <button
          type="button"
          title="Link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const sel = window.getSelection();
            savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
            setLinking((open) => !open);
          }}
          className={`rounded px-1.5 py-1 text-[12px] transition hover:bg-[var(--bg)] hover:text-[var(--tx)] ${
            linking ? "bg-[var(--bg)] text-[var(--tx)]" : "text-[var(--tx-2)]"
          }`}
        >
          Link
        </button>
        <button
          type="button"
          title="Remove formatting"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => exec("removeFormat")}
          className="ml-auto rounded px-1.5 py-1 text-[11px] text-[var(--tx-3)] transition hover:text-[var(--tx)]"
        >
          Clear
        </button>
      </div>

      {linking && (
        <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") return void setLinking(false);
              if (e.key !== "Enter") return;
              e.preventDefault();
              applyLink();
            }}
            placeholder="https://"
            className="min-w-0 flex-1 rounded-md border border-line bg-[var(--bg)] px-2 py-1 text-[12px] text-[var(--tx)]"
          />
          <button
            type="button"
            onClick={applyLink}
            className={buttonClass("primary", "sm")}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setLinking(false)}
            className="text-[11.5px] text-[var(--tx-3)] transition hover:text-[var(--tx)]"
          >
            Cancel
          </button>
        </div>
      )}

      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        // Pasting from a job posting or another mail client drags a stylesheet
        // in with it. Only the text survives.
        onPaste={(e) => {
          e.preventDefault();
          const text = e.clipboardData.getData("text/plain");
          document.execCommand("insertText", false, text);
          onChange(ref.current?.innerHTML ?? "");
        }}
        className="min-h-56 max-h-[32rem] overflow-y-auto px-3 py-2.5 text-[13.5px] leading-relaxed text-[var(--tx)] outline-none [&_a]:underline [&_li]:ml-4 [&_ol]:list-decimal [&_ul]:list-disc empty:before:text-[var(--tx-3)] empty:before:content-[attr(data-placeholder)]"
      />
    </div>
  );
}

/**
 * Mail bodies and Claude context both want text, so HTML collapses back down.
 *
 * Guarded because this is called during render, and a client component still
 * renders once on the server where there is no `document`. Today the composer
 * returns early while collapsed so it never gets here, which is exactly the
 * kind of accident that stops being true after one refactor.
 */
export function htmlToPlainText(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const el = document.createElement("div");
  el.innerHTML = html;
  el.querySelectorAll("li").forEach((li) => li.replaceWith(`- ${li.textContent ?? ""}\n`));
  el.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  el.querySelectorAll("div, p").forEach((b) => b.append("\n"));
  return (el.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** The reverse, for text that has never been through the editor. */
export function plainTextToHtml(text: string): string {
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return escaped
    .split(/\n{2,}/)
    .map((p) => `<div>${p.replace(/\n/g, "<br>")}</div>`)
    .join("<div><br></div>");
}
