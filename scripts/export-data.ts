// One-time export of local SQLite data ahead of the Postgres migration.
// Writes everything to the session scratchpad, not the repo - this is real
// personal data and should never be committed.
import { prisma } from "../src/lib/prisma";
import { writeFileSync } from "fs";

async function main() {
  const data = {
    profiles: await prisma.profile.findMany(),
    companies: await prisma.company.findMany(),
    applications: await prisma.jobApplication.findMany(),
    jobDescriptions: await prisma.jobDescription.findMany(),
    evaluations: await prisma.evaluation.findMany(),
    documents: await prisma.document.findMany(),
    contacts: await prisma.contact.findMany(),
    interviewNotes: await prisma.interviewNote.findMany({ include: { interviewers: { select: { id: true } } } }),
    followUps: await prisma.followUp.findMany(),
    warmThreads: await prisma.warmThread.findMany(),
    correspondence: await prisma.correspondence.findMany(),
  };

  const outPath = process.argv[2];
  if (!outPath) {
    console.error("Usage: tsx scripts/export-data.ts <output-path>");
    process.exit(1);
  }
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`Exported to ${outPath}:`);
  for (const [key, rows] of Object.entries(data)) {
    console.log(`  ${key}: ${rows.length}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
