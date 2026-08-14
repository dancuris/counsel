"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { parseDriveFolderId } from "@/lib/drive-folder";
import { parseLabelledLines } from "@/lib/contact-block";
import { TENANT_ID } from "@/lib/tenant";

export async function updateProfile(formData: FormData) {
  const positioning = String(formData.get("positioning") ?? "");
  const careerNarrative = String(formData.get("careerNarrative") ?? "");
  const personalLogistics = String(formData.get("personalLogistics") ?? "");
  const standingPreferences = String(formData.get("standingPreferences") ?? "");
  const evaluationFramework = String(formData.get("evaluationFramework") ?? "");

  const ruledOutRaw = String(formData.get("ruledOutCompanies") ?? "");
  const ruledOut = ruledOutRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const ruledOutCompanies = JSON.stringify(ruledOut);

  const masterResume = String(formData.get("masterResume") ?? "").trim() || null;
  const contactName = String(formData.get("contactName") ?? "").trim() || null;
  const contactPhone = String(formData.get("contactPhone") ?? "").trim() || null;
  const contactLinks = String(formData.get("contactLinks") ?? "").trim() || null;
  const contactAddresses = JSON.stringify(parseLabelledLines(String(formData.get("contactAddresses") ?? "")));
  const contactEmails = JSON.stringify(parseLabelledLines(String(formData.get("contactEmails") ?? "")));
  const defaultAddressLabel = String(formData.get("defaultAddressLabel") ?? "").trim() || null;
  const defaultEmailLabel = String(formData.get("defaultEmailLabel") ?? "").trim() || null;

  // Same guard as preferredModel: these moved to /settings, and a field absent
  // from the form reads as empty, which would blank his calendar subscription
  // and his Drive root every time he saved his profile. `undefined` tells
  // Prisma to leave the column alone.
  const icsCalendarUrl = formData.has("icsCalendarUrl")
    ? String(formData.get("icsCalendarUrl") ?? "").trim() || null
    : undefined;
  // Only touched when the form actually carries it. The control moved to
  // /settings, and `String(formData.get(...) ?? "")` on an absent field reads
  // as empty, which would have quietly reset his model choice to the default
  // every time he saved his profile. Any field that leaves a form has to be
  // made conditional at the same moment, or saving one page wipes another.
  const preferredModel = formData.has("preferredModel")
    ? String(formData.get("preferredModel") ?? "").trim() || null
    : undefined;
  // Accepts a pasted folder URL as well as a bare id, because copying the URL
  // out of the address bar is the obvious thing to do with a Drive folder.
  const driveRootFolderId = formData.has("driveRootFolderId")
    ? parseDriveFolderId(String(formData.get("driveRootFolderId") ?? ""))
    : undefined;

  const fields = {
    positioning,
    careerNarrative,
    personalLogistics,
    standingPreferences,
    evaluationFramework,
    ruledOutCompanies,
    masterResume,
    contactName,
    contactPhone,
    contactLinks,
    contactAddresses,
    contactEmails,
    defaultAddressLabel,
    defaultEmailLabel,
    icsCalendarUrl,
    preferredModel,
    driveRootFolderId,
  };

  await prisma.profile.upsert({
    where: { id: TENANT_ID },
    create: { id: TENANT_ID, ...fields },
    update: fields,
  });

  revalidatePath("/profile");
}
