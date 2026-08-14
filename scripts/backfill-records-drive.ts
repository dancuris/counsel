/**
 * Files the records that are not Documents: evaluations, interview notes and
 * uploaded files.
 *
 * Those three are separate Prisma models, so they never went through the
 * document sync and existed only inside the app. Everything written from now
 * on files itself; this catches what came before.
 *
 * Evaluations and notes are one PDF per application holding all of them, so
 * the unit of work here is the application, not the row.
 *
 * Run: npx tsx --env-file=.env.local scripts/backfill-records-drive.ts [--apply] [--limit N]
 */
import { prisma } from "../src/lib/prisma";
import { isDriveConnected } from "../src/lib/google-drive";
import {
  syncEvaluationsToDriveQuietly,
  syncInterviewNotesToDriveQuietly,
  syncUploadedFileToDriveQuietly,
} from "../src/lib/drive-records";

const APPLY = process.argv.includes("--apply");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;

async function main() {
  if (APPLY && !(await isDriveConnected())) {
    console.error("No Drive account connected. Connect one from the Profile page first.");
    process.exit(1);
  }

  const apps = await prisma.jobApplication.findMany({
    where: { deletedAt: null },
    include: {
      company: true,
      _count: { select: { evaluations: true, interviewNotes: true } },
      uploadedFiles: { where: { driveFileId: null }, select: { id: true, fileName: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  type Job = { run: () => Promise<string | null>; label: string };
  const queue: Job[] = [];

  for (const app of apps) {
    const where = `${app.company.name} - ${app.roleTitle.slice(0, 38)}`;
    if (app._count.evaluations > 0 && !app.driveEvalFileId) {
      queue.push({ label: `${where} - ${app._count.evaluations} evaluation(s)`, run: () => syncEvaluationsToDriveQuietly(app.id) });
    }
    if (app._count.interviewNotes > 0 && !app.driveNotesFileId) {
      queue.push({ label: `${where} - ${app._count.interviewNotes} interview note(s)`, run: () => syncInterviewNotesToDriveQuietly(app.id) });
    }
    for (const f of app.uploadedFiles) {
      queue.push({ label: `${where} - upload ${f.fileName}`, run: () => syncUploadedFileToDriveQuietly(f.id) });
    }
  }

  const work = queue.slice(0, LIMIT);
  console.log(`${work.length} to file${queue.length > work.length ? ` (of ${queue.length})` : ""}\n`);

  let done = 0;
  let failed = 0;
  for (const [i, job] of work.entries()) {
    const prefix = `[${i + 1}/${work.length}] ${job.label}`;
    if (!APPLY) {
      console.log(prefix);
      continue;
    }
    // The sync helpers swallow their own errors and return null, which is right
    // for a background write and wrong for a backfill you are watching, so a
    // null is reported as a failure here rather than passing silently.
    const id = await job.run();
    if (id) {
      done += 1;
      console.log(`${prefix}\n    https://drive.google.com/file/d/${id}/view`);
    } else {
      failed += 1;
      console.log(`${prefix}\n    failed`);
    }
  }

  console.log("\n" + "=".repeat(52));
  console.log(APPLY ? `filed: ${done}  failed: ${failed}` : "dry run - re-run with --apply");
  process.exit(0);
}

main();
