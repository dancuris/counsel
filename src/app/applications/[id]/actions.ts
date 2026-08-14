"use server";

import { revalidatePath } from "next/cache";
import { syncInterviewNotesToDriveQuietly, syncUploadedFileToDriveQuietly } from "@/lib/drive-records";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { JOB_STATUSES } from "@/lib/constants";
import { createCalendarEvent } from "@/lib/google-mail";
import { checkCalendarConflict } from "@/lib/calendar";
import { persistJobDescriptionDocument } from "@/lib/job-description";
import { cleanInlineText } from "@/lib/text";
import { logActivity, describeChanges } from "@/lib/activity-log";
import { advanceOnMeeting } from "@/lib/meeting-status";
import { asDateOnly, asEastern, asInstant, readDateField } from "@/lib/local-time";
import { TENANT_ID } from "@/lib/tenant";

function assertJobStatus(value: FormDataEntryValue | null): asserts value is string {
  if (typeof value !== "string" || !JOB_STATUSES.includes(value as (typeof JOB_STATUSES)[number])) {
    throw new Error("Invalid status");
  }
}

export async function updateStatus(applicationId: string, formData: FormData) {
  const status = formData.get("status");
  assertJobStatus(status);
  const lastChecked = readDateField(formData, "lastCheckedAt");
  // Read first: the transition is the whole point of logging this, and nothing
  // else in the schema remembers what the status used to be.
  const before = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    select: { status: true },
  });
  await prisma.jobApplication.update({
    where: { id: applicationId },
    // A calendar day, not an instant. The reader names which kind it is.
    data: { status, lastCheckedAt: asDateOnly(lastChecked) ?? undefined },
  });
  if (before && before.status !== status) {
    await logActivity({
      applicationId,
      action: "status_changed",
      summary: "Status changed",
      from: before.status,
      to: status,
    });
  }
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/");
}

export async function updateApplicationDetails(applicationId: string, companyId: string, formData: FormData) {
  // Cleaned here too, so saving the edit form is the manual fix for a title
  // that reached the database with markup in it before this existed.
  const roleTitle = cleanInlineText(String(formData.get("roleTitle") ?? ""));
  if (!roleTitle) return;
  const postingLink = String(formData.get("postingLink") ?? "").trim();
  const salaryRange = cleanInlineText(String(formData.get("salaryRange") ?? ""));
  const companyName = cleanInlineText(String(formData.get("companyName") ?? ""));

  const before = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    select: { roleTitle: true, postingLink: true, salaryRange: true, company: { select: { name: true } } },
  });
  await prisma.jobApplication.update({
    where: { id: applicationId },
    data: { roleTitle, postingLink: postingLink || null, salaryRange: salaryRange || null },
  });
  if (companyName) {
    await prisma.company.update({ where: { id: companyId }, data: { name: companyName } });
  }
  const changed = before
    ? describeChanges(
        {
          roleTitle: before.roleTitle,
          postingLink: before.postingLink,
          salaryRange: before.salaryRange,
          company: before.company.name,
        },
        { roleTitle, postingLink, salaryRange, company: companyName || before.company.name }
      )
    : null;
  if (changed) {
    await logActivity({ applicationId, action: "details_edited", summary: `Edited ${changed.toLowerCase()}` });
  }
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/");
}

export async function updateNotes(applicationId: string, formData: FormData) {
  const notes = String(formData.get("notes") ?? "");
  const before = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    select: { notes: true },
  });
  await prisma.jobApplication.update({ where: { id: applicationId }, data: { notes } });
  if (before && (before.notes ?? "") !== notes) {
    await logActivity({ applicationId, action: "notes_edited", summary: "Notes edited" });
  }
  revalidatePath(`/applications/${applicationId}`);
}

export async function saveJobDescription(applicationId: string, formData: FormData) {
  const rawText = String(formData.get("rawText") ?? "").trim();
  if (!rawText) return;
  await persistJobDescriptionDocument(applicationId, rawText);
  revalidatePath(`/applications/${applicationId}`);
}

export async function addContact(applicationId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await prisma.contact.create({
    data: {
      applicationId,
      name,
      role: String(formData.get("role") ?? "") || null,
      email: String(formData.get("email") ?? "") || null,
      phone: String(formData.get("phone") ?? "") || null,
      notes: String(formData.get("notes") ?? "") || null,
    },
  });
  revalidatePath(`/applications/${applicationId}`);
}

