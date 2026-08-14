import type { Prisma } from "@/generated/prisma/client";

/**
 * What counts as filed, and therefore what still needs you.
 *
 * Filing a message attaches it to a role, an employer, or a person. All three
 * are filing:
 * Brian Silver's introduction belongs to TransUnion whether or not TransUnion
 * ever posts a job, which is the whole reason company filing exists.
 *
 * This lived in three places and only one of them knew that. The inbox was
 * fixed to count a company as filed; the dashboard and the pipeline kept
 * matching on `applicationId` alone, so a message filed to a company stayed in
 * their to-file counts forever. The badge said one thing needed doing, the
 * inbox it pointed at said nothing did, and the only way to clear the badge
 * was to file the message somewhere it did not belong.
 *
 * A count that disagrees with the page behind it is worse than no count, so
 * the definition lives here now and every caller reads it from one place.
 */
export const FILED_MAIL: Prisma.MailMessageWhereInput = {
  OR: [{ applicationId: { not: null } }, { companyId: { not: null } }, { contactId: { not: null } }],
};

/**
 * Mail that has not been filed against anything and is still asking for a
 * decision. Dismissed and archived messages have had their decision made.
 *
 * Uncategorised mail is excluded along with `not_job_related`: the classifier
 * has not looked at it yet, and 38 LinkedIn alerts behind a permanent badge
 * would teach him to ignore the badge, which is where the one real recruiter
 * mail then hides.
 */
export const UNFILED_MAIL: Prisma.MailMessageWhereInput = {
  applicationId: null,
  companyId: null,
  contactId: null,
  dismissedAt: null,
  archivedAt: null,
  category: { not: "not_job_related" },
  NOT: { category: null },
};
