import { type DocumentType } from "@/lib/constants";

/**
 * Matching rules for reconciling tracked applications against the Drive folder
 * tree the job search already lives in.
 *
 * Pure functions, kept out of the script so they can be tested without a
 * database or a Drive token. The rules are deliberately conservative: this
 * decides which employer a resume belongs to, and a confident wrong answer
 * files Dan's Chase resume under JP Morgan. Everything it is not sure about is
 * reported for a human rather than guessed at.
 */

/**
 * Case, punctuation and spacing are noise: the same employer appears as
 * "WarnerBrosDiscovery", "Warner Bros. Discovery", "learning care group",
 * "Welchs" and "Welch's" across the folder tree and the tracker.
 */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Hand-maintained, and empty on purpose.
 *
 * Abbreviations that normalisation cannot reach ("ACME" for a card issuer,
 * "Coke" for Coca-Cola, "SAMS" for Sam's Club) need a human to confirm the pair
 * before anything is written, because the cost of being wrong is a document
 * filed under the wrong employer. `suggestionsFor` prints the near misses in
 * the shape of these entries, so confirming one is a copy and a paste.
 *
 * Key and value are both matched after normalisation, so case and punctuation
 * do not matter here either.
 */
export const COMPANY_ALIASES: Record<string, string> = {
  // Keyed by the normalised tracked-company name, valued with the name whose
  // normalised form matches the Drive folder. Confirmed one at a time with Dan
  // - never inferred, because filing a resume under the wrong employer is
  // worse than filing none.
  "coraltreehospitality": "CoralTree",
  // CNN is a Warner Bros. Discovery property and the archive folder is the
  // parent's. Consequence accepted knowingly: a folder can be claimed once, so
  // a future WBD-branded role will not be able to take this one.
  "cnnwarnerbrosdiscovery": "WarnerBrosDiscovery",
};

export type CompanyMatch = {
  companyId: string;
  companyName: string;
  folderId: string;
  folderName: string;
  /** exact when the names normalise equal, alias when COMPANY_ALIASES bridged them. */
  via: "exact" | "alias";
};

export type Unmatched = { companyId: string; companyName: string; suggestions: string[] };

export type DriveFolder = { id: string; name: string };
export type TrackedCompany = { id: string; name: string; driveFolderName?: string | null };

/**
 * Two employers normalising to the same string, or two folders doing so, is not
 * something to pick a winner for. Both sides are dropped and reported.
 */
export function matchCompanies(
  companies: TrackedCompany[],
  folders: DriveFolder[]
): { matches: CompanyMatch[]; ambiguous: string[]; unmatched: Unmatched[] } {
  const foldersByKey = new Map<string, DriveFolder[]>();
  for (const folder of folders) {
    const key = normalizeName(folder.name);
    if (!key) continue;
    foldersByKey.set(key, [...(foldersByKey.get(key) ?? []), folder]);
  }

  const matches: CompanyMatch[] = [];
  const ambiguous: string[] = [];
  const unmatched: Unmatched[] = [];
  // A folder may only be claimed once: two tracked companies pointing at one
  // folder would have them overwrite each other's documents.
  const claimed = new Map<string, string>();

  for (const company of companies) {
    // An explicit driveFolderName is a decision already made, so it wins.
    const candidates = [company.driveFolderName, company.name].filter(
      (n): n is string => Boolean(n && n.trim())
    );

    let hit: { folder: DriveFolder; via: "exact" | "alias" } | null = null;
    let sawAmbiguity = false;

    for (const candidate of candidates) {
      const key = normalizeName(candidate);
      const aliasKey = COMPANY_ALIASES[key] ? normalizeName(COMPANY_ALIASES[key]) : null;
      for (const [lookup, via] of [
        [key, "exact"],
        ...(aliasKey ? [[aliasKey, "alias"] as const] : []),
      ] as [string, "exact" | "alias"][]) {
        const found = foldersByKey.get(lookup);
        if (!found) continue;
        if (found.length > 1) {
          sawAmbiguity = true;
          continue;
        }
        hit = { folder: found[0], via };
        break;
      }
      if (hit) break;
    }

    if (sawAmbiguity && !hit) {
      ambiguous.push(`${company.name}: several Drive folders normalise to the same name`);
      continue;
    }
    if (!hit) {
      unmatched.push({ companyId: company.id, companyName: company.name, suggestions: suggestionsFor(company.name, folders) });
      continue;
    }
    const already = claimed.get(hit.folder.id);
    if (already) {
      ambiguous.push(`${company.name} and ${already} both match the Drive folder "${hit.folder.name}"`);
      continue;
    }
    claimed.set(hit.folder.id, company.name);
    matches.push({
      companyId: company.id,
      companyName: company.name,
      folderId: hit.folder.id,
      folderName: hit.folder.name,
      via: hit.via,
    });
  }

  return { matches, ambiguous, unmatched };
}

/**
 * Near misses for a name that matched nothing. Containment either way catches
 * the common abbreviation ("NBCU" inside "NBCUniversal", "Chase" inside
 * "JPMorganChase"); a shared prefix catches truncation. Suggestions only - they
 * are never acted on, because "Chase" also sits inside "JP Morgan Chase" and
 * choosing between those two folders is exactly the judgement worth escalating.
 */
export function suggestionsFor(name: string, folders: DriveFolder[]): string[] {
  const key = normalizeName(name);
  if (!key) return [];
  return folders
    .filter((folder) => {
      const other = normalizeName(folder.name);
      if (!other || other === key) return false;
      if (other.includes(key) || key.includes(other)) return true;
      const shared = sharedPrefix(key, other);
      return shared >= 4 && shared >= Math.min(key.length, other.length) - 2;
    })
    .map((f) => f.name)
    .slice(0, 5);
}

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * Which document a Drive filename holds.
 *
 * Three naming eras coexist in the tree - "Daniel_Curis_Resume_Chase.docx",
 * "Curis_GoToFoods_Resume.docx" and the current
 * "Dan_Curis_Resume_GoToFoods.docx" - so this matches on keywords rather than
 * on any one convention. Cover letters are tested first: "CoverLetter" and
 * "Cover_Letter" both normalise to contain "coverletter", and a filename
 * carrying both words should never be read as a resume.
 */
export function classifyDocumentType(filename: string): DocumentType | null {
  const key = normalizeName(filename.replace(/\.[a-z0-9]+$/i, ""));
  if (!key) return null;
  if (key.includes("coverletter")) return "cover_letter";
  if (key.includes("interviewprep") || key.includes("prep")) return "interview_prep";
  if (key.includes("jobposting") || key.includes("jobdescription") || key.includes("jobspec")) {
    return "job_description";
  }
  if (key.includes("recruiterresponse")) return "recruiter_response";
  if (key.includes("resume") || key.includes("cv")) return "resume";
  return null;
}

/** Only the two formats a Document is rendered to. Anything else is not a copy of one. */
export function formatOf(filename: string, mimeType?: string): "docx" | "pdf" | null {
  if (/\.docx$/i.test(filename)) return "docx";
  if (/\.pdf$/i.test(filename)) return "pdf";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  return null;
}

export type ApplicationRef = { id: string; roleTitle: string };
export type WalkedFile = { id: string; name: string; path: string; mimeType?: string; modifiedTime?: string };
export type WalkedFolder = { id: string; name: string; path: string };

export type AssignedFile = WalkedFile & {
  /**
   * Came out of this application's own role folder, rather than from the
   * company folder. Role-folder files outrank company-level ones for the same
   * document type, so a stale resume loose in the company folder cannot beat
   * the one filed under the role.
   */
  fromRoleFolder: boolean;
};

export type FileAssignment = {
  applicationId: string;
  /** The role folder that matched, or null when the company folder is the application's folder. */
  roleFolderId: string | null;
  files: AssignedFile[];
};

/**
 * Splits one company folder's files between the roles tracked at that employer.
 *
 * This is the part that has to be right. Every application gets its own resume
 * and cover letter, tailored to that job description, and two roles at one
 * employer sit in the same company folder. Handing both applications the same
 * Drive file would mean the next refine on one silently overwrote the other's
 * document and left its link pointing at the wrong role's resume - invisible
 * until the wrong resume went out.
 *
 * So the only files linked automatically are ones whose ownership is not in
 * question:
 *
 * - Inside a folder whose name matches a tracked role, they belong to that role.
 * - Loose in the company folder (including under Word/ and PDF/), they belong to
 *   the tracked role only when there is exactly one. With two or more, nothing
 *   distinguishes them and nothing is linked.
 *
 * A file is therefore never assigned to more than one application, and a role
 * folder is never claimed by two. Where both a role folder and the company
 * folder offer the same document type, `fromRoleFolder` marks the ones that
 * should win.
 */
export function assignFilesToApplications(
  applications: ApplicationRef[],
  folders: WalkedFolder[],
  files: WalkedFile[]
): { assignments: FileAssignment[]; unassigned: { file: WalkedFile; reason: string }[] } {
  // Only direct children of the company folder are candidate role folders.
  // Word/, PDF/ and files/ are format folders and hold company-level material.
  const directChildren = folders.filter((f) => !f.path.includes("/"));

  const claimedFolders = new Map<string, string[]>();
  for (const app of applications) {
    const folder = directChildren.find((f) => normalizeName(f.name) === normalizeName(app.roleTitle));
    if (folder) claimedFolders.set(folder.id, [...(claimedFolders.get(folder.id) ?? []), app.id]);
  }

  const roleFolderFor = new Map<string, WalkedFolder>();
  for (const app of applications) {
    const folder = directChildren.find((f) => normalizeName(f.name) === normalizeName(app.roleTitle));
    // Two tracked roles normalising onto one folder is not something to pick a
    // winner for; neither gets it.
    if (folder && claimedFolders.get(folder.id)?.length === 1) roleFolderFor.set(app.id, folder);
  }

  const assignments: FileAssignment[] = applications.map((app) => ({
    applicationId: app.id,
    roleFolderId: roleFolderFor.get(app.id)?.id ?? null,
    files: [],
  }));
  const byId = new Map(assignments.map((a) => [a.applicationId, a]));
  const unassigned: { file: WalkedFile; reason: string }[] = [];

  const ownedPrefixes = [...roleFolderFor.entries()].map(([applicationId, folder]) => ({
    applicationId,
    prefix: `${folder.name}/`,
  }));

  for (const file of files) {
    const owner = ownedPrefixes.find((o) => file.path.startsWith(o.prefix));
    if (owner) {
      byId.get(owner.applicationId)?.files.push({ ...file, fromRoleFolder: true });
      continue;
    }
    // Sitting inside some other folder that matches no tracked role - another
    // role's folder, or an unrelated one. Not safe to attribute.
    const insideUnmatchedRoleFolder = directChildren.some(
      (f) =>
        file.path.startsWith(`${f.name}/`) &&
        !ownedPrefixes.some((o) => o.prefix === `${f.name}/`) &&
        !["word", "pdf", "files"].includes(normalizeName(f.name))
    );
    if (insideUnmatchedRoleFolder) {
      unassigned.push({ file, reason: "in a subfolder that matches no tracked role" });
      continue;
    }
    if (applications.length === 1) {
      byId.get(applications[0].id)?.files.push({ ...file, fromRoleFolder: false });
      continue;
    }
    unassigned.push({
      file,
      reason: `${applications.length} roles tracked here and this file is not inside a role folder`,
    });
  }

  return { assignments, unassigned };
}

export type DriveFileRef = { id: string; name: string; modifiedTime?: string };

/**
 * One file per document type and format, where a folder holds several.
 *
 * GoToFoods carries both "Dan_Curis_Resume_GoToFoods.docx" and the older
 * "Curis_GoToFoods_Resume.docx". The one whose name matches what this app
 * generates today wins; failing that, the most recently modified one, which is
 * the one Dan actually sent.
 */
export function pickBestFile(candidates: DriveFileRef[], canonicalName: string): DriveFileRef | null {
  if (candidates.length === 0) return null;
  const canonical = normalizeName(canonicalName);
  const exact = candidates.filter((c) => normalizeName(c.name) === canonical);
  const pool = exact.length > 0 ? exact : candidates;
  return [...pool].sort((a, b) => (b.modifiedTime ?? "").localeCompare(a.modifiedTime ?? ""))[0];
}
