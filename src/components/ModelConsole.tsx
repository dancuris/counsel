"use client";

import { useEffect, useState, useTransition } from "react";
import { AVAILABLE_MODELS } from "@/lib/models";
import { buttonClass } from "@/lib/button";
import { ERROR_BLOCK } from "@/lib/type";

type Run = {
  id: string;
  prompt: string;
  response: string;
  model: string;
  contextPath: string | null;
  createdAt: string;
};

/**
 * A prompt box wired to any model, for asking about the app itself.
 *
 * Every other model surface here is grounded and narrow on purpose. This one
 * is open, because the questions it exists for are the ones nothing else can
 * answer: whether a panel is usable, whether a page is doing too much, whether
 * a decision was right. It can attach a real page from the app so the answer
 * is about what is actually on screen rather than about UI in the abstract.
 */
export function ModelConsole({ pagePaths, defaultModel }: { pagePaths: string[]; defaultModel: string }) {
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [contextPath, setContextPath] = useState("");
  // Crawling is the difference between "is this panel confusing" and "is this
  // app coherent". The second needs to see several pages at once.
  const [crawl, setCrawl] = useState(false);
  const [maxPages, setMaxPages] = useState(6);
  const [pages, setPages] = useState<string[]>([]);
  const [answer, setAnswer] = useState<{ text: string; model: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Run[]>([]);
  const [openRun, setOpenRun] = useState<string | null>(null);
  const [running, startRun] = useTransition();

  useEffect(() => {
    void fetch("/api/console")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHistory(d.runs ?? []))
      .catch(() => null);
  }, []);

  function run() {
    if (!prompt.trim() || running) return;
    setError(null);
    setAnswer(null);
    setPages([]);
    startRun(async () => {
      // A comma or newline separated list is several pages; with Crawl on, the
      // first one is a starting point and the app's own links do the rest.
      const paths = contextPath
        .split(/[\n,]+/)
        .map((p) => p.trim())
        .filter(Boolean);
      const res = await fetch("/api/console", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          model: model || undefined,
          ...(crawl && paths[0]
            ? { crawlFrom: paths[0], maxPages }
            : paths.length
              ? { contextPaths: paths }
              : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `The console returned ${res.status}.`);
        return;
      }
      setAnswer({ text: data.answer, model: data.model });
      setPages(data.pages ?? []);
      const list = await fetch("/api/console").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (list) setHistory(list.runs ?? []);
    });
  }

  return (
    <div>
      <textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={5}
        placeholder="Look at the documents panel and tell me whether it is doing too much. Be specific about what you would cut."
        className="w-full resize-y rounded-lg border border-line bg-[var(--surface-2)] px-3 py-2.5 text-[13px] leading-relaxed text-[var(--tx)]"
      />

      <div className="mt-2.5 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
          Model
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded-md border border-line bg-[var(--surface-2)] px-2 py-1.5 text-[12.5px] text-[var(--tx-2)]"
          >
            <option value="">Default ({defaultModel})</option>
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        {/* The part that makes UI questions answerable. Without a page attached
            the model is guessing about an interface it has never seen. */}
        <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
          {crawl ? "Start crawling from" : "Show it pages (comma separated)"}
          <input
            list="console-pages"
            value={contextPath}
            onChange={(e) => setContextPath(e.target.value)}
            placeholder={crawl ? "/" : "/pipeline, /inbox"}
            className="w-72 rounded-md border border-line bg-[var(--surface-2)] px-2 py-1.5 text-[12.5px] text-[var(--tx-2)]"
          />
          <datalist id="console-pages">
            {pagePaths.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>

        <label className="flex items-center gap-1.5 pb-2 text-[11.5px] text-[var(--tx-2)]">
          <input type="checkbox" checked={crawl} onChange={(e) => setCrawl(e.target.checked)} />
          Crawl
        </label>

        {crawl && (
          <label className="flex flex-col gap-1 text-[11px] text-[var(--tx-3)]">
            Max pages
            <select
              value={maxPages}
              onChange={(e) => setMaxPages(Number(e.target.value))}
              className="rounded-md border border-line bg-[var(--surface-2)] px-2 py-1.5 text-[12.5px] text-[var(--tx-2)]"
            >
              {[3, 6, 9, 12].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          onClick={run}
          disabled={!prompt.trim() || running}
          className={buttonClass("primary", "md")}
        >
          {running ? "Thinking..." : "Run"}
        </button>
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--tx-3)]">
        Read only: it has no tools and cannot change anything. Each page sends its rendered text and a list of its
        controls, so it can count and quote them, but it cannot see layout, spacing or colour. Crawl follows the links
        the app itself renders, staying inside the app and never touching an endpoint or the sign-out link.
      </p>

      {error && <p className={ERROR_BLOCK}>{error}</p>}

      {answer && (
        <div className="mt-4 rounded-lg border border-line bg-[var(--surface)] p-3.5">
          <p className="text-[11px] uppercase tracking-wide text-[var(--tx-3)]">
            {answer.model}
            {pages.length > 0 && ` · read ${pages.length} ${pages.length === 1 ? "page" : "pages"}`}
          </p>
          {pages.length > 1 && (
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-[var(--tx-3)]">{pages.join("  ·  ")}</p>
          )}
          <div className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--tx-2)]">
            {answer.text}
          </div>
        </div>
      )}

      {history.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--tx-3)]">Earlier</p>
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {history.map((r) => (
              <li key={r.id} className="py-2.5">
                <button
                  type="button"
                  onClick={() => setOpenRun(openRun === r.id ? null : r.id)}
                  className="w-full text-left"
                >
                  <span className="block text-[12.5px] text-[var(--tx-2)]">{r.prompt.slice(0, 130)}</span>
                  <span className="mt-0.5 block text-[11px] text-[var(--tx-3)]">
                    {r.model}
                    {r.contextPath ? ` · ${r.contextPath}` : ""} · {new Date(r.createdAt).toLocaleString()}
                  </span>
                </button>
                {openRun === r.id && (
                  <div className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--surface-2)] p-3 text-[12.5px] leading-relaxed text-[var(--tx-2)]">
                    {r.response}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
