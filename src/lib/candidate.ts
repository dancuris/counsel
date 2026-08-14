import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { TENANT_ID } from "@/lib/tenant";

/**
 * Whose instance this is.
 *
 * Six prompts hardcoded one person's name, which is the same fault as the
 * employer list that used to live in `generate-documents`: correct and
 * invisible on the instance where it was written, wrong on every other one.
 *
 * The worst of them told the model to sign an email off with that name, so a
 * different person's recruiter mail would have gone out signed by somebody
 * else. A prompt that names the user is data wearing a constant.
 *
 * Deduped per request, since several routes ask while assembling one response.
 */
export const candidateName = cache(async (): Promise<string> => {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: { contactName: true },
  });
  return profile?.contactName?.trim() || "the candidate";
});
