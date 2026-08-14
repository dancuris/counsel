"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ModelSelect } from "@/components/ModelSelect";
import { buttonClass } from "@/lib/button";
import { ERROR_TEXT } from "@/lib/type";

type StagedAction = {
  kind: string;
  summary: string;
  subject: string;
  body: string;
  personName: string;
  personRole: string;
  personEmail: string;
  attachDocumentIds: string[];
  date: string;
  status: string;
  correspondenceType: string;
};

type Turn = { role: "user" | "assistant"; content: string };

export function QuickActionBox({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [model, setModel] = useState("");
  const [plan, setPlan] = useState<StagedAction[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string[] | null>(null);
  const [isThinking, startThinking] = useTransition();
  const [isApplying, startApply] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (turns.length > 0) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns, plan]);

  function send() {
    const said = text.trim();
    if (!said) return;
    const next: Turn[] = [...turns, { role: "user", content: said }];
    setTurns(next);
    setText("");
    setError(null);
    setDone(null);
    startThinking(async () => {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, messages: next, model: model || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      if (data.reply) setTurns((prev) => [...prev, { role: "assistant", content: data.reply }]);
      // Staged actions accumulate across the conversation until applied.
      if (Array.isArray(data.actions) && data.actions.length > 0) {
        setPlan((prev) => [...prev, ...data.actions]);
      }
    });
  }

  function apply() {
    const chosen = plan.filter((_, i) => !skipped.has(i));
    if (chosen.length === 0) return;
    setError(null);
    startApply(async () => {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, apply: true, actions: chosen }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't apply that.");
        return;
      }
      setDone(data.applied ?? []);
      setPlan([]);
      setSkipped(new Set());
      setExpanded(new Set());
      router.refresh();
    });
  }

  function reset() {
    setTurns([]);
    setPlan([]);
    setSkipped(new Set());
    setExpanded(new Set());
    setDone(null);
    setError(null);
  }

  const toggle = (set: Set<number>, i: number) => {
    const next = new Set(set);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  };

  return (
    <div className="rounded-xl border border-accent/25 bg-accent-light/40 p-3">
      <div className="flex items-baseline justify-between">
        <label className="text-xs font-semibold uppercase tracking-wide text-accent-dark">Assistant</label>
        {turns.length > 0 && (
          <button type="button" onClick={reset} className="text-xs text-[var(--tx-3)] hover:text-accent hover:underline">
            New conversation
          </button>
        )}
      </div>

      {turns.length > 0 && (
        <div className="mt-2 max-h-80 space-y-2 overflow-y-auto rounded-lg border border-line bg-[var(--surface)] p-2.5">
          {turns.map((turn, i) => (
            <div key={i} className={turn.role === "user" ? "text-right" : ""}>
              <span
                className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-left text-sm ${
                  turn.role === "user" ? "bg-accent text-white" : "bg-[var(--surface-2)] text-[var(--tx)]"
                }`}
              >
                {turn.content}
              </span>
            </div>
          ))}
          {isThinking && <p className="text-xs text-[var(--tx-3)]">Working...</p>}
          <div ref={endRef} />
        </div>
      )}

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            send();
          }
        }}
        placeholder={
          turns.length === 0
            ? "Ask for something, or tell me what happened."
            : "Reply, or ask for a change..."
        }
        rows={2}
        className="mt-1.5 w-full rounded border border-line-2 p-2 text-sm"
      />
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={send}
          disabled={!text.trim() || isThinking}
          className={buttonClass("primary", "md")}
        >
          {isThinking ? "Working..." : "Send"}
        </button>
        <ModelSelect value={model} onChange={setModel} />
        <span className="text-xs text-[var(--tx-3)]">Nothing is saved or sent until you confirm.</span>
      </div>

      {plan.length > 0 && (
        <div className="mt-3 rounded-lg border border-line bg-[var(--surface)] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--tx-3)]">Ready to apply</p>
          <ul className="mt-2 space-y-1.5">
            {plan.map((action, i) => (
              <li key={i} className="text-sm">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={!skipped.has(i)}
                    onChange={() => setSkipped((prev) => toggle(prev, i))}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <span className={skipped.has(i) ? "text-[var(--tx-3)] line-through" : "text-[var(--tx)]"}>
                      {action.summary}
                    </span>
                    {action.body && (
                      <button
                        type="button"
                        onClick={() => setExpanded((prev) => toggle(prev, i))}
                        className="ml-2 text-xs text-[var(--tx-3)] hover:text-accent hover:underline"
                      >
                        {expanded.has(i) ? "Hide" : "Preview"}
                      </button>
                    )}
                    {expanded.has(i) && (
                      <div className="mt-1.5 rounded border border-line bg-[var(--surface-2)] p-2 text-xs text-[var(--tx-2)]">
                        {action.personEmail && <p className="text-[var(--tx-3)]">To: {action.personEmail}</p>}
                        {action.subject && <p className="text-[var(--tx-3)]">Subject: {action.subject}</p>}
                        {action.attachDocumentIds.length > 0 && (
                          <p className="text-[var(--tx-3)]">
                            Attaching {action.attachDocumentIds.length} document
                            {action.attachDocumentIds.length > 1 ? "s" : ""} as .docx
                          </p>
                        )}
                        <p className="mt-1 whitespace-pre-wrap">{action.body}</p>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <button
              type="button"
              onClick={apply}
              disabled={isApplying || skipped.size === plan.length}
              className={buttonClass("primary", "sm")}
            >
              {isApplying ? "Applying..." : `Apply ${plan.length - skipped.size}`}
            </button>
            <button
              type="button"
              onClick={() => setPlan([])}
              className="text-xs text-[var(--tx-3)] hover:text-accent hover:underline"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {done && done.length > 0 && (
        <div className="mt-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
          {done.map((d, i) => (
            <p key={i}>{d}</p>
          ))}
        </div>
      )}

      {error && <p className={ERROR_TEXT}>{error}</p>}
    </div>
  );
}
