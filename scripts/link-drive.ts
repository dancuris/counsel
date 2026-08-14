/**
 * Reconciles the tracked pipeline against the Drive folder tree the job search
 * already lives in, so every application links out to its real folder and every
 * document points at the file that was actually sent.
 *
 * The tree predates this app: a folder per employer under Jobs, sometimes a
 * role folder inside that, and files under Word/ and PDF/ subfolders in three
 * different naming conventions. Nothing here creates or moves anything - it
 * only records ids that already exist.
 *
 * Matching is conservative on purpose. Employer names are matched after
 * normalising case and punctuation, which bridges "WarnerBrosDiscovery" and
 * "Warner Bros. Discovery"; abbreviations it cannot reach are reported with
 * near misses rather than guessed at, because filing a Chase resume under JP
 * Morgan is worse than filing nothing.
 *
 * ORDER MATTERS: run this before scripts/backfill-drive.ts. This one adopts the
 * files that already exist; the backfill uploads fresh copies for whatever is
 * still unlinked. The other way round leaves duplicates.
 *
 * Run: npx tsx --env-file=.env.local scripts/link-drive.ts [--apply] [--company NAME]
 */
import { prisma } from "../src/lib/prisma";
import { getAccessToken } from "../src/lib/google-mail";
import { isDriveConnected, driveFileUrl } from "../src/lib/google-drive";
import {
  matchCompanies,
  assignFilesToApplications,
  classifyDocumentType,
  formatOf,
  normalizeName,
  pickBestFile,
  type DriveFileRef,
} from "../src/lib/drive-match";
import { DOCUMENT_FILENAME_LABELS, type DocumentType } from "../src/lib/constants";

const APPLY = process.argv.includes("--apply");
const companyArg = process.argv.indexOf("--company");
const ONLY_COMPANY = companyArg !== -1 ? process.argv[companyArg + 1] : null;

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

type Entry = { id: string; name: string; mimeType: string; modifiedTime?: string };

