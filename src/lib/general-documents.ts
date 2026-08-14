import { prisma } from "@/lib/prisma";
import { renderDocx } from "@/lib/docx-render";
import { renderPdf } from "@/lib/pdf-render";
import { uploadGeneralDocument } from "@/lib/google-drive";
import { generateText } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { enforceHouseLanguage, buildContactBlock } from "@/lib/contact-block";
import { TENANT_ID } from "@/lib/tenant";
import { nameList, nestingRule, orderingRule, placementNames } from "@/lib/career";

/**
 * Whose documents these are, for the prompts that address the person by name.
 *
 * "You are building Dan Curis's MASTER resume" was written into the system
 * prompt of a tool meant to run on anybody's instance.
 */
async function candidateName(): Promise<string> {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: { contactName: true },
  });
  return profile?.contactName?.trim() || "the candidate";
}

/** The letterhead line under the name, or null to let the contact block omit it. */
async function resumeTagline(): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: { resumeTagline: true },
  });
  return profile?.resumeTagline?.trim() || null;
}

/**
 * The two documents that belong to no role.
 *
 * Everything else this app writes is tailored to a posting. These are what Dan
 * sends when there is no posting: a networking call ends with "send me your
 * resume" and there is nothing to tailor to.
 */
export const GENERAL_KINDS = {
  master_resume: { label: "Master resume", file: "Resume_Master", kind: "resume" as const },
  intro_letter: { label: "Introduction letter", file: "Introduction_General", kind: "letter" as const },
};
export type GeneralKind = keyof typeof GENERAL_KINDS;

/**
 * The Drive filename, prefixed with whoever's instance this is.
 *
 * These were the literals "Dan_Curis_Resume_Master" and
 * "Dan_Curis_Introduction_General", so another person's Drive would fill up
 * with files carrying his name on their own resume.
 */
async function generalFileName(stem: string): Promise<string> {
  const who = await candidateName();
  const prefix = who
    .replace(/[^A-Za-z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "_");
  return prefix && prefix !== "the_candidate" ? `${prefix}_${stem}` : stem;
}

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Renders both formats and files them at the top of the archive, in place. */
const PLACEHOLDER = /\[(?:phone|email|linkedin|address|name|city|date|title|company)[^\]]*\]|\bTBD\b|\bplaceholder\b|\blorem\b/i;

export async function fileGeneralDocument(id: GeneralKind, content: string) {
  // A document Dan sends by hand, with no posting behind it and no review
  // step in front of it. "[phone] · [email] · [LinkedIn]" went out on one of
  // these, so the check is here rather than in a prompt.
  const found = content.match(PLACEHOLDER);
  if (found) {
    throw new Error(`Refusing to file: the document still contains a placeholder, "${found[0]}". Nothing was changed.`);
  }
  const meta = GENERAL_KINDS[id];
  const fileName = await generalFileName(meta.file);
  const existing = await prisma.generalDocument.findUnique({ where: { id } });

  const docx = await uploadGeneralDocument({
    name: `${fileName}.docx`,
    mimeType: DOCX_MIME,
    data: Buffer.from(await renderDocx(content, false, meta.kind)),
    existingFileId: existing?.driveFileIdDocx,
  });
  const pdf = await uploadGeneralDocument({
    name: `${fileName}.pdf`,
    mimeType: "application/pdf",
    data: Buffer.from(await renderPdf(content, false, meta.kind)),
    existingFileId: existing?.driveFileIdPdf,
  });

  return prisma.generalDocument.upsert({
    where: { id },
    create: { id, content, driveFileIdDocx: docx, driveFileIdPdf: pdf },
    update: { content, driveFileIdDocx: docx, driveFileIdPdf: pdf },
  });
}

/**
 * The master, merged from every variant rather than cut from one.
 *
 * A tailored resume selects sixteen bullets for a posting. This is the
 * opposite document, so it merges: where two lanes describe the same work
 * differently it keeps the fullest version of both, and length is not a
 * constraint.
 */
