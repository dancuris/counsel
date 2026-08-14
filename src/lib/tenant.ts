import { prisma } from "@/lib/prisma";

/**
 * Who this deployment belongs to, stated once.
 *
 * Counsel is single-tenant by design, and that is a feature rather than a
 * limitation. It holds the most sensitive thing a working executive owns: that
 * they are looking, what they think of their current employer, what they are
 * paid, and who is quietly helping. A shared database means one query missing
 * a tenant filter exposes all of it. An instance per customer means there is
 * no query that *could* leak, because the other customer's data is in another
 * database in another project.
 *
 * The defect was never the model, it was that the model was **implicit**. The
 * string `"singleton"` appeared as a bare literal in a dozen files, so nothing
 * named the assumption, nothing enforced it, and nothing would notice a query
 * that reached past it. That is the difference between a deliberate
 * architecture and a coincidence.
 *
 * So: one constant, one accessor, and a rule. Nothing outside this module
 * writes the id, and the id comes from the environment when it is set, which
 * is what makes provisioning a second instance a deployment rather than a
 * rewrite.
 */
export const TENANT_ID = process.env.COUNSEL_TENANT_ID?.trim() || "singleton";

/**
 * The profile row for this deployment.
 *
 * `select` is passed through so callers stay narrow: several pages want one
 * column and were pulling the whole row, which includes the entire career
 * narrative and every standing preference.
 */
export async function getProfile<T extends Record<string, boolean>>(select: T) {
  return prisma.profile.findUnique({ where: { id: TENANT_ID }, select });
}

/** The whole row, for the handful of callers that genuinely need all of it. */
export async function getFullProfile() {
  return prisma.profile.findUnique({ where: { id: TENANT_ID } });
}

/** Updates this deployment's profile. The only writer of the tenant id. */
export async function updateProfileRow(data: Record<string, unknown>) {
  return prisma.profile.update({ where: { id: TENANT_ID }, data });
}
