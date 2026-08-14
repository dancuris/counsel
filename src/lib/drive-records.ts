import { prisma } from "@/lib/prisma";
import { renderPdf } from "@/lib/pdf-render";
import { ensureApplicationFolder, uploadToApplicationFolder, isDriveConnected } from "@/lib/google-drive";
import { APP_TIMEZONE } from "@/lib/format";
import { recordFailure } from "@/lib/failures";

/**
 * Filing for the things that are not Documents.
 *
 * Resumes, cover letters, job descriptions and interview prep are `Document`
 * rows and already sync themselves. Evaluations, interview notes and uploaded
 * files are separate models, so they only ever existed inside the app - which
 * defeats the point of having any of it in Drive, since a fit assessment and
 * the notes from round one are exactly what gets reread in a taxi.
 *
 * Correspondence is deliberately excluded: sent mail is already in Gmail, and
 * copying drafts into Drive is clutter that then has to be kept in sync.
 *
 * Two choices worth keeping:
 *
 * - **One file per application per kind, rewritten in place**, holding every
 *   evaluation or every round. A file per row would bury the company folder,
 *   and the id lives on JobApplication rather than the individual row so there
 *   is exactly one thing to update.
 * - **PDF only.** These are read before a call, not edited in Word. The app
 *   stays the record; Drive is a copy, same as everywhere else here.
 */

function asList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return raw.trim() ? [raw] : [];
  }
}

const DATE = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIMEZONE,
  dateStyle: "medium",
});

/** Every evaluation for an application, newest first, as one readable document. */
export async function buildEvaluationsText(applicationId: string): Promise<string | null> {
  const app = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { company: true, evaluations: { orderBy: { generatedAt: "desc" } } },
  });
  if (!app || app.evaluations.length === 0) return null;

  const out: string[] = [`# Evaluations`, `## ${app.company.name} - ${app.roleTitle}`, ""];

  for (const e of app.evaluations) {
    out.push(`### ${e.recommendation.toUpperCase()} - ${e.model}`);
    out.push(DATE.format(e.generatedAt));
    out.push("");
    out.push(e.fitSummary);
    out.push("");

    const strengths = asList(e.strengths);
    if (strengths.length) {
      out.push("**Strengths**");
      for (const s of strengths) out.push(`- ${s}`);
      out.push("");
    }

    const gaps = asList(e.gaps);
    if (gaps.length) {
      out.push("**Gaps**");
      for (const g of gaps) out.push(`- ${g}`);
      out.push("");
    }
  }

  return out.join("\n");
}

/** Every interview round for an application, newest first. */
export async function buildInterviewNotesText(applicationId: string): Promise<string | null> {
  const app = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: {
      company: true,
      interviewNotes: { orderBy: [{ date: "desc" }, { createdAt: "desc" }], include: { interviewers: true } },
    },
  });
  if (!app || app.interviewNotes.length === 0) return null;

  const out: string[] = [`# Interview notes`, `## ${app.company.name} - ${app.roleTitle}`, ""];

  for (const n of app.interviewNotes) {
    out.push(`### ${n.roundName}`);
    if (n.date) out.push(DATE.format(n.date));
    if (n.interviewers.length) {
      out.push(`With: ${n.interviewers.map((c) => [c.name, c.role].filter(Boolean).join(", ")).join("; ")}`);
    }
    out.push("");
    if (n.notes.trim()) {
      out.push(n.notes.trim());
      out.push("");
    }
  }

  return out.join("\n");
}

type Kind = "evaluations" | "notes";

async function syncRecord(applicationId: string, kind: Kind): Promise<string | null> {
  const app = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { company: true },
  });
  if (!app) return null;

  const text =
    kind === "evaluations" ? await buildEvaluationsText(applicationId) : await buildInterviewNotesText(applicationId);
  // Nothing recorded yet is not a failure, it is just nothing to file.
  if (!text) return null;

  const slug = app.company.name.replace(/[^a-zA-Z0-9]+/g, "");
  const label = kind === "evaluations" ? "Evaluations" : "InterviewNotes";
  const existing = kind === "evaluations" ? app.driveEvalFileId : app.driveNotesFileId;

  const fileId = await uploadToApplicationFolder({
    applicationId,
    name: `Dan_Curis_${label}_${slug}.pdf`,
    mimeType: "application/pdf",
    data: await renderPdf(text, false),
    existingFileId: existing,
  });

  await prisma.jobApplication.update({
    where: { id: applicationId },
    data: kind === "evaluations" ? { driveEvalFileId: fileId } : { driveNotesFileId: fileId },
  });

  return fileId;
}

/**
 * Never throws, for the same reason the document sync does not: an evaluation
 * that ran correctly must not be reported as failed because an upload timed
 * out. The row is committed before this runs.
 */
export async function syncEvaluationsToDriveQuietly(applicationId: string): Promise<string | null> {
  try {
    if (!(await isDriveConnected())) return null;
    return await syncRecord(applicationId, "evaluations");
  } catch (error) {
    await recordFailure("syncEvaluationsToDriveQuietly", error);
    return null;
  }
}

export async function syncInterviewNotesToDriveQuietly(applicationId: string): Promise<string | null> {
  try {
    if (!(await isDriveConnected())) return null;
    return await syncRecord(applicationId, "notes");
  } catch (error) {
    await recordFailure("syncInterviewNotesToDriveQuietly", error);
    return null;
  }
}

/** Uploaded files are already files; they go up verbatim, keeping their type. */
export async function syncUploadedFileToDriveQuietly(uploadedFileId: string): Promise<string | null> {
  try {
    if (!(await isDriveConnected())) return null;
    const file = await prisma.uploadedFile.findUnique({ where: { id: uploadedFileId } });
    if (!file) return null;

    const fileId = await uploadToApplicationFolder({
      applicationId: file.applicationId,
      name: file.fileName,
      mimeType: file.mimeType || "application/octet-stream",
      data: Buffer.from(file.data),
      existingFileId: file.driveFileId,
    });

    await prisma.uploadedFile.update({ where: { id: uploadedFileId }, data: { driveFileId: fileId } });
    return fileId;
  } catch (error) {
    await recordFailure("syncUploadedFileToDriveQuietly", error);
    return null;
  }
}

export { ensureApplicationFolder };
