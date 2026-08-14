"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TENANT_ID } from "@/lib/tenant";
import { parseLabelledLines } from "@/lib/contact-block";
import { parseAnswers, SEARCH_QUESTIONS, type OnboardingStepId } from "@/lib/onboarding";
import { saveCredential, type CredentialKind } from "@/lib/credentials";

/**
 * Each step writes as it is answered.
 *
 * Nothing is held in component state between steps, so closing the tab loses
 * at most the box currently being typed in. The alternative, accumulating
 * answers client side and saving at the end, is how a long form loses
 * somebody's afternoon.
 *
 * The Profile row is created here rather than assumed. On a fresh deployment
 * there is no singleton yet, and every one of these steps would otherwise fail
 * on a row that does not exist.
 */

/** The prose fields are NOT NULL with no default, so a new row needs them. */
const EMPTY_PROFILE = {
  positioning: "",
  careerNarrative: "",
  personalLogistics: "",
  standingPreferences: "",
  evaluationFramework: "",
  ruledOutCompanies: "[]",
};

async function updateProfile(data: Record<string, unknown>) {
  await prisma.profile.upsert({
    where: { id: TENANT_ID },
    create: { id: TENANT_ID, ...EMPTY_PROFILE, ...data },
    update: data,
  });
}

function onward(next: OnboardingStepId | null) {
  revalidatePath("/setup/start");
  revalidatePath("/setup");
  redirect(next ? `/setup/start?step=${next}` : "/setup/start");
}

export async function saveIdentity(formData: FormData) {
  const contactName = String(formData.get("contactName") ?? "").trim() || null;
  const contactPhone = String(formData.get("contactPhone") ?? "").trim() || null;
  const contactLinks = String(formData.get("contactLinks") ?? "").trim() || null;

  // The labeled shape the letterhead reads: "Home: 12 Some Street, Town, ST".
  // A bare line with no label is kept and labeled by position, which
  // `parseLabelledLines` already handles, so somebody who ignores the format
  // still gets a working contact block.
  const contactEmails = JSON.stringify(parseLabelledLines(String(formData.get("contactEmails") ?? "")));
  const contactAddresses = JSON.stringify(parseLabelledLines(String(formData.get("contactAddresses") ?? "")));

  await updateProfile({ contactName, contactPhone, contactLinks, contactEmails, contactAddresses });
  onward("resume");
}

export async function saveResume(formData: FormData) {
  const masterResume = String(formData.get("masterResume") ?? "").trim();
  if (!masterResume) onward("resume");

  // Stored as pasted. The formatted version becomes a ResumeVariant when the
  // profile is derived, and keeping the original means a bad reformat can
  // always be re-run against what was actually given.
  await updateProfile({ masterResume });
  onward("search");
}

export async function saveAnswers(formData: FormData) {
  const existing = parseAnswers(
    (await prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { setupAnswers: true } }))?.setupAnswers
  );
  const answers = { ...existing };
  for (const question of SEARCH_QUESTIONS) {
    answers[question.name] = String(formData.get(question.name) ?? "").trim();
  }
  await updateProfile({ setupAnswers: JSON.stringify(answers) });
  onward("voice");
}

export async function saveVoiceSample(formData: FormData) {
  const content = String(formData.get("content") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim() || "My letter";
  if (!content) onward("model");

  const existing = await prisma.coverLetterSample.findFirst({ where: { name } });
  if (existing) {
    await prisma.coverLetterSample.update({ where: { id: existing.id }, data: { content, isDefault: true } });
  } else {
    await prisma.coverLetterSample.create({
      data: {
        name,
        description: "Given during setup, as a reference for how a letter should sound.",
        content,
        isDefault: true,
      },
    });
  }
  onward("model");
}

export async function saveModelKey(formData: FormData) {
  const kind = String(formData.get("kind") ?? "") as CredentialKind;
  const key = String(formData.get("key") ?? "").trim();
  if (key && (kind === "anthropic" || kind === "gemini")) {
    // Encrypted before it is stored, by `saveCredential`.
    await saveCredential(kind, key);
  }
  onward("derive");
}

/** Corrections to what the model wrote, from the review step. */
export async function saveDerivedProfile(formData: FormData) {
  await updateProfile({
    positioning: String(formData.get("positioning") ?? "").trim(),
    careerNarrative: String(formData.get("careerNarrative") ?? "").trim(),
    personalLogistics: String(formData.get("personalLogistics") ?? "").trim(),
    evaluationFramework: String(formData.get("evaluationFramework") ?? "").trim(),
    standingPreferences: String(formData.get("standingPreferences") ?? "").trim(),
  });
  revalidatePath("/setup/start");
  redirect("/setup/start?step=derive&saved=1");
}