async function list(parentId: string): Promise<Entry[]> {
  const { token } = await getAccessToken("drive");
  const q = `'${parentId.replace(/'/g, "\\'")}' in parents and trashed = false`;
  const out: Entry[] = [];
  let pageToken: string | undefined;
  do {
    const url =
      `${DRIVE_API}/files?q=${encodeURIComponent(q)}` +
      `&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=200` +
      (pageToken ? `&pageToken=${pageToken}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Drive list failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { files?: Entry[]; nextPageToken?: string };
    out.push(...(body.files ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Every file under a company folder, at any depth. The tree is not uniform -
 * Word/, PDF/, files/, and per-role folders all appear - so the walk collects
 * everything and the filenames decide what each one is. Subfolders are returned
 * too, since a role folder is itself something to link.
 */
async function walk(
  folderId: string,
  depth = 0
): Promise<{ files: (Entry & { path: string })[]; folders: (Entry & { path: string })[] }> {
  const files: (Entry & { path: string })[] = [];
  const folders: (Entry & { path: string })[] = [];
  if (depth > 3) return { files, folders };

  for (const entry of await list(folderId)) {
    if (entry.mimeType === FOLDER_MIME) {
      folders.push({ ...entry, path: entry.name });
      const nested = await walk(entry.id, depth + 1);
      files.push(...nested.files.map((f) => ({ ...f, path: `${entry.name}/${f.path}` })));
      folders.push(...nested.folders.map((f) => ({ ...f, path: `${entry.name}/${f.path}` })));
    } else {
      files.push({ ...entry, path: entry.name });
    }
  }
  return { files, folders };
}

async function main() {
  if (!(await isDriveConnected())) {
    console.error("The connected mailbox has no Drive scope. Reconnect it from the Profile page first.");
    process.exit(1);
  }

  const profile = await prisma.profile.findUnique({
    where: { id: "singleton" },
    select: { driveRootFolderId: true },
  });
  if (!profile?.driveRootFolderId) {
    console.error("Set the Google Drive folder ID on the Profile page first - that is the folder this reads.");
    process.exit(1);
  }

  const rootChildren = await list(profile.driveRootFolderId);
  const driveFolders = rootChildren
    .filter((e) => e.mimeType === FOLDER_MIME)
    .map((e) => ({ id: e.id, name: e.name }));
  console.log(`${driveFolders.length} folders under the Drive root\n`);

  const companies = await prisma.company.findMany({
    where: { applications: { some: { deletedAt: null } } },
    select: { id: true, name: true, driveFolderName: true },
    orderBy: { name: "asc" },
  });

  const { matches, ambiguous, unmatched } = matchCompanies(companies, driveFolders);
  const work = ONLY_COMPANY
    ? matches.filter((m) => normalizeName(m.companyName) === normalizeName(ONLY_COMPANY))
    : matches;

  const tally = { companyFolders: 0, roleFolders: 0, documents: 0, skipped: 0 };
  // Files this refused to attribute, surfaced at the end rather than scrolling past.
  const needsDecision: string[] = [];

  for (const match of work) {
    console.log(`${match.companyName}  ->  Drive "${match.folderName}"${match.via === "alias" ? " (alias)" : ""}`);
    if (APPLY) {
      await prisma.company.update({
        where: { id: match.companyId },
        // Storing the folder's exact title means the live app's own lookup, which
        // matches on name, finds this folder from now on instead of making a new one.
        data: { driveFolderId: match.folderId, driveFolderName: match.folderName },
      });
    }
    tally.companyFolders += 1;

    const { files, folders } = await walk(match.folderId);
    const applications = await prisma.jobApplication.findMany({
      where: { companyId: match.companyId, deletedAt: null },
      include: { documents: { orderBy: { generatedAt: "desc" } } },
      orderBy: { updatedAt: "desc" },
    });

    // Ownership is decided for the whole company at once, so a file can never
    // be handed to two roles. Every application has its own tailored resume and
    // cover letter; sharing a Drive file between two of them would have the
    // next refine on one overwrite the other.
    const { assignments, unassigned } = assignFilesToApplications(
      applications.map((a) => ({ id: a.id, roleTitle: a.roleTitle })),
      folders,
      files
    );
    for (const skipped of unassigned) {
      needsDecision.push(`${match.companyName}: "${skipped.file.path}" not linked - ${skipped.reason}`);
    }

    for (const app of applications) {
      const assignment = assignments.find((a) => a.applicationId === app.id);
      const applicationFolderId = assignment?.roleFolderId ?? match.folderId;
      const label = `    ${app.roleTitle.slice(0, 52)}`;
      console.log(
        `${label}\n        folder: ${assignment?.roleFolderId ? "role folder" : "(company folder)"}` +
          `, ${assignment?.files.length ?? 0} candidate files`
      );
      if (APPLY) {
        await prisma.jobApplication.update({
          where: { id: app.id },
          data: { driveFolderId: applicationFolderId },
        });
      }
      if (assignment?.roleFolderId) tally.roleFolders += 1;

      const scoped = assignment?.files ?? [];

      // Newest row per type is the current one; history stays local.
      const currentByType = new Map<string, (typeof app.documents)[number]>();
      for (const doc of app.documents) if (!currentByType.has(doc.type)) currentByType.set(doc.type, doc);

      for (const [type, doc] of currentByType) {
        if (doc.driveFileIdDocx && doc.driveFileIdPdf) {
          tally.skipped += 1;
          continue;
        }
        const typeLabel = DOCUMENT_FILENAME_LABELS[type as DocumentType] ?? "Document";
        const companySlug = match.companyName.replace(/[^a-zA-Z0-9]+/g, "");

        const chosen: Partial<Record<"docx" | "pdf", DriveFileRef>> = {};
        for (const format of ["docx", "pdf"] as const) {
          const all = scoped.filter(
            (f) => classifyDocumentType(f.name) === type && formatOf(f.name, f.mimeType) === format
          );
          // A file filed under the role beats one loose in the company folder,
          // per type and format, so a leftover resume at company level cannot
          // outrank the one actually tailored for this role.
          const preferred = all.filter((f) => f.fromRoleFolder);
          const candidates = preferred.length > 0 ? preferred : all;
          const best = pickBestFile(candidates, `Dan_Curis_${typeLabel}_${companySlug}.${format}`);
          if (best) chosen[format] = best;
        }
        if (!chosen.docx && !chosen.pdf) continue;

        const data: { driveFileIdDocx?: string; driveFileIdPdf?: string } = {};
        if (chosen.docx && !doc.driveFileIdDocx) data.driveFileIdDocx = chosen.docx.id;
        if (chosen.pdf && !doc.driveFileIdPdf) data.driveFileIdPdf = chosen.pdf.id;
        if (Object.keys(data).length === 0) continue;

        console.log(
          `        ${type}: ${[chosen.docx?.name, chosen.pdf?.name].filter(Boolean).join(" + ")}` +
            (APPLY ? `\n            ${driveFileUrl(data.driveFileIdDocx ?? data.driveFileIdPdf!)}` : "")
        );
        if (APPLY) await prisma.document.update({ where: { id: doc.id }, data });
        tally.documents += 1;
      }
    }
    console.log("");
  }

  if (unmatched.length) {
    console.log("=".repeat(60));
    console.log("No Drive folder found. Near misses are suggestions only - confirm one,");
    console.log("then either rename the folder or add it to COMPANY_ALIASES in");
    console.log("src/lib/drive-match.ts and re-run:\n");
    for (const u of unmatched) {
      console.log(`  ${u.companyName}${u.suggestions.length ? `\n      near: ${u.suggestions.join(", ")}` : ""}`);
    }
  }

  if (ambiguous.length) {
    console.log("\n" + "=".repeat(60));
    console.log("Ambiguous, nothing written for these:\n");
    for (const a of ambiguous) console.log(`  ${a}`);
  }

  if (needsDecision.length) {
    console.log("\n" + "=".repeat(60));
    console.log("Files left unlinked because their role was not clear. Move each one");
    console.log("into the right role's folder and re-run, or link it by hand:\n");
    for (const n of needsDecision) console.log(`  ${n}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`companies linked to a folder : ${tally.companyFolders}`);
  console.log(`applications in a role folder: ${tally.roleFolders}`);
  console.log(`documents linked to a file   : ${tally.documents}`);
  console.log(`documents already linked     : ${tally.skipped}`);
  console.log(`companies needing a decision : ${unmatched.length + ambiguous.length}`);
  console.log(`files needing a decision     : ${needsDecision.length}`);
  if (!APPLY) {
    console.log("\ndry run - nothing written. Re-run with --apply.");
  } else if (tally.documents > 0) {
    console.log("\nLinked documents are now maintained by Counsel: the next edit or refine");
    console.log("updates that Drive file in place. Drive keeps the current content in the");
    console.log("file's revision history.");
  }
  process.exit(0);
}

main();
