import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@/lib/models";

/**
 * Who checks the draft.
 *
 * The point of a review pass is to catch what the writer missed, and a model
 * grading its own output is the weakest possible version of that: it agrees
 * with its own choices, because they were its choices. So the reviewer comes
 * from the **other** provider wherever there is one.
 *
 * Kept pure and separate from the route so the rule can be tested without an
 * API key, and so the UI can say who is about to review before anything runs.
 */

/** The model each provider fields for a review. */
const REVIEWERS: Record<string, string> = {
  // Reviewing is a judgement task over a long document, so the reviewer is the
  // capable model on each side rather than the cheap one. This runs once per
  // draft, not on every keystroke.
  anthropic: "claude-opus-5",
  google: "gemini-pro-latest",
};

/**
 * The reviewer for a document written by `writer`.
 *
 * `writer` is null for every document written before `Document.model` existed
 * and for anything adopted from Drive. Those fall to the Anthropic reviewer,
 * which is the right guess: almost everything in the history was written by
 * Claude, and a same-provider review is still worth more than none.
 */
export function reviewerFor(writer: string | null | undefined): string {
  // Deliberately not importing providerFor from `ai.ts`: that module pulls in
  // the Anthropic and Google SDKs, and this one is read by a client component.
  // Same reason `models.ts` holds plain data only. The rule is one line and
  // duplicating it costs less than shipping two SDKs to the browser.
  const isGoogle = Boolean(writer?.startsWith("gemini"));
  return isGoogle ? REVIEWERS.anthropic : REVIEWERS.google;
}

/** Short label for the UI, e.g. "Gemini Pro". Falls back to the raw id. */
export function modelLabel(model: string): string {
  const found = AVAILABLE_MODELS.find((m) => m.value === model);
  if (!found) return model;
  // The registry labels carry a parenthetical rationale for the picker
  // ("Opus 5 (most capable, slowest/priciest)"). In a sentence about who
  // reviewed something, only the name belongs.
  return found.label.replace(/\s*\(.*\)$/, "");
}

/** Who wrote it, for the same sentence. Null reads as unknown, never as a name. */
export function writerLabel(writer: string | null | undefined): string | null {
  if (!writer) return null;
  return modelLabel(writer);
}

export { DEFAULT_MODEL };
