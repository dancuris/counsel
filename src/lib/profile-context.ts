import { prisma } from "@/lib/prisma";
import { TENANT_ID } from "@/lib/tenant";

export async function buildProfileContext(): Promise<string> {
  const profile = await prisma.profile.findUnique({ where: { id: TENANT_ID } });
  if (!profile) return "No standing profile has been set up yet. Ask general, careful questions about fit.";

  const ruledOut: string[] = JSON.parse(profile.ruledOutCompanies || "[]");

  return `# Positioning
${profile.positioning}

# Career narrative
${profile.careerNarrative}

# Personal / logistics constraints
${profile.personalLogistics}

# Standing document preferences (apply these exactly when drafting)
${profile.standingPreferences}

# Role evaluation framework (apply this when assessing fit)
${profile.evaluationFramework}

# Never consider (the candidate's own list, and only theirs)
# These are employers he will not work for under any circumstances. It is a
# permanent, personal exclusion that he alone maintains - it is NOT a record of
# roles that were passed on, rejected or closed. A company being absent from
# this list means nothing was ruled out; a company being present means do not
# recommend it whatever the role.
# Do not infer a reason for an entry, do not extend it to related companies,
# and never add a company to it yourself. A role that did not work out at an
# employer is a fact about that role, not about the employer.
${ruledOut.map((c) => `- ${c}`).join("\n")}`;
}
