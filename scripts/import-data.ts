// Imports the export produced by scripts/export-data.ts into whatever
// database DATABASE_URL currently points at (run this after switching
// schema.prisma to postgresql and running the fresh init migration).
// IDs are preserved as-is (cuids are already globally unique) so every
// foreign key reference in the export stays valid without remapping.
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { readFileSync } from "fs";

async function main() {
  const inPath = process.argv[2];
  if (!inPath) {
    console.error("Usage: tsx scripts/import-data.ts <input-path>");
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(inPath, "utf-8"));

  await prisma.profile.createMany({ data: data.profiles });
  await prisma.company.createMany({ data: data.companies });
  await prisma.jobApplication.createMany({ data: data.applications });
  await prisma.jobDescription.createMany({ data: data.jobDescriptions });
  await prisma.evaluation.createMany({ data: data.evaluations });
  await prisma.document.createMany({ data: data.documents });
  await prisma.contact.createMany({ data: data.contacts });
  await prisma.followUp.createMany({ data: data.followUps });
  await prisma.warmThread.createMany({ data: data.warmThreads });
  await prisma.correspondence.createMany({ data: data.correspondence });

  for (const note of data.interviewNotes) {
    const { interviewers, ...fields } = note;
    await prisma.interviewNote.create({
      data: {
        ...fields,
        interviewers: interviewers?.length ? { connect: interviewers.map((c: { id: string }) => ({ id: c.id })) } : undefined,
      },
    });
  }

  console.log("Imported:");
  console.log(`  profiles: ${data.profiles.length}`);
  console.log(`  companies: ${data.companies.length}`);
  console.log(`  applications: ${data.applications.length}`);
  console.log(`  jobDescriptions: ${data.jobDescriptions.length}`);
  console.log(`  evaluations: ${data.evaluations.length}`);
  console.log(`  documents: ${data.documents.length}`);
  console.log(`  contacts: ${data.contacts.length}`);
  console.log(`  interviewNotes: ${data.interviewNotes.length}`);
  console.log(`  followUps: ${data.followUps.length}`);
  console.log(`  warmThreads: ${data.warmThreads.length}`);
  console.log(`  correspondence: ${data.correspondence.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