export async function updateContact(contactId: string, applicationId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  await prisma.contact.update({
    where: { id: contactId },
    data: {
      name,
      role: String(formData.get("role") ?? "").trim() || null,
      email: String(formData.get("email") ?? "").trim() || null,
      phone: String(formData.get("phone") ?? "").trim() || null,
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });
  revalidatePath(`/applications/${applicationId}`);
}

export async function deleteContact(contactId: string, applicationId: string) {
  await prisma.contact.delete({ where: { id: contactId } });
  revalidatePath(`/applications/${applicationId}`);
}

export async function addInterviewNote(applicationId: string, formData: FormData) {
  const roundName = String(formData.get("roundName") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();
  if (!roundName || !notes) return;
  // Eastern, not the runtime's zone: a datetime-local value has no offset, and
  // reading one as UTC is how an interview lands four hours out with nothing
  // looking wrong. `asEastern` is the only reader that interprets it correctly,
  // and the value cannot reach `new Date()` to be read any other way.
  const date = asEastern(readDateField(formData, "date"));
  const interviewerIds = formData.getAll("interviewerIds").map(String).filter(Boolean);

  let calendarConflict: string | null = null;
  if (date) {
    const profile = await prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { icsCalendarUrl: true } });
    calendarConflict = await checkCalendarConflict(profile?.icsCalendarUrl, date);
  }

  const note = await prisma.interviewNote.create({
    data: {
      applicationId,
      roundName,
      notes,
      date,
      calendarConflict,
      interviewers: interviewerIds.length ? { connect: interviewerIds.map((id) => ({ id })) } : undefined,
    },
  });
  await syncInterviewNotesToDriveQuietly(applicationId);
  // Only a dated meeting says the role is at interview stage. An undated note
  // is a record of something, not a booking.
  if (date) await advanceOnMeeting(applicationId);

  // Put a dated interview on the connected Google Calendar. The write
  // capability and the scope were both already there and nothing had ever
  // called them, so an interview logged here existed only inside Counsel.
  //
  // Only when a date is given, and only when not opted out: an event on a real
  // calendar is visible to anyone he shares it with, so it is not something to
  // create from a guess.
  const addToCalendar = String(formData.get("addToCalendar") ?? "") === "on";
  if (date && addToCalendar) {
    const app = await prisma.jobApplication.findUnique({
      where: { id: applicationId },
      include: { company: true },
    });
    try {
      const event = await createCalendarEvent({
        summary: `${app?.company.name ?? "Interview"} - ${roundName}`,
        description: [app?.roleTitle, notes, app ? `Counsel: /applications/${applicationId}` : null]
          .filter(Boolean)
          .join("\n\n"),
        start: date,
        durationMinutes: 60,
      });
      await prisma.interviewNote.update({
        where: { id: note.id },
        data: { googleEventId: event.id, googleEventLink: event.htmlLink },
      });
    } catch {
      // The note is the record that matters and it is already saved. A calendar
      // failure - usually a stale token - must not lose the interview.
    }
  }

  revalidatePath(`/applications/${applicationId}`);
}

export async function addFollowUp(applicationId: string, formData: FormData) {
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return;
  await prisma.followUp.create({
    data: { applicationId, note, dueDate: asDateOnly(readDateField(formData, "dueDate")) },
  });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/");
}

// A follow-up without a due date cannot be ranked, so it falls into the
// dashboard queue's undated bucket and effectively disappears among the rest.
// This is what lets a dated commitment (reply to a recruiter by Friday) rise
// to the top on its own.
export async function setFollowUpDueDate(followUpId: string, applicationId: string, formData: FormData) {
  await prisma.followUp.update({
    where: { id: followUpId },
    data: { dueDate: asDateOnly(readDateField(formData, "dueDate")) },
  });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/");
}

export async function toggleFollowUp(followUpId: string, applicationId: string, completed: boolean) {
  const followUp = await prisma.followUp.update({ where: { id: followUpId }, data: { completed } });
  await logActivity({
    applicationId,
    action: completed ? "follow_up_completed" : "follow_up_reopened",
    summary: `${completed ? "Completed" : "Reopened"} follow-up: ${followUp.note}`,
  });
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/");
  // Follow-ups are closable from their own page now, which will not repaint
  // itself off the application's path.
  revalidatePath("/follow-ups");
}

export async function linkCalendarEvent(applicationId: string, formData: FormData) {
  const uid = String(formData.get("uid") ?? "");
  const summary = String(formData.get("summary") ?? "").trim();
  // The hidden field carries the event's own ISO instant, so this is the one
  // reader that must not reinterpret the zone.
  const eventStart = asInstant(readDateField(formData, "start"));
  if (!uid || !summary || !eventStart) return;
  await prisma.interviewNote.create({
    data: {
      applicationId,
      roundName: summary,
      // A hidden field carrying the calendar event's own ISO instant.
      date: eventStart,
      notes: "",
      calendarEventUid: uid,
    },
  });
  await syncInterviewNotesToDriveQuietly(applicationId);
  await advanceOnMeeting(applicationId);
  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/");
}

