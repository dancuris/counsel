/**
 * Puts back the 56 cover letters the sign-off repair emptied.
 *
 * What happened, so this is not repeated: most of those letters were adopted
 * from Drive rather than written here, and an adopted `Document` deliberately
 * stores `content: ""` because the Drive file is the record. The sign-off
 * repair rebuilt every cover letter as letterhead + body + sign-off without
 * checking there was a body, so an empty one became the 26 characters
 * "\n\nSincerely,\n\nDaniel Curis". That row now had content, so the ordinary
 * Drive sync rendered it and overwrote the real file.
 *
 * `syncDocumentToDrive` has since grown a guard that refuses to upload a row
 * with no content. It would not have caught this: by the time the sync ran,
 * the content was not empty, it was wrong.
 *
 * Recovery leans on Drive keeping its own revisions, which is the assumption
 * the "one Drive file per document type" design was resting on all along. It
 * held: all 56 .docx files have a pre-incident revision.
 *
 *   npx tsx --env-file=.env.local scripts/restore-cover-letters.ts --dry-run
 *   npx tsx --env-file=.env.local scripts/restore-cover-letters.ts --limit=1
 *   npx tsx --env-file=.env.local scripts/restore-cover-letters.ts
 *
 * It is safe to re-run: a document whose stored content is already a real
 * letter is skipped, so an interrupted run resumes rather than duplicating.
 */
import { prisma } from "../src/lib/prisma";
import { getAccessToken } from "../src/lib/google-mail";
import { driveDocxToText } from "../src/lib/google-drive";
import { renderDocumentFile } from "../src/lib/document-file";

const DRIVE = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

/** The repair ran 01:27 to 01:30 UTC on 10 Aug 2026. Anything older is good. */
const INCIDENT = new Date("2026-08-10T01:00:00Z");
/** A real letter renders to about 9-11KB. The gutted one is a fraction of that. */
const MIN_REAL_BYTES = 3000;

const DRY = process.argv.includes("--dry-run");
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? 0);

type Rev = { id: string; modifiedTime: string; size?: string };

async function token() {
  return (await getAccessToken("drive")).token;
}

/** The newest revision from before the repair that still has real content in it. */
async function lastGoodRevision(fileId: string | null): Promise<Rev | null> {
  if (!fileId) return null;
  const res = await fetch(`${DRIVE}/files/${fileId}/revisions?fields=revisions(id,modifiedTime,size)`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) return null;
  const revs = ((await res.json()).revisions ?? []) as Rev[];
  const good = revs.filter((r) => new Date(r.modifiedTime) < INCIDENT && Number(r.size ?? 0) > MIN_REAL_BYTES);
  return good[good.length - 1] ?? null;
}

