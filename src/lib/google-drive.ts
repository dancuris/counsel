import { prisma } from "@/lib/prisma";
import { getAccessToken } from "@/lib/google-mail";
import { DRIVE_CONNECTION_ID } from "@/lib/google-connections";
import { renderDocumentFile } from "@/lib/document-file";
import { driveFileUrl, hasDriveScope } from "@/lib/drive-links";
import { refuseInDemo } from "@/lib/demo";
import { TENANT_ID } from "@/lib/tenant";

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";

// Created at the Drive root the first time something is saved, unless a folder
// id is set on the profile - see ensureRootFolder.
const DEFAULT_ROOT_FOLDER_NAME = "Counsel";

export { driveFileUrl, driveFolderUrl, hasDriveScope, DRIVE_SCOPE } from "@/lib/drive-links";

/**
 * Whether the Drive account is connected and authorised. Adding the
 * scope does not retroactively grant it: a connection made before this existed
 * has a token that Drive will reject, and the fix is to reconnect. Checked
 * before doing any work so an unauthorised save costs one indexed read rather
 * than two document renders and a failed upload.
 */
export async function isDriveConnected(): Promise<boolean> {
  const conn = await prisma.googleConnection.findUnique({
    where: { id: DRIVE_CONNECTION_ID },
    select: { scopes: true },
  });
  return hasDriveScope(conn?.scopes);
}

