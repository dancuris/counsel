"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { AVAILABLE_MODELS } from "@/lib/models";
import { parseDriveFolderId } from "@/lib/drive-folder";
import { TENANT_ID } from "@/lib/tenant";
import { saveCredential, clearCredential, type CredentialKind } from "@/lib/credentials";
import { changeOwnerPassword } from "@/lib/owner";
import { connectFastmail, disconnectFastmail } from "@/lib/fastmail";
import { isMailProvider } from "@/lib/mail-provider";

export type FastmailResult = { ok: boolean; message: string };

/**
 * The default model every AI surface uses when it is not given one.
 *
 * This lived on the Profile page, which is where the *content* that grounds the
 * AI lives - positioning, narrative, variants. Which model runs is a setting,
 * not content, so it moved here. Deliberately moved rather than copied: two
 * forms writing one field is how a stale box plus Save silently reverts it.
 */
export async function saveDefaultModel(formData: FormData) {
  const value = String(formData.get("preferredModel") ?? "").trim();
  // Empty means "use the environment default", which is a real choice. Anything
  // else has to be a model the app actually offers, or every call fails with a
  // provider error that names nothing useful.
  const preferredModel = value === "" ? null : AVAILABLE_MODELS.some((m) => m.value === value) ? value : null;

  await prisma.profile.update({ where: { id: TENANT_ID }, data: { preferredModel } });
  revalidatePath("/settings");
  revalidatePath("/profile");
}

/**
 * The two integration settings, moved off Profile for the same reason as the
 * model: they are how the app behaves, not what it knows about Dan. A calendar
 * subscription and a Drive folder id are wiring.
 */
export async function saveIntegrations(formData: FormData) {
  const icsCalendarUrl = String(formData.get("icsCalendarUrl") ?? "").trim() || null;
  const raw = String(formData.get("driveRootFolderId") ?? "");
  const driveRootFolderId = parseDriveFolderId(raw);

  // A paste that did not parse must not silently clear the folder Counsel has
  // been filing into all along - that would send every later document to a new
  // "Counsel" folder and leave the old tree behind without a word.
  if (raw.trim() && !driveRootFolderId) {
    throw new Error("That does not look like a Drive folder id or folder URL. Nothing was changed.");
  }

  await prisma.profile.update({ where: { id: TENANT_ID }, data: { icsCalendarUrl, driveRootFolderId } });
  revalidatePath("/settings");
  revalidatePath("/profile");
}

/**
 * Marks the swallowed-failure list as looked at.
 *
 * The count is "new since you last checked" rather than "ever", because a
 * permanent number teaches you to ignore it - the same reason the Inbox hides
 * what the classifier marks not job related.
 */
export async function markFailuresSeen() {
  await prisma.failureLog.updateMany({ where: { seenAt: null }, data: { seenAt: new Date() } });
  revalidatePath("/settings");
}

/**
 * Stores an API key, encrypted.
 *
 * The value arrives in a form POST and is sealed before it reaches the
 * database; nothing logs it and nothing echoes it back. The page afterwards
 * shows only the last four characters, which is enough to answer "is the right
 * key in here" and not enough to use.
 */
export async function saveApiKey(formData: FormData) {
  const kind = String(formData.get("kind") ?? "") as CredentialKind;
  if (kind !== "anthropic" && kind !== "gemini") return;
  const value = String(formData.get("value") ?? "").trim();
  if (!value) return;
  await saveCredential(kind, value);
  revalidatePath("/settings");
}

export async function removeApiKey(formData: FormData) {
  const kind = String(formData.get("kind") ?? "") as CredentialKind;
  if (kind !== "anthropic" && kind !== "gemini") return;
  await clearCredential(kind);
  revalidatePath("/settings");
}

/**
 * Rotating the password on an instance that was claimed from the web.
 *
 * Only offered where a password is actually in use. On a deployment signing in
 * with Google there is nothing here to change, and showing the form would
 * suggest otherwise.
 */
export async function changePassword(_prev: string | null, formData: FormData): Promise<string | null> {
  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const result = await changeOwnerPassword(current, next);
  revalidatePath("/settings");
  return result.ok ? "Password changed." : result.error;
}

/**
 * The tokens that let this instance create instances for other people.
 *
 * Kept apart from the model keys by a separate action rather than a wider
 * `kind` check, so a Vercel token can never be saved through the form that
 * asks which model to draft a cover letter with.
 */
export async function savePlatformKey(formData: FormData) {
  const kind = String(formData.get("kind") ?? "") as CredentialKind;
  if (kind !== "vercel" && kind !== "neon") return;
  const value = String(formData.get("value") ?? "").trim();
  if (!value) return;
  await saveCredential(kind, value);
  revalidatePath("/settings");
  revalidatePath("/instances");
}

export async function removePlatformKey(formData: FormData) {
  const kind = String(formData.get("kind") ?? "") as CredentialKind;
  if (kind !== "vercel" && kind !== "neon") return;
  await clearCredential(kind);
  revalidatePath("/settings");
  revalidatePath("/instances");
}

/**
 * Connects Fastmail with an API token.
 *
 * The token is checked against Fastmail before it is stored, so a typo or a
 * token without the send scope is reported here, on the page where it can be
 * fixed, rather than on the first sync or the first send. Like a model key it
 * is sealed before it reaches the database and never shown back.
 */
export async function connectFastmailAction(_prev: FastmailResult | null, formData: FormData): Promise<FastmailResult> {
  const token = String(formData.get("token") ?? "");
  try {
    const { email, canSend } = await connectFastmail(token);
    revalidatePath("/settings");
    revalidatePath("/inbox");
    return {
      ok: true,
      message: canSend
        ? `Connected ${email}. Counsel can read and send from it.`
        : `Connected ${email} for reading only. The token has no Email submission scope, so nothing can be sent from it.`,
    };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "That did not connect." };
  }
}

export async function disconnectFastmailAction() {
  await disconnectFastmail();
  revalidatePath("/settings");
  revalidatePath("/inbox");
}

/** Which mailbox a new message goes out through. Replies always follow their thread. */
export async function saveSendMailVia(formData: FormData) {
  const value = String(formData.get("sendMailVia") ?? "");
  await prisma.profile.update({
    where: { id: TENANT_ID },
    data: { sendMailVia: isMailProvider(value) ? value : null },
  });
  revalidatePath("/settings");
}
