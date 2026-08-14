"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { JOB_STATUSES } from "@/lib/constants";
import { persistJobDescriptionDocument } from "@/lib/job-description";
import { cleanInlineText } from "@/lib/text";

export async function createApplication(formData: FormData) {
  // Pasting a title straight off a careers page is the normal way to fill this
  // in, so it gets the same cleanup as the extracted paths.
  const companyName = cleanInlineText(String(formData.get("companyName") ?? ""));
  const roleTitle = cleanInlineText(String(formData.get("roleTitle") ?? ""));
  if (!companyName || !roleTitle) {
    throw new Error("Company and role are required.");
  }

  const driveFolderName = cleanInlineText(String(formData.get("driveFolderName") ?? "")) || companyName;
  const postingLink = String(formData.get("postingLink") ?? "").trim() || null;
  const salaryRange = cleanInlineText(String(formData.get("salaryRange") ?? "")) || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const rawJd = String(formData.get("jobDescription") ?? "").trim();
  const statusInput = String(formData.get("status") ?? "");
  const status = JOB_STATUSES.includes(statusInput as (typeof JOB_STATUSES)[number]) ? statusInput : "LIVE_POSTING_FOUND";

  const company = await prisma.company.upsert({
    where: { name: companyName },
    create: { name: companyName, driveFolderName },
    update: {},
  });

  const application = await prisma.jobApplication.create({
    data: {
      companyId: company.id,
      roleTitle,
      postingLink,
      salaryRange,
      status,
      notes,
    },
  });

  if (rawJd) {
    await persistJobDescriptionDocument(application.id, rawJd);
  }

  redirect(`/applications/${application.id}`);
}
