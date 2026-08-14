// Plain data only (no server-only imports) so this can be imported from
// both server code (src/lib/anthropic.ts) and client components (the
// per-action model dropdowns) without pulling the Anthropic SDK or Prisma
// into the client bundle.
export const AVAILABLE_MODELS: { value: string; label: string }[] = [
  { value: "claude-opus-5", label: "Opus 5 (most capable, slowest/priciest)" },
  { value: "claude-sonnet-5", label: "Sonnet 5 (recommended)" },
  { value: "claude-haiku-4-5-20251001", label: "Haiku 4.5 (fastest/cheapest)" },
  // A second provider, for a genuinely different read on the same role and as
  // a way to keep working when Claude credit runs out.
  { value: "gemini-pro-latest", label: "Gemini Pro (second opinion)" },
  { value: "gemini-flash-latest", label: "Gemini Flash (fast, cheap)" },
];

export const DEFAULT_MODEL = "claude-sonnet-5";
