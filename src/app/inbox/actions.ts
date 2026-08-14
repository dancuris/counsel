"use server";

import { revalidatePath } from "next/cache";
import { syncInterviewNotesToDriveQuietly } from "@/lib/drive-records";
import { createCalendarEvent } from "@/lib/google-mail";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { cleanInlineText } from "@/lib/text";
import { advanceOnMeeting } from "@/lib/meeting-status";
import { asEastern, readDateField } from "@/lib/local-time";

// Turns an untracked opportunity spotted in the mailbox into a real
// application, and links the message that surfaced it.

/**
 * Files a message to a role, and to that role's employer at the same time.
 *
 * Three call sites set applicationId, and each one that forgets the company
 * leaves a message the company page cannot see. One helper so the next filing
 * path cannot introduce a fourth.
 */
async function fileToApplication(mailId: string, applicationId: string) {
  // One transaction: the read supplies the company that the write stores, so
  // between them the role could be moved to a different employer and the
  // message would end up filed to the old one - visible nowhere, because both
  // halves succeeded.
  await prisma.$transaction(async (tx) => {
    const app = await tx.jobApplication.findUnique({
      where: { id: applicationId },
      select: { companyId: true },
    });
    await tx.mailMessage.update({
      where: { id: mailId },
      data: { applicationId, companyId: app?.companyId ?? null },
    });
  });
}

export async function createApplicationFromMail(mailId: string) {
  const mail = await prisma.mailMessage.findUnique({ where: { id: mailId } });
  if (!mail) return;

  const companyName = (mail.detectedCompany ?? "").trim() || "Unknown company";

  // A subject line is not a job title.
  //
  // This fell back to `mail.subject.slice(0, 120)`, so a networking thread with
  // a networking thread - a virtual coffee with a VP, no job behind it - would have created
  // a tracked role called "Fw: Re: Finding Time" at LIVE_POSTING_FOUND and
  // dropped Dan into it. Seven messages in the mailbox have a detected company
  // and no detected role, which is exactly the shape company filing exists for.
  //
  // The Inbox only offers this button when a role was actually detected, so
  // this guard is the second line rather than the first.
  const roleTitle = (mail.detectedRole ?? "").trim();
  if (!roleTitle) return;

  // Company, role and the filing in one transaction. Half of this succeeding
  // leaves an employer with no role under it, or a role the message that
  // created it is not attached to - both of which look like ordinary data and
  // neither of which anything would report.
  const application = await prisma.$transaction(async (tx) => {
    const company = await tx.company.upsert({
      where: { name: companyName },
      create: { name: companyName },
      update: {},
    });

    const created = await tx.jobApplication.create({
      data: {
        companyId: company.id,
        roleTitle,
        status: "LIVE_POSTING_FOUND",
        notes: `Surfaced from mail: ${mail.summary ?? mail.subject}`,
        lastCheckedAt: new Date(),
      },
    });

    await tx.mailMessage.update({
      where: { id: mailId },
      data: { applicationId: created.id, companyId: company.id },
    });
    return created;
  });

  revalidatePath("/");
  revalidatePath("/inbox");
  redirect(`/applications/${application.id}`);
}

export async function attachMailToApplication(mailId: string, formData: FormData) {
  const applicationId = String(formData.get("applicationId") ?? "");
  if (!applicationId) return;
  await fileToApplication(mailId, applicationId);
  revalidatePath("/inbox");
  revalidatePath("/");
}

export async function dismissMail(mailId: string) {
  await prisma.mailMessage.update({ where: { id: mailId }, data: { dismissedAt: new Date() } });
  revalidatePath("/inbox");
  revalidatePath("/");
}

// The classifier's false negatives are the dangerous ones: a real rejection
// binned as noise vanishes silently. Promoting a message puts it back in the
// filing queue so it can be attached or turned into an application.
export async function markMailJobRelated(mailId: string) {
  await prisma.mailMessage.update({
    where: { id: mailId },
    data: { category: "other_job_related", dismissedAt: null },
  });
  revalidatePath("/inbox");
  revalidatePath("/");
}

