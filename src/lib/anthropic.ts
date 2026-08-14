import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { AVAILABLE_MODELS, DEFAULT_MODEL } from "@/lib/models";
import { IS_DEMO, DEMO_MODEL, assertDemoBudget } from "@/lib/demo";
import { TENANT_ID } from "@/lib/tenant";
import { getCredential } from "@/lib/credentials";

/**
 * Keyed by the credential, so a key entered in Settings takes effect without a
 * restart and a rotated one is not served from a stale client.
 */
let client: { key: string; instance: Anthropic } | null = null;

export async function getAnthropicClient(): Promise<Anthropic> {
  const apiKey = await getCredential("anthropic");
  if (!apiKey) {
    throw new Error(
      "No Anthropic API key is configured. Add one in Settings, or set ANTHROPIC_API_KEY."
    );
  }
  if (!client || client.key !== apiKey) {
    client = { key: apiKey, instance: new Anthropic({ apiKey }) };
  }
  return client.instance;
}

// Resolution order: Profile.preferredModel (set from the Profile page) >
// CLAUDE_MODEL env var > hardcoded default.
export async function getPreferredModel(): Promise<string> {
  const profile = await prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { preferredModel: true } });
  return profile?.preferredModel || process.env.CLAUDE_MODEL || DEFAULT_MODEL;
}

// Layers a one-off, per-action model choice (from a UI dropdown next to an
// individual "Evaluate"/"Draft"/etc. trigger) on top of the standing
// Profile/env default. Anything not in AVAILABLE_MODELS is ignored rather
// than passed through, since it only reaches here as a raw string from a
// client fetch body.
export async function resolveModel(requestedModel?: string | null): Promise<string> {
  // The demo's daily cap lives here because every AI route calls resolveModel
  // before it spends anything - the same reasoning that put the outbound
  // guards inside sendMail and driveFetch rather than in each caller. Outside
  // demo mode it returns immediately without touching the database.
  await assertDemoBudget(prisma);

  // Demo mode ignores the picker entirely. Letting a visitor select Opus would
  // hand them a five-times-more-expensive button on Dan's API key, and the
  // demo is about showing what the app does rather than which model it used.
  if (IS_DEMO) return DEMO_MODEL;
  if (requestedModel && AVAILABLE_MODELS.some((m) => m.value === requestedModel)) {
    return requestedModel;
  }
  return getPreferredModel();
}

// Anthropic SDK errors nest the useful message under error.error.message
// (e.g. "Your credit balance is too low..."); fall back to the generic
// Error message for anything else (network errors, etc).
export function getClaudeErrorMessage(e: unknown): string {
  const nested = (e as { error?: { error?: { message?: string } } })?.error?.error?.message;
  if (nested) return nested;
  return e instanceof Error ? e.message : "Claude request failed.";
}
/**
 * A system prompt whose stable half is cached.
 *
 * Every AI route sends the same thing at the top of its system prompt: the
 * Profile row, rendered by `buildProfileContext` - positioning, career
 * narrative, standing preferences, evaluation framework, verified metrics.
 * That block is identical across every route and every call, several thousand
 * tokens of it, and it was being re-sent and re-charged at full price on each
 * request. Anthropic's own usage report put the saving at up to 43%.
 *
 * Caching needs the stable text to be a **prefix**, and it was not: every
 * route interpolated the profile at the END of its instructions, so no two
 * calls shared a leading sequence and there was nothing to cache. So the order
 * is inverted here - profile first, then the route's own instructions - and
 * only the profile block carries `cache_control`.
 *
 * The consequence worth knowing: because the cached prefix is byte-identical
 * across routes, all of them share one cache entry. Editing the Profile
 * invalidates it once, and the next call re-establishes it.
 */
export function cachedSystem(profileContext: string, instructions: string) {
  return [
    {
      type: "text" as const,
      text: profileContext,
      cache_control: { type: "ephemeral" as const },
    },
    { type: "text" as const, text: instructions },
  ];
}