async function driveFetch<T>(url: string, init: RequestInit & { body?: BodyInit }): Promise<T> {
  // CLAUDE.md: everything Drive goes through driveFetch, and there is
  // deliberately only one place the token is acquired. That makes this the
  // single guard for the whole integration.
  refuseInDemo("writing to Google Drive");
  const { token } = await getAccessToken("drive");
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "The Google Drive account is connected without Drive permission. Reconnect it from the Profile page."
      );
    }
    throw new Error(`Google Drive ${init.method ?? "GET"} failed: ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

// Drive's query language takes a single-quoted string; a company called
// O'Reilly would otherwise terminate the literal early and produce a syntax
// error rather than a miss.
function quote(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

type DriveFile = { id: string; name?: string; webViewLink?: string };

async function findOrCreateFolder(name: string, parentId: string): Promise<string> {
  const q = [
    `name = ${quote(name)}`,
    `mimeType = '${FOLDER_MIME}'`,
    `${quote(parentId)} in parents`,
    "trashed = false",
  ].join(" and ");

  const found = await driveFetch<{ files: DriveFile[] }>(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`,
    { method: "GET" }
  );
  if (found.files?.[0]?.id) return found.files[0].id;

  const created = await driveFetch<DriveFile>(`${DRIVE_API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
  });
  return created.id;
}

/**
 * The folder everything else is nested under.
 *
 * Set on the profile, this is the existing `Jobs` folder, so everything below
 * lands beside the company folders already there rather than in a tree of its
 * own. It is also the boundary: the Drive grant is account-wide, but nothing
 * here looks outside this folder.
 *
 * Unset, a folder is created at the Drive root and its id written back, so the
 * lookup happens once rather than on every save.
 */
async function ensureRootFolder(): Promise<string> {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: { driveRootFolderId: true },
  });
  if (profile?.driveRootFolderId) return profile.driveRootFolderId;

  const id = await findOrCreateFolder(DEFAULT_ROOT_FOLDER_NAME, "root");
  // Caching the id is an optimisation, not the point of the call, so a missing
  // Profile row makes this a lookup every time rather than an error. The folder
  // is found rather than duplicated on the next pass: this app created it, so
  // it is one of the few it is allowed to see.
  if (profile) {
    await prisma.profile.update({ where: { id: TENANT_ID }, data: { driveRootFolderId: id } });
  }
  return id;
}

/**
 * root / <company> / <role> - one folder per application, because the app
 * deliberately supports several roles at the same employer and the filenames
 * carry only the company, so two roles at Chase would otherwise overwrite each
 * other's resume. Both folder ids are cached on their rows.
 */
export async function ensureApplicationFolder(applicationId: string): Promise<string> {
  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { company: true },
  });
  if (!application) throw new Error("Application not found.");
  if (application.driveFolderId) return application.driveFolderId;

  const rootId = await ensureRootFolder();

  let companyFolderId = application.company.driveFolderId;
  if (!companyFolderId) {
    const companyFolderName = application.company.driveFolderName?.trim() || application.company.name;
    companyFolderId = await findOrCreateFolder(companyFolderName, rootId);
    await prisma.company.update({
      where: { id: application.company.id },
      data: { driveFolderId: companyFolderId },
    });
  }

  const folderId = await findOrCreateFolder(application.roleTitle, companyFolderId);
  await prisma.jobApplication.update({ where: { id: applicationId }, data: { driveFolderId: folderId } });
  return folderId;
}

// multipart/related: JSON metadata part, then the file bytes. Assembled as
// Buffers rather than a template string because the docx and pdf payloads are
// binary and would be corrupted by a utf-8 round trip. Exported for the same
// reason buildRawMessage is: the assembly can then be checked byte for byte
// without uploading anything.
export function multipartBody(
  boundary: string,
  metadata: Record<string, unknown>,
  mimeType: string,
  data: Buffer
): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
        metadata
      )}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      "utf8"
    ),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
}

async function uploadFile(opts: {
  name: string;
  mimeType: string;
  data: Buffer;
  folderId: string;
  existingFileId?: string | null;
}): Promise<string> {
  const boundary = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  // `parents` is only valid on create; on update the file stays where it is and
  // Drive keeps its own revision history, which is the point of updating in
  // place rather than uploading a second copy.
  const metadata = opts.existingFileId
    ? { name: opts.name }
    : { name: opts.name, parents: [opts.folderId] };

  const url = opts.existingFileId
    ? `${DRIVE_UPLOAD_API}/files/${opts.existingFileId}?uploadType=multipart&fields=id`
    : `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`;

  try {
    const file = await driveFetch<DriveFile>(url, {
      method: opts.existingFileId ? "PATCH" : "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body: new Uint8Array(multipartBody(boundary, metadata, opts.mimeType, opts.data)),
    });
    return file.id;
  } catch (e) {
    // A stored id can go stale: the file may have been deleted or emptied out
    // of the trash by hand. Falling back to a fresh create keeps the save
    // working; only the link changes, and it changes because the old one was
    // already dead.
    if (opts.existingFileId && /: 40[34] /.test((e as Error).message)) {
      return uploadFile({ ...opts, existingFileId: null });
    }
    throw e;
  }
}

export type DriveLinks = { docx: string; pdf: string };

/**
 * Renders a document to docx and pdf and puts both in its application's Drive
 * folder.
 *
 * The Drive file is reused across versions rather than being created per
 * version. Documents here are append-only, so refining a resume writes a new
 * row, and creating a new Drive file each time would mean the link Dan has open
 * on his phone silently stops being the current one. Instead the id is carried
 * forward from the previous version of the same type, the file is updated in
 * place, and the link stays good for the life of the application. Drive keeps
 * its own revisions of that file, so nothing is lost.
 */
/**
 * Upload into an application's folder, creating the folder if needed. The
 * narrow seam that non-Document records (evaluations, interview notes,
 * uploaded files) use, so folder resolution and the multipart upload stay in
 * one place rather than being reimplemented alongside them.
 */
export async function uploadToApplicationFolder(opts: {
  applicationId: string;
  name: string;
  mimeType: string;
  data: Buffer;
  existingFileId?: string | null;
}): Promise<string> {
  const folderId = await ensureApplicationFolder(opts.applicationId);
  return uploadFile({
    name: opts.name,
    mimeType: opts.mimeType,
    data: opts.data,
    folderId,
    existingFileId: opts.existingFileId,
  });
}

export async function syncDocumentToDrive(documentId: string): Promise<DriveLinks> {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, applicationId: true, type: true, content: true, driveFileIdDocx: true, driveFileIdPdf: true },
  });
  if (!doc) throw new Error("Document not found.");

  // A row with no content is a pointer at a file adopted from Drive: the file
  // is the record and there is nothing here to render. Uploading would put a
  // blank document over a real resume - recoverable from Drive's revision
  // history, but only if someone noticed. Refuse instead.
  if (!doc.content.trim()) {
    throw new Error("This document has no stored content - it lives in Drive already. Nothing to upload.");
  }

  // Nor a document that is technically not empty but obviously is not a
  // document. This is the guard the empty check above turned out to need.
  //
  // The sign-off repair rebuilt all 69 cover letters as letterhead + body +
  // sign-off. For the 56 adopted from Drive the body was "", so it produced
  // the 26 characters "\n\nSincerely,\n\nDaniel Curis" - not empty, so the
  // check above passed, and this function then rendered those 26 characters
  // over 56 real letters. They came back from Drive's revision history, which
  // is the only reason that was survivable.
  //
  // A resume or a cover letter is never this short. The shortest real letter
  // in the archive is about 1,950 characters, so the floor is far below
  // anything genuine and still catches a sign-off standing on its own.
  const MIN_CHARS: Record<string, number> = { resume: 600, cover_letter: 600 };
  const floor = MIN_CHARS[doc.type];
  if (floor && doc.content.trim().length < floor) {
    throw new Error(
      `Refusing to upload: this ${doc.type.replace(/_/g, " ")} is only ${doc.content.trim().length} characters, ` +
        `which is too short to be real. The Drive file has been left alone.`
    );
  }

  const folderId = await ensureApplicationFolder(doc.applicationId);

  // The most recent earlier version of this type that made it to Drive. Used
  // only when this row has no id of its own yet.
  const previous =
    doc.driveFileIdDocx && doc.driveFileIdPdf
      ? null
      : await prisma.document.findFirst({
          where: {
            applicationId: doc.applicationId,
            type: doc.type,
            id: { not: doc.id },
            OR: [{ driveFileIdDocx: { not: null } }, { driveFileIdPdf: { not: null } }],
          },
          orderBy: { generatedAt: "desc" },
          select: { driveFileIdDocx: true, driveFileIdPdf: true },
        });

  const formats = ["docx", "pdf"] as const;
  const ids: Record<"docx" | "pdf", string> = { docx: "", pdf: "" };

  for (const format of formats) {
    const rendered = await renderDocumentFile(documentId, format);
    if (!rendered) throw new Error("Document could not be rendered.");
    const existing =
      format === "docx"
        ? doc.driveFileIdDocx ?? previous?.driveFileIdDocx
        : doc.driveFileIdPdf ?? previous?.driveFileIdPdf;

    ids[format] = await uploadFile({
      name: rendered.filename,
      mimeType: rendered.mimeType,
      data: rendered.data,
      folderId,
      existingFileId: existing,
    });
  }

  await prisma.document.update({
    where: { id: documentId },
    data: { driveFileIdDocx: ids.docx, driveFileIdPdf: ids.pdf },
  });

  return { docx: driveFileUrl(ids.docx), pdf: driveFileUrl(ids.pdf) };
}

/**
 * The form used by everything that creates a document as a side effect of doing
 * something else. Drive is a convenience here, not the record: a generation
 * that produced a good resume must not be reported as a failure because an
 * upload timed out, so this never throws and the document row is already
 * committed by the time it runs. A failed sync is retried by the "Save to
 * Drive" button on the document.
 */
export async function syncDocumentToDriveQuietly(documentId: string): Promise<DriveLinks | null> {
  try {
    if (!(await isDriveConnected())) return null;
    return await syncDocumentToDrive(documentId);
  } catch (e) {
    console.warn(`Drive sync failed for document ${documentId}:`, (e as Error).message);
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Browsing, for attaching a file that already exists.
 * ------------------------------------------------------------------ */

export type DriveEntry = {
  id: string;
  name: string;
  mimeType: string;
  isFolder: boolean;
  modifiedTime?: string;
  path?: string;
};

const FOLDER = "application/vnd.google-apps.folder";

/** Immediate children of a folder, folders first then files, by name. */
export async function listFolder(folderId: string): Promise<DriveEntry[]> {
  const res = await driveFetch<{ files?: DriveEntry[] }>(
    `${DRIVE_API}/files?` +
      new URLSearchParams({
        q: `${quote(folderId)} in parents and trashed = false`,
        fields: "files(id,name,mimeType,modifiedTime)",
        pageSize: "200",
        orderBy: "folder,name",
      }),
    { method: "GET" }
  );
  return (res.files ?? []).filter((f) => !isJunk(f.name)).map((f) => ({ ...f, isFolder: f.mimeType === FOLDER }));
}

/**
 * Name search across the whole archive, for the file that is not where you
 * expected. Scoped by name rather than by parent because Drive cannot query a
 * subtree, so the root constraint is applied as a filter on the results below.
 */
/** Word and LibreOffice scratch files. Never a document anyone means to attach. */
function isJunk(name: string): boolean {
  return name.startsWith("~$") || name.startsWith(".~lock") || name.endsWith(".tmp");
}

/**
 * Whether a file sits anywhere beneath the archive root.
 *
 * Drive cannot query a subtree, so a name search is global: searching for a
 * resume returned copies sitting in Downloads alongside the real ones in the
 * Jobs tree. Attaching one of those would point the application at a file
 * outside the archive entirely. The ancestor walk is cached per call because
 * every hit in one folder shares the same chain.
 */
async function withinRoot(fileId: string, rootId: string, cache: Map<string, boolean>): Promise<boolean> {
  let current: string | undefined = fileId;
  const seen: string[] = [];
  for (let hops = 0; current && hops < 8; hops++) {
    if (current === rootId) {
      for (const id of seen) cache.set(id, true);
      return true;
    }
    const cached = cache.get(current);
    if (cached !== undefined) {
      for (const id of seen) cache.set(id, cached);
      return cached;
    }
    seen.push(current);
    try {
      const f: { parents?: string[] } = await driveFetch(`${DRIVE_API}/files/${current}?fields=parents`, { method: "GET" });
      current = f.parents?.[0];
    } catch {
      break;
    }
  }
  for (const id of seen) cache.set(id, false);
  return false;
}

export async function searchDrive(term: string, limit = 40): Promise<DriveEntry[]> {
  const cleaned = term.trim().replace(/'/g, "");
  if (!cleaned) return [];
  const res = await driveFetch<{ files?: (DriveEntry & { parents?: string[] })[] }>(
    `${DRIVE_API}/files?` +
      new URLSearchParams({
        q: `name contains ${quote(cleaned)} and trashed = false and mimeType != ${quote(FOLDER)}`,
        fields: "files(id,name,mimeType,modifiedTime,parents)",
        pageSize: String(limit),
        orderBy: "modifiedTime desc",
      }),
    { method: "GET" }
  );

  // Label each hit with its parent folder, since "Dan_Curis_Resume_ATT.docx"
  // means nothing without knowing which folder it came out of.
  const rootId = (await prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { driveRootFolderId: true } }))
    ?.driveRootFolderId;

  const out: DriveEntry[] = [];
  const parentNames = new Map<string, string>();
  const ancestry = new Map<string, boolean>();

  for (const f of res.files ?? []) {
    if (isJunk(f.name)) continue;
    const parent = f.parents?.[0];
    if (rootId && !(await withinRoot(f.id, rootId, ancestry))) continue;

    if (parent && !parentNames.has(parent)) {
      try {
        const p = await driveFetch<{ name: string }>(`${DRIVE_API}/files/${parent}?fields=name`, { method: "GET" });
        parentNames.set(parent, p.name);
      } catch {
        parentNames.set(parent, "");
      }
    }
    out.push({ ...f, isFolder: false, path: parent ? parentNames.get(parent) : undefined });
  }
  return out;
}

export async function getDriveFile(fileId: string): Promise<DriveEntry> {
  const f = await driveFetch<DriveEntry>(`${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,modifiedTime`, {
    method: "GET",
  });
  return { ...f, isFolder: f.mimeType === FOLDER };
}

/**
 * Plain text out of a .docx, without adding a parser dependency.
 *
 * Drive will not export a .docx directly, but it will copy one *into* a Google
 * Doc, and Google Docs export as text/plain. So: copy with conversion, export,
 * delete the copy. Three calls and a temporary file rather than unzipping the
 * OOXML by hand, and the conversion is Google's own, which handles the three
 * naming conventions and whatever formatting these files carry.
 */
export type RenderedDriveFile = { filename: string; mimeType: string; data: Buffer };

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Pulls a Drive file down as bytes so it can be attached to an email.
 *
 * Native Google formats (Docs, Sheets) have no bytes to download and must be
 * exported instead, so they are converted to their Office equivalent on the
 * way out - which is also the format a recruiter can open.
 */
export async function downloadDriveFile(fileId: string): Promise<RenderedDriveFile | null> {
  const meta = await getDriveFile(fileId).catch(() => null);
  if (!meta) return null;

  const { token } = await getAccessToken("drive");
  const google = meta.mimeType?.startsWith("application/vnd.google-apps.") ?? false;
  const exportAs = meta.mimeType === "application/vnd.google-apps.spreadsheet" ? XLSX_MIME : DOCX_MIME;

  const url = google
    ? `${DRIVE_API}/files/${fileId}/export?mimeType=${encodeURIComponent(exportAs)}`
    : `${DRIVE_API}/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Could not download "${meta.name}" from Drive: ${res.status}`);

  const mimeType = google ? exportAs : meta.mimeType || "application/octet-stream";
  const ext = google ? (exportAs === XLSX_MIME ? ".xlsx" : ".docx") : "";
  const filename = ext && !meta.name.toLowerCase().endsWith(ext) ? `${meta.name}${ext}` : meta.name;

  return { filename, mimeType, data: Buffer.from(await res.arrayBuffer()) };
}

export async function driveDocxToText(fileId: string): Promise<string> {
  const copy = await driveFetch<{ id: string }>(`${DRIVE_API}/files/${fileId}/copy?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mimeType: "application/vnd.google-apps.document", name: `counsel-import-${Date.now()}` }),
  });

  try {
    const { token } = await getAccessToken("drive");
    const res = await fetch(`${DRIVE_API}/files/${copy.id}/export?mimeType=text/plain`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive export failed: ${res.status}`);
    return (await res.text()).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } finally {
    // Always remove the temporary copy, including when the export threw, or
    // the archive slowly fills with counsel-import-* files nobody made.
    try {
      const { token } = await getAccessToken("drive");
      await fetch(`${DRIVE_API}/files/${copy.id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    } catch {
      /* the import already succeeded; a stray copy is not worth failing over */
    }
  }
}

/**
 * Files a document that belongs to no application.
 *
 * Everything else here is filed under company / role, because everything else
 * is written for a specific posting. The master resume and the introduction
 * letter are not: they exist for the networking call where somebody says "send
 * me your resume" and there is no role to tailor to. They live at the top of
 * the archive, beside the company folders rather than inside one.
 *
 * Returns the file id so the caller can store a stable link - the same
 * one-file-per-document rule as the rest, so the link Dan hands out keeps
 * working after the next regeneration.
 */
export async function uploadGeneralDocument(opts: {
  name: string;
  mimeType: string;
  data: Buffer;
  existingFileId?: string | null;
}): Promise<string> {
  const folderId = await ensureRootFolder();
  return uploadFile({ ...opts, folderId });
}