export async function buildMasterResume(): Promise<string> {
  const variants = await prisma.resumeVariant.findMany({ orderBy: { name: "asc" } });
  const profileContext = await buildProfileContext();
  const [who, base] = [await candidateName(), variants.map((v) => v.content).join("\n\n")];
  const gen = await generateText({
    maxTokens: 12000,
    system: `You are building ${who}'s MASTER resume by merging the lane-specific variants below into one comprehensive document.

${profileContext}

There is no posting. Its job is DEPTH: every distinct thing he has done belongs here, because this is what he sends when someone asks for his resume with no role attached, and it is what every tailored version is cut from.

- Merge, do not select. Where two variants describe the same work differently, combine them into the fullest single bullet that keeps every detail from both. Drop a bullet only when it genuinely duplicates another.
- Do NOT write the name, the contact line or any header. Start at "## EXECUTIVE PROFILE". The app supplies the letterhead from his real details, and a model asked for a contact line writes "[phone] · [email] · [LinkedIn]" - which is exactly what happened, on the resume he then sent to someone.
- Sections, in order: EXECUTIVE PROFILE, CORE EXPERTISE, PROFESSIONAL EXPERIENCE, EARLIER EXPERIENCE, EDUCATION.
- Keep the "> " scope line under each title, merging the domains from every variant that has one.
- ${orderingRule(base)} ${nestingRule(base)}
- CORE EXPERTISE spans every lane, since this document is aimed at none of them.
- Length is NOT constrained. Three pages is fine. Never trim to fit.
- Use ONLY the verified figures in his positioning and never invent another, and never attach an outcome that is not recorded.
- EARLIER EXPERIENCE and EDUCATION: reproduce exactly, same lines, same shape.
- Never write a horizontal rule ("---"). This format has no such line: the section headings do the separating, and a rule renders as three literal hyphens.`,
    user: variants.map((v) => `### VARIANT: ${v.name}\n${v.content}`).join("\n\n"),
  });
  const body = enforceHouseLanguage(gen.text.trim())
    .replace(/^([-*_]\s*){3,}$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    // Belt and braces: drop any header the model wrote anyway, up to the first
    // real section. Asking is not enough - it invented a contact line once.
    .replace(/^[\s\S]*?(?=^##\s+EXECUTIVE PROFILE)/m, "");

  // The real letterhead, from his profile, the same call every tailored resume
  // uses. Never generated. It carries the tagline itself, so the positioning
  // line and the contact line stay in one place rather than two. The tagline
  // was a string literal here, which put one person's positioning on every
  // instance's letterhead.
  const tagline = await resumeTagline();
  const header = await buildContactBlock({}, tagline ?? undefined);
  if (!header) throw new Error("No contact details on the profile, so the resume would have no letterhead.");
  return `${header}\n\n${body}`;
}

/** The "this is me" letter: no employer, no greeting, three paragraphs. */
export async function buildIntroLetter(): Promise<string> {
  const profileContext = await buildProfileContext();
  const profile = await prisma.profile.findUnique({ where: { id: TENANT_ID }, select: { contactName: true } });
  // Named from the resume rather than the prompt, so the letter places the
  // person whose instance this is.
  const variants = await prisma.resumeVariant.findMany({ select: { content: true } });
  const placement = placementNames(variants.map((v) => v.content).join("\n\n"));
  const who = await candidateName();
  const gen = await generateText({
    maxTokens: 2000,
    system: `You are writing ${who}'s general introduction letter, the one he attaches when somebody on a networking call says "send me your resume". There is no job description and no employer.

${profileContext}

- Body only. THREE paragraphs, 200 to 260 words. Write NO greeting, NO salutation, NO sign-off and NO name: the app adds the letterhead and he adds the greeting himself, for the person he has just spoken to.
- Never "Dear ...", never "this role", never "your company". Nothing that pretends a specific job is on the table.
- Paragraph 1 opens by placing him, using the positioning above for the framing and naming his employers: ${nameList(placement.recent) || "his most recent employers"}${placement.earlier.length ? `, AND the earlier experience at ${nameList(placement.earlier)}` : ""}. The earlier roles matter here and are usually left out - they are often why somebody can talk to two different audiences in the same meeting - so they belong in the opening, not buried. Then what he actually does, in one plain sentence a reader could repeat to someone else. That sentence is the one that gets forwarded.
- Paragraph 2: the strongest concrete evidence, verified figures only.
- Paragraph 3: what he is looking for, and an open unpushy close.
- Use ONLY the verified figures in his positioning. Never invent one, never attach an unrecorded outcome.`,
    user: "Write the introduction letter body.",
  });

  const body = gen.text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^(dear|hi|hello)\b/i.test(l) && !/^(sincerely|best|regards|dan\b|daniel curis)/i.test(l))
    .join("\n\n");

  // Same letterhead call as the resume and every tailored document. It was a
  // hardcoded address string here, which is the same fault as a generated one:
  // a second copy of his contact details that goes stale silently.
  const header = await buildContactBlock({});
  if (!header) throw new Error("No contact details on the profile, so the letter would have no letterhead.");
  const name = (profile?.contactName ?? "Daniel Curis").replace(/^Dan\b/, "Daniel");
  return enforceHouseLanguage([header, "", body, "", "Sincerely,", "", name].join("\n"));
}