// Filing mail was a one-way trapdoor: it left the Inbox and was displayed
// nowhere, so a wrong attachment could not be seen, moved, or undone.
export async function unlinkMail(mailId: string, applicationId: string) {
  await prisma.mailMessage.update({ where: { id: mailId }, data: { applicationId: null } });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/inbox");
  revalidatePath("/");
}

export async function refileMail(mailId: string, fromApplicationId: string, formData: FormData) {
  const applicationId = String(formData.get("applicationId") ?? "");
  if (!applicationId) return;
  await fileToApplication(mailId, applicationId);
  revalidatePath(`/applications/${fromApplicationId}`);
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/inbox");
}

/**
 * Turns a proposed interview time into a real calendar entry.
 *
 * Confirmation rather than automation, deliberately. The time was read out of
 * prose by a model, and an interview written to the wrong slot on a calendar a
 * recruiter can see is worse than one that was never written at all. So the
 * parse is offered, with the wording it came from, and this only runs when the
 * user presses the button.
 */
export async function scheduleFromMail(mailId: string, formData: FormData) {
  const mail = await prisma.mailMessage.findUnique({
    where: { id: mailId },
    include: { application: { include: { company: true } } },
  });
  if (!mail?.proposedStart || mail.scheduledAt) return;

  // An edited time in the form wins: the parse is a starting point, not a fact.
  //
  // Read as Eastern, never `new Date()`. A datetime-local value has no offset
  // in it, so the plain constructor used the runtime's zone - UTC on Vercel -
  // and silently moved an interview from 1:30pm to 9:30am, on the
  // dashboard and on the real Google Calendar entry both.
  const start = asEastern(readDateField(formData, "start")) ?? mail.proposedStart;
  if (!start || Number.isNaN(start.getTime())) return;

  const company = mail.application?.company.name ?? mail.detectedCompany ?? "Interview";
  const role = mail.application?.roleTitle ?? mail.detectedRole ?? "";
  const roundName = String(formData.get("roundName") ?? "").trim() || "Interview";

  let eventId: string | null = null;
  let eventLink: string | null = null;
  try {
    const event = await createCalendarEvent({
      summary: `${company} - ${roundName}`,
      description: [role, mail.summary, `From: ${mail.subject}`].filter(Boolean).join("\n\n"),
      start,
      durationMinutes: 60,
    });
    eventId = event.id;
    eventLink = event.htmlLink;
  } catch {
    // Fall through: the interview note is still worth having on its own.
  }

  if (mail.applicationId) {
    await prisma.interviewNote.create({
      data: {
        applicationId: mail.applicationId,
        roundName,
        date: start,
        notes: `Scheduled from "${mail.subject}".${mail.proposedLabel ? ` Time given as: ${mail.proposedLabel}.` : ""}`,
        googleEventId: eventId,
        googleEventLink: eventLink,
      },
    });
    await syncInterviewNotesToDriveQuietly(mail.applicationId);
    // Confirming a proposed time is a booking, whatever the classifier made of
    // the message that proposed it. This is the path that invitation came in on.
    await advanceOnMeeting(mail.applicationId);
  }

  await prisma.mailMessage.update({ where: { id: mailId }, data: { scheduledAt: new Date() } });
  revalidatePath("/inbox");
  if (mail.applicationId) revalidatePath(`/applications/${mail.applicationId}`);
}

/**
 * Turns the sender of a message into a contact.
 *
 * The two pages never met: eight contacts had an email address, nine distinct
 * senders appeared in job-related mail, and the intersection was empty. So the
 * contact page's inbound matching, which pairs `MailMessage.fromEmail` against
 * `Contact.email`, had never once fired - every thread looked one-sided and
 * looked like a working feature.
 *
 * This is the join. Filing a message to a role already says who it is about;
 * this says who it is from, and from then on their side of the conversation
 * appears wherever they do.
 */