export async function dismissCalendarMatch(applicationId: string, formData: FormData) {
  const uid = String(formData.get("uid") ?? "");
  if (!uid) return;
  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    select: { dismissedCalendarEventUids: true },
  });
  const dismissed: string[] = application?.dismissedCalendarEventUids ? JSON.parse(application.dismissedCalendarEventUids) : [];
  if (!dismissed.includes(uid)) dismissed.push(uid);
  await prisma.jobApplication.update({
    where: { id: applicationId },
    data: { dismissedCalendarEventUids: JSON.stringify(dismissed) },
  });
  revalidatePath(`/applications/${applicationId}`);
}

export async function uploadFile(applicationId: string, formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return;

  const data = Buffer.from(await file.arrayBuffer());
  const uploaded = await prisma.uploadedFile.create({
    data: {
      applicationId,
      fileName: file.name || "file",
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      data,
    },
  });
  await syncUploadedFileToDriveQuietly(uploaded.id);
  revalidatePath(`/applications/${applicationId}`);
}

export async function deleteUploadedFile(fileId: string, applicationId: string) {
  await prisma.uploadedFile.delete({ where: { id: fileId } });
  revalidatePath(`/applications/${applicationId}`);
}

// Soft delete. The application and everything hanging off it stays in the
// database and can be restored from the dashboard's Recently deleted list.
// The company row is deliberately left alone: removing it here is what made an
// earlier accidental delete unrecoverable and untraceable.
export async function deleteApplication(applicationId: string, companyId: string) {
  await prisma.jobApplication.update({
    where: { id: applicationId },
    data: { deletedAt: new Date() },
  });
  await logActivity({ applicationId, action: "application_deleted", summary: "Application deleted" });

  revalidatePath("/");
  revalidatePath(`/companies/${companyId}`);
  redirect("/");
}

export async function restoreApplication(applicationId: string) {
  await prisma.jobApplication.update({
    where: { id: applicationId },
    data: { deletedAt: null },
  });
  await logActivity({ applicationId, action: "application_restored", summary: "Application restored" });
  revalidatePath("/");
  revalidatePath(`/applications/${applicationId}`);
}

/**
 * Answers to supplemental questions on an employer's application form.
 *
 * Kept against the role because the same questions recur, a portal can time out
 * and lose what was typed, and what he told one employer is worth having when
 * the next asks something similar. These are short answers with their question
 * attached, which is why they are not `Document` rows: those are the resume and
 * the cover letter, versioned and filed to Drive as files.
 */
export async function saveApplicationAnswer(applicationId: string, formData: FormData) {
  const question = cleanInlineText(String(formData.get("question") ?? ""));
  const answer = String(formData.get("answer") ?? "").trim();
  if (!question || !answer) return;

  const existingId = String(formData.get("answerId") ?? "").trim();
  if (existingId) {
    await prisma.applicationAnswer.updateMany({
      where: { id: existingId, applicationId },
      data: { question, answer },
    });
  } else {
    await prisma.applicationAnswer.create({ data: { applicationId, question, answer } });
  }

  revalidatePath(`/applications/${applicationId}`);
}

export async function deleteApplicationAnswer(applicationId: string, answerId: string) {
  await prisma.applicationAnswer.deleteMany({ where: { id: answerId, applicationId } });
  revalidatePath(`/applications/${applicationId}`);
}

/**
 * "Not yet, ask me again on the 15th."
 *
 * Deciding to wait is a real decision and it used to leave no trace: Dan and
 * Claude agreed to hold off on chasing a recruiter about an airline role, and the next
 * morning nothing on the page knew. Worse, the cadence had moved from six days
 * to seven overnight, so the decision was already stale and neither of them
 * could have known that either.
 *
 * A dated follow-up is the existing shape for "this, on this day", so a snooze
 * is one of those rather than a new column. It suppresses the nudge until the
 * date, then the role comes back on its own.
 */
export async function snoozeFollowUp(applicationId: string, formData: FormData) {
  const days = Number(formData.get("days"));
  if (!Number.isFinite(days) || days < 1 || days > 90) return;

  const note = String(formData.get("note") ?? "").trim() || "Check in on this";
  const due = new Date();
  due.setHours(9, 0, 0, 0);
  due.setDate(due.getDate() + days);

  // Pushing the date on the existing snooze rather than stacking a second one:
  // deciding twice is still one decision about when to look again.
  const existing = await prisma.followUp.findFirst({
    where: { applicationId, completed: false, dueDate: { not: null, gt: new Date() } },
    orderBy: { dueDate: "asc" },
  });

  if (existing) {
    await prisma.followUp.update({ where: { id: existing.id }, data: { dueDate: due } });
  } else {
    await prisma.followUp.create({ data: { applicationId, note, dueDate: due } });
  }

  revalidatePath(`/applications/${applicationId}`);
  revalidatePath("/");
}
