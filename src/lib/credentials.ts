import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { seal, unseal, hintOf } from "@/lib/secrets";

/**
 * Where a credential comes from, and what the app does when it is absent.
 *
 * Counsel is deployed one instance per person. Until now that instance was
 * configured the way a developer configures things: environment variables, set
 * by whoever ran `vercel env add`. That is fine for Dan and impossible for
 * anyone he hands it to, which makes the stand-alone story architectural rather
 * than real - the isolation is genuine but nobody else can set one up.
 *
 * So a credential resolves in two places, in this order:
 *
 * 1. **The environment.** Existing deployments keep working untouched, and a
 *    self-hosted instance can still be configured entirely from env vars with
 *    no database writes at all.
 * 2. **The database**, entered through Settings and encrypted at rest.
 *
 * Environment first is deliberate: a deployment-level setting should not be
 * silently overridable from inside the app, and it makes "how do I take this
 * back" answerable without a UI.
 *
 * Absence is a first-class state. `null` means the feature is unavailable, and
 * the caller's job is to say so rather than to throw - which is the difference
 * between an app somebody can set up gradually and one that shows an error
 * until every box is filled.
 */

/**
 * Two families, stored the same way and used for different things.
 *
 * **Model kinds** answer "can this app think". **Platform kinds** answer "can
 * this app create an instance for somebody else", which is an operator
 * capability rather than a feature of the job search, and must never appear
 * in the places that ask which provider to draft a document with.
 *
 * They share this module because the storage question is identical: a secret,
 * encrypted at rest, resolvable from the environment first.
 */
export type ModelKind = "anthropic" | "gemini";
export type PlatformKind = "vercel" | "neon";
export type CredentialKind = ModelKind | PlatformKind;

export const MODEL_KINDS: ModelKind[] = ["anthropic", "gemini"];
export const PLATFORM_KINDS: PlatformKind[] = ["vercel", "neon"];

const ENV_VAR: Record<CredentialKind, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  vercel: "VERCEL_TOKEN",
  neon: "NEON_API_KEY",
};

export const CREDENTIAL_LABEL: Record<CredentialKind, string> = {
  anthropic: "Anthropic API key",
  gemini: "Google Gemini API key",
  vercel: "Vercel token",
  neon: "Neon API key",
};

/**
 * Deduped per request: several routes ask for the same key while assembling a
 * single response, and each ask would otherwise be a round trip.
 */
const storedCredentials = cache(async (): Promise<Map<string, string>> => {
  try {
    const rows = await prisma.credential.findMany();
    const out = new Map<string, string>();
    for (const row of rows) {
      const value = unseal(row.sealed);
      if (value) out.set(row.kind, value);
    }
    return out;
  } catch {
    // A missing table on an un-migrated deployment must not take the app down;
    // it just means nothing is stored yet.
    return new Map();
  }
});

/** The key for a service, or null when none is configured. */
export async function getCredential(kind: CredentialKind): Promise<string | null> {
  const fromEnv = process.env[ENV_VAR[kind]]?.trim();
  if (fromEnv) return fromEnv;
  return (await storedCredentials()).get(kind) ?? null;
}

export type CredentialStatus = {
  kind: CredentialKind;
  label: string;
  configured: boolean;
  /** "environment" or "settings", so it is obvious which one is in force. */
  source: "environment" | "settings" | null;
  /** Last four characters, never the whole value. */
  hint: string | null;
};

/** What is configured, for the Settings page. Never returns a secret. */
export async function credentialStatuses(): Promise<CredentialStatus[]> {
  const stored = await prisma.credential.findMany().catch(() => []);
  const byKind = new Map(stored.map((r) => [r.kind, r]));

  // Model kinds only. This feeds the "which provider" surfaces, and a Vercel
  // token listed as a model provider would be offered as something to draft a
  // cover letter with.
  return MODEL_KINDS.map((kind) => {
    const fromEnv = process.env[ENV_VAR[kind]]?.trim();
    if (fromEnv) {
      return { kind, label: CREDENTIAL_LABEL[kind], configured: true, source: "environment", hint: hintOf(fromEnv) };
    }
    const row = byKind.get(kind);
    if (row) {
      // A row whose value will not unseal is worse than no row: it looks
      // configured and fails at the point of use. Report it as absent.
      const usable = unseal(row.sealed) !== null;
      return {
        kind,
        label: CREDENTIAL_LABEL[kind],
        configured: usable,
        source: usable ? "settings" : null,
        hint: usable ? row.hint : null,
      };
    }
    return { kind, label: CREDENTIAL_LABEL[kind], configured: false, source: null, hint: null };
  });
}

export async function saveCredential(kind: CredentialKind, plaintext: string): Promise<void> {
  const value = plaintext.trim();
  if (!value) return;
  const data = { sealed: seal(value), hint: hintOf(value) };
  await prisma.credential.upsert({ where: { kind }, create: { kind, ...data }, update: data });
}

export async function clearCredential(kind: CredentialKind): Promise<void> {
  await prisma.credential.deleteMany({ where: { kind } });
}

/**
 * Which model providers this deployment can actually reach.
 *
 * Used to decide what the interface offers rather than what it errors on: a
 * person who has supplied neither key should see an explanation, not a row of
 * buttons that all fail.
 */
export async function availableProviders(): Promise<{ anthropic: boolean; gemini: boolean; any: boolean }> {
  const [anthropic, gemini] = await Promise.all([getCredential("anthropic"), getCredential("gemini")]);
  return { anthropic: Boolean(anthropic), gemini: Boolean(gemini), any: Boolean(anthropic || gemini) };
}

/** Status of the operator tokens, for the page that provisions instances. */
export async function platformCredentialStatuses(): Promise<CredentialStatus[]> {
  const stored = await prisma.credential.findMany().catch(() => []);
  const byKind = new Map(stored.map((r) => [r.kind, r]));

  return PLATFORM_KINDS.map((kind) => {
    const fromEnv = process.env[ENV_VAR[kind]]?.trim();
    if (fromEnv) {
      return { kind, label: CREDENTIAL_LABEL[kind], configured: true, source: "environment" as const, hint: hintOf(fromEnv) };
    }
    const row = byKind.get(kind);
    if (row) {
      const usable = unseal(row.sealed) !== null;
      return {
        kind,
        label: CREDENTIAL_LABEL[kind],
        configured: usable,
        source: usable ? ("settings" as const) : null,
        hint: usable ? row.hint : null,
      };
    }
    return { kind, label: CREDENTIAL_LABEL[kind], configured: false, source: null, hint: null };
  });
}
