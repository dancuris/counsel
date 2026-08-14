import { prisma } from "@/lib/prisma";
import { syncDocumentToDriveQuietly } from "@/lib/google-drive";

// Keeps a persisted docx/pdf copy of the JD alongside the resume/cover
// letter in Documents, so pasted postings are archived, not just stored
// as text. Shared by the manual "paste JD" action and the quick-add flow.
export async function persistJobDescriptionDocument(applicationId: string, rawText: string) {
  await prisma.jobDescription.create({ data: { applicationId, rawText } });

  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { company: true },
  });
  const content = application
    ? `## ${application.company.name} - ${application.roleTitle}\n\n${rawText}`
    : rawText;

  const existingDoc = await prisma.document.findFirst({
    where: { applicationId, type: "job_description" },
  });
  // This is the one document type that overwrites rather than versions, so the
  // same Drive file is updated in place on a re-paste.
  const doc = existingDoc
    ? await prisma.document.update({
        where: { id: existingDoc.id },
        data: { content, generatedAt: new Date() },
      })
    : await prisma.document.create({
        data: { applicationId, type: "job_description", content, isAtsSafe: true },
      });

  await syncDocumentToDriveQuietly(doc.id);
}