export async function addContactFromMail(mailId: string) {
  const mail = await prisma.mailMessage.findUnique({
    where: { id: mailId },
    include: { application: { include: { company: true } } },
  });
  // The recovered sender wins: a forward from Dan's own address is really a
  // message from the recruiter quoted inside it.
  const email = (mail?.forwardedFromEmail ?? mail?.fromEmail ?? "").trim();
  if (!mail || !email) return;

  const senderName = mail.forwardedFromName ?? mail.fromName;
  const existing = await prisma.contact.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  // Already known: nothing to do, and nowhere to go. The row will render the
  // link to them instead of the button.
  if (existing) {
    revalidatePath("/inbox");
    return;
  }

  await prisma.contact.create({
    data: {
      // The display name is often "<Company> Careers" rather than a person, which is
      // still the right label for a correspondent worth tracking. The address
      // is the part that has to be right, since it is what the matching keys on.
      name: cleanInlineText(senderName) || email.split("@")[0],
      email,
      // Carried so the contact lands against the role the mail was filed to.
      applicationId: mail.applicationId,
      relationship: mail.application
        ? `Emailed about ${mail.application.company.name}`
        : "From the mailbox",
    },
  });

  revalidatePath("/inbox");
  revalidatePath("/contacts");
  if (mail.applicationId) revalidatePath(`/applications/${mail.applicationId}`);
  // Deliberately no redirect.
  //
  // "Add as contact" reads like a small side-effect and used to teleport you
  // to the new contact's page, leaving the message unfiled behind you - the
  // one thing the Inbox row exists to resolve. Adding somebody is enrichment,
  // not navigation. The row re-renders with a link to them, so the result is
  // visible and reaching them is still one click.
}


/**
 * Files a message against an employer rather than a role.
 *
 * The gap this closes: a networking introduction has no application behind it.
 * Brian at TransUnion is a person Dan was introduced to, and filing that under
 * a job would invent one while leaving it unfiled loses it entirely. Company
 * filing keeps it, and if Brian introduces him to a specific role next month
 * the history is already there to move across.
 *
 * Filing to a company clears any application, because the two are a choice
 * rather than a pair: mail that belongs to a role is already reachable from
 * that role's company page through the relation.
 */
/**
 * Files a message against a person.
 *
 * The third kind of filing, and the one the other two could not express. A
 * networking thread belongs to whoever is in it: the person is the
 * relationship, and their employer is only where they happen to work. Filing
 * to the company kept the message and lost the point of it.
 *
 * It sets the employer too when the contact has one, so a message filed to a
 * person still turns up under that company - and when a role appears there
 * later, the history is already sitting on both.
 */
export async function fileMailToContact(mailId: string, formData: FormData) {
  const contactId = String(formData.get("contactId") ?? "").trim();
  if (!contactId) return;

  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, company: true, applicationId: true },
  });
  if (!contact) return;

  // The employer, matched by name, so filing to a person also files to where
  // they work without asking twice.
  const company = contact.company
    ? await prisma.company.findFirst({ where: { name: { equals: contact.company, mode: "insensitive" } }, select: { id: true } })
    : null;

  await prisma.mailMessage.update({
    where: { id: mailId },
    data: { contactId, companyId: company?.id ?? null, applicationId: null },
  });

  revalidatePath("/inbox");
  revalidatePath("/");
  revalidatePath(`/contacts/${contactId}`);
}

export async function fileMailToCompany(mailId: string, formData: FormData) {
  let companyId = String(formData.get("companyId") ?? "").trim();

  // A company that is not tracked yet.
  //
  // The picker used to offer only employers with a live application, which
  // makes the feature useless for the case it was built for: an introduction
  // to somebody at a company Dan has never applied to has, by definition, no
  // posting behind it. Typing the name creates it.
  const newName = String(formData.get("newCompanyName") ?? "").trim();
  if (!companyId && newName) {
    // Matched case-insensitively first, so "transunion" does not become a
    // second TransUnion beside the real one.
    const existing = await prisma.company.findFirst({
      where: { name: { equals: newName, mode: "insensitive" } },
      select: { id: true },
    });
    companyId = existing?.id ?? (await prisma.company.create({ data: { name: newName }, select: { id: true } })).id;
  }
  if (!companyId) return;

  const before = await prisma.mailMessage.findUnique({
    where: { id: mailId },
    select: { applicationId: true },
  });

  await prisma.mailMessage.update({
    where: { id: mailId },
    data: { companyId, applicationId: null },
  });

  if (before?.applicationId) revalidatePath(`/applications/${before.applicationId}`);
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/companies");
  revalidatePath("/inbox");
}