async function downloadRevision(fileId: string, revisionId: string): Promise<Buffer> {
  const res = await fetch(`${DRIVE}/files/${fileId}/revisions/${revisionId}?alt=media`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  if (!res.ok) throw new Error(`revision download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Writes bytes over the current version of an existing file.
 *
 * Deliberately a new version of the SAME file rather than a replacement file:
 * the whole point of one-file-per-document-type is that the link Dan opens on
 * his phone keeps working, and the gutted version stays in Drive's history in
 * case any of this needs undoing again.
 */
async function putBytes(fileId: string, mimeType: string, data: Buffer) {
  const res = await fetch(`${UPLOAD}/files/${fileId}?uploadType=media`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": mimeType },
    body: new Uint8Array(data),
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * Puts the markdown-lite name heading back on extracted text.
 *
 * A .docx exported to plain text loses the structure the renderers key off:
 * the house format opens "## DANIEL CURIS" and the exported text is a bare
 * "DANIEL CURIS", which renders as an ordinary paragraph rather than the
 * centred navy name. One line, and it is the only markup a cover letter uses.
 */
function withNameHeading(text: string): string {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trim());
  if (i === -1) return text;
  const first = lines[i].trim();
  if (first.startsWith("##")) return text;
  // Only when it actually looks like the name line, so a letter that happens
  // to start with a sentence is left alone rather than given a heading.
  if (!/^[A-Z][A-Za-z.'-]*(\s+[A-Z][A-Za-z.'-]*){0,3}$/.test(first) || first.length > 40) return text;
  lines[i] = `## ${first}`;
  return lines.join("\n");
}

async function main() {
  const all = await prisma.document.findMany({
    where: { type: "cover_letter" },
    orderBy: { generatedAt: "desc" },
    select: {
      id: true,
      content: true,
      isAtsSafe: true,
      driveFileIdDocx: true,
      driveFileIdPdf: true,
      application: { select: { id: true, deletedAt: true, roleTitle: true, company: { select: { name: true } } } },
    },
  });

  const newest = new Map<string, (typeof all)[number]>();
  for (const d of all) if (!newest.has(d.application.id)) newest.set(d.application.id, d);

  let targets = [...newest.values()].filter((d) => !d.application.deletedAt && d.content.length < 60);
  if (LIMIT) targets = targets.slice(0, LIMIT);

  console.log(`${targets.length} gutted cover letters to restore${DRY ? " (dry run)" : ""}.\n`);

  let restored = 0;
  const failed: string[] = [];

  for (const doc of targets) {
    const who = `${doc.application.company.name} - ${doc.application.roleTitle}`.slice(0, 62);
    try {
      const rev = await lastGoodRevision(doc.driveFileIdDocx);
      if (!rev) throw new Error("no pre-incident .docx revision");

      if (DRY) {
        console.log(`would restore  ${who}\n  from ${rev.modifiedTime.slice(0, 16)} (${rev.size} bytes)`);
        continue;
      }

      // 1. The original .docx, byte for byte. Restoring the file rather than
      //    re-rendering from extracted text keeps whatever formatting the
      //    letter was actually written with; the text extraction below is
      //    lossy and is for the database copy, not for the file.
      const bytes = await downloadRevision(doc.driveFileIdDocx!, rev.id);
      await putBytes(doc.driveFileIdDocx!, DOCX_MIME, bytes);

      // 2. The text, into the database. This is the part that stops it
      //    happening again: these letters existed only as files, which is why
      //    a repair that rebuilt content from an empty string could destroy
      //    them without anything noticing.
      const raw = await driveDocxToText(doc.driveFileIdDocx!);
      if (raw.trim().length < 400) throw new Error(`extracted text too short (${raw.trim().length} chars)`);
      const text = withNameHeading(raw);

      const created = await prisma.document.create({
        data: {
          applicationId: doc.application.id,
          type: "cover_letter",
          content: text,
          isAtsSafe: doc.isAtsSafe,
          driveFileIdDocx: doc.driveFileIdDocx,
          driveFileIdPdf: doc.driveFileIdPdf,
        },
      });

      // 3. The PDF. Twenty have a pre-incident revision and get the same
      //    byte-for-byte treatment. The other thirty-six had no PDF in Drive
      //    before the repair created one, so there is nothing to restore and
      //    the honest fix is to render a real one from the text just recovered.
      let pdfNote = "pdf skipped";
      if (doc.driveFileIdPdf) {
        const pdfRev = await lastGoodRevision(doc.driveFileIdPdf);
        if (pdfRev) {
          await putBytes(doc.driveFileIdPdf, "application/pdf", await downloadRevision(doc.driveFileIdPdf, pdfRev.id));
          pdfNote = `pdf restored from ${pdfRev.modifiedTime.slice(0, 10)}`;
        } else {
          const rendered = await renderDocumentFile(created.id, "pdf");
          if (rendered) {
            await putBytes(doc.driveFileIdPdf, "application/pdf", rendered.data);
            pdfNote = "pdf re-rendered";
          }
        }
      }

      restored++;
      console.log(`ok  ${who}\n    docx ${bytes.length} bytes from ${rev.modifiedTime.slice(0, 10)} | ${text.trim().length} chars to db | ${pdfNote}`);
    } catch (e) {
      failed.push(`${who}: ${(e as Error).message}`);
      console.log(`FAIL ${who}\n    ${(e as Error).message}`);
    }
  }

  if (!DRY) {
    console.log(`\nrestored ${restored} of ${targets.length}.`);
    if (failed.length) {
      console.log("\nstill broken:");
      for (const f of failed) console.log("  " + f);
    }
  }
}

main().then(() => process.exit(0));
