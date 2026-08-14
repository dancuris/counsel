"use client";

import { useEffect, useRef, useState } from "react";
import { buttonClass } from "@/lib/button";
import { ERROR_BLOCK } from "@/lib/type";

/**
 * Ask anything about the search, from anywhere.
 *
 * It sits in the header rather than on a page because the questions are not
 * about the page you happen to be on: "should I chase the recruiter about the airline role"
 * can occur to you while reading the Inbox.
 *
 * Deliberately not a chat. There is no history and no follow-up turn, because
 * the questions are one-shot judgement calls and a transcript would turn a
 * quick check into a session. The answer appears under the box and goes away
 * when you dismiss it.
 */
const EXAMPLES = [
  "Should I chase the recruiter about that role?",
  "Which role has gone quiet longest?",
  "Who am I overdue with?",
];

export function AskBox() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  type Link = { label: string; href: string; primary?: boolean };
  type FollowUp = { applicationId: string; company: string; inDays: number; dueDate: string; note: string };
  type Turn = { question: string; answer: string; links: Link[]; followUp?: FollowUp | null };
  // A conversation, not a single answer. "Draft that for Friday instead" needs
  // to know what "that" was, and the thread is how Dan returns to a decision
  // rather than re-asking it.
  const [turns, setTurns] = useState<Turn[]>([]);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [recent, setRecent] = useState<{ threadId: string; opening: string; turns: number }[]>([]);
  // Which reminders have been set in this panel, so the button can confirm
  // rather than silently doing nothing the second time.
  const [reminded, setReminded] = useState<Record<string, boolean>>({});
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      // Once there is an answer on screen, only Escape or an explicit close
      // dismisses it. Clicking away used to bin a recommendation mid-read -
      // and worse, clicking the very role it told you to open was what closed
      // it, so the panel fought the action it had just advised.
      if (turns.length) return;
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, turns.length]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || asking) return;
    setAsking(true);
    setError(null);
    setQuestion("");
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, threadId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `Ask failed with ${res.status}.`);
      setThreadId(data.threadId ?? null);
      setTurns((t) => [...t, { question: text, answer: data.answer, links: data.links ?? [], followUp: data.followUp ?? null }]);
    } catch (e) {
      setError((e as Error).message);
      setQuestion(text);
    } finally {
      setAsking(false);
    }
  }

  async function loadRecent() {
    try {
      const res = await fetch("/api/ask");
      const data = await res.json().catch(() => null);
      if (res.ok) setRecent(data.threads ?? []);
    } catch {
      /* the list is a convenience; failing to load it must not break asking */
    }
  }

  async function resume(id: string) {
    setAsking(true);
    setError(null);
    try {
      const res = await fetch(`/api/ask?threadId=${encodeURIComponent(id)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not load that conversation.");
      setTurns(data.turns ?? []);
      setThreadId(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAsking(false);
    }
  }

  async function remind(f: FollowUp) {
    if (reminded[f.dueDate + f.applicationId]) return;
    try {
      const res = await fetch("/api/follow-ups/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: f.applicationId, note: f.note, dueDate: f.dueDate }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d?.error ?? `Could not set that reminder (${res.status}).`);
      }
      setReminded((r) => ({ ...r, [f.dueDate + f.applicationId]: true }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function startNew() {
    setTurns([]);
    setThreadId(null);
    setQuestion("");
    setError(null);
    void loadRecent();
  }

  return (
    <div ref={box} className="relative">
      {/*
        A visible field, not a button that hides one. It was an "Ask" button
        between the nav and the avatar, which Dan could not find - and he is the
        only user, so if he cannot see it, it does not exist. A search box reads
        as a place to type without needing a label to explain itself.

        The narrow layout keeps the button, because a full field beside four nav
        links does not fit on a phone.
      */}
      <button
        type="button"
        onClick={() => { setOpen(true); void loadRecent(); }}
        className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-[var(--tx-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--tx)] sm:hidden"
      >
        Ask
      </button>

      <button
        type="button"
        onClick={() => { setOpen(true); void loadRecent(); }}
        className="hidden w-56 items-center gap-2 rounded-lg border border-line bg-[var(--surface-2)] px-3 py-1.5 text-left text-[12.5px] text-[var(--tx-3)] transition-colors hover:border-line-2 hover:text-[var(--tx-2)] sm:flex lg:w-72"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 flex-none" fill="none" stroke="currentColor" strokeWidth="1.6">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M10.5 10.5 14 14" strokeLinecap="round" />
        </svg>
        <span className="truncate">Ask about your search...</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 flex max-h-[min(80vh,42rem)] w-[min(94vw,34rem)] flex-col panel p-3 shadow-2xl">
          {/* Always present. The Close control used to appear only once there
              was an answer, so opening the panel showed no way out - and with a
              conversation on screen click-outside is deliberately disabled, so
              the only exit was a keyboard shortcut nobody was told about. The
              rule already written for ApplicationPicker applies here: anything
              that opens needs a visible close, not just Escape. */}
          <div className="mb-2 flex flex-none items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.06em] text-[var(--tx-3)]">
              {turns.length ? "Conversation" : "Ask"}
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              title="Close (Esc)"
              className="grid h-6 w-6 place-items-center rounded-md text-[var(--tx-3)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--tx)]"
            >
              <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          {/* The conversation so far, oldest at the top, so a follow-up reads
              as a reply rather than a new question. */}
          {turns.length > 0 && (
            <div className="mb-2.5 min-h-0 flex-1 space-y-4 overflow-y-auto">
              {turns.map((t, i) => (
                <div key={i}>
                  <p className="text-[12px] font-medium text-[var(--tx-3)]">{t.question}</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--tx)]">
                    {t.answer}
                  </p>
                  {(t.links.length > 0 || t.followUp) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {t.links
                        .slice()
                        .sort((x, y) => Number(Boolean(y.primary)) - Number(Boolean(x.primary)))
                        .map((l) =>
                          l.primary ? (
                            <a
                              key={l.href}
                              href={l.href}
                              className={buttonClass("primary", "sm")}
                            >
                              {l.label}
                            </a>
                          ) : (
                            <a
                              key={l.href}
                              href={l.href}
                              className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-[var(--tx-2)] transition-colors hover:border-line-2 hover:text-[var(--tx)]"
                            >
                              {l.label}
                            </a>
                          )
                        )}
                      {/* Advice that says wait needs an action too, or following
                          it depends on remembering. */}
                      {t.followUp && (
                        <button
                          type="button"
                          onClick={() => void remind(t.followUp!)}
                          disabled={Boolean(reminded[t.followUp.dueDate + t.followUp.applicationId])}
                          className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-[var(--tx-2)] transition-colors hover:border-line-2 hover:text-[var(--tx)] disabled:opacity-60"
                        >
                          {reminded[t.followUp.dueDate + t.followUp.applicationId]
                            ? `Reminder set for ${new Date(t.followUp.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                            : `Remind me in ${t.followUp.inDays} days`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <input
            autoFocus
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void ask(question);
              }
            }}
            placeholder={turns.length ? "Follow up..." : "Should I chase the recruiter about that role?"}
            className="w-full flex-none rounded-lg border border-line bg-[var(--surface-2)] px-3 py-2 text-[13px] text-[var(--tx)]"
          />

          {asking && (
            <p className="mt-2.5 flex flex-none items-center gap-2 text-[12.5px] text-[var(--tx-3)]">
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-line border-t-[var(--tx-3)]" />
              {turns.length ? "Thinking..." : "Reading the whole search..."}
            </p>
          )}

          {error && <p className={ERROR_BLOCK}>{error}</p>}

          {turns.length === 0 && !asking && (
            <>
              <div className="mt-2 flex flex-none flex-wrap gap-1.5">
                {EXAMPLES.map((e) => (
                  <button
                    key={e}
                    type="button"
                    onClick={() => void ask(e)}
                    className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
                  >
                    {e}
                  </button>
                ))}
              </div>

              {/* Going back to a conversation rather than starting one. Named by
                  how it opened, which is what you remember it by. */}
              {recent.length > 0 && (
                <div className="mt-3 flex-none border-t border-line pt-2.5">
                  <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--tx-3)]">Earlier</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {recent.map((r) => (
                      <li key={r.threadId}>
                        <button
                          type="button"
                          onClick={() => void resume(r.threadId)}
                          className="flex w-full items-baseline gap-2 rounded-md px-1 py-1 text-left text-[12px] text-[var(--tx-2)] transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--tx)]"
                        >
                          <span className="min-w-0 flex-1 truncate">{r.opening}</span>
                          {r.turns > 1 && <span className="flex-none text-[10.5px] text-[var(--tx-3)]">{r.turns}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {turns.length > 0 && (
            <div className="mt-2.5 flex flex-none items-center gap-3">
              <button
                type="button"
                onClick={startNew}
                className="text-[11.5px] text-[var(--tx-3)] transition-colors hover:text-[var(--tx)]"
              >
                New question
              </button>
              <span className="text-[11px] text-[var(--tx-3)]">Reads your search. Changes nothing.</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
