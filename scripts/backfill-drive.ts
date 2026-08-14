/**
 * Files every current document that is not already in Drive.
 *
 * Automatic saving only covers documents written after it existed, and the
 * point of having them in Drive is applying from a phone using what is already
 * in the pipeline. Only the newest version of each type per application is
 * uploaded: history stays local, since one Drive file per document type always
 * holds the current version.
 *
 * Deleted applications are skipped. Dry by default.
 *
 * Run: npx tsx --env-file=.env.local scripts/backfill-drive.ts [--apply] [--limit N]
 */
import { prisma } from "../src/lib/prisma";
import { isDriveConnected, syncDocumentToDrive } from "../src/lib/google-drive";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;

async function main() {
  if (APPLY && !(await isDriveConnected())) {
    console.error("The connected mailbox has no Drive scope. Reconnect it from the Profile page first.");
    process.exit(1);
  }

  const applications = await prisma.jobApplication.findMany({
    where: { deletedAt: null },
    include: {
      company: true,
      documents: { orderBy: { generatedAt: "desc" } },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Newest row per type is the current one; everything behind it is history.
  const queue: { id: string; label: string }[] = [];
  for (const app of applications) {
    const seen = new Set<string>();
    for (const doc of app.documents) {
      if (seen.has(doc.type)) continue;
      seen.add(doc.type);
      if (doc.driveFileIdDocx && doc.driveFileIdPdf) continue;
      // Documents adopted from Drive hold no local content - the Drive file is
      // the record. The skip above misses them whenever they have a docx but
      // no pdf, which is most of them, and rendering empty content would
      // upload a blank file over the real one.
      if (!doc.content.trim()) continue;
      queue.push({ id: doc.id, label: `${app.company.name} - ${app.roleTitle.slice(0, 40)} - ${doc.type}` });
    }
  }

  const work = queue.slice(0, LIMIT);
  console.log(`${work.length} documents to upload${queue.length > work.length ? ` (of ${queue.length})` : ""}\n`);

  let uploaded = 0;
  let failed = 0;
  for (const [i, item] of work.entries()) {
    const prefix = `[${i + 1}/${work.length}] ${item.label}`;
    if (!APPLY) {
      console.log(prefix);
      continue;
    }
    try {
      const links = await syncDocumentToDrive(item.id);
      uploaded += 1;
      console.log(`${prefix}\n    ${links.docx}`);
    } catch (e) {
      failed += 1;
      console.log(`${prefix}\n    failed: ${(e as Error).message}`);
    }
  }

  console.log("\n" + "=".repeat(52));
  console.log(APPLY ? `uploaded: ${uploaded}  failed: ${failed}` : "dry run - re-run with --apply to upload");
  process.exit(0);
}

main();
