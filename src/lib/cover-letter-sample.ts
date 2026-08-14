import { prisma } from "@/lib/prisma";

/**
 * A letter the person actually wrote, used as a voice reference.
 *
 * The resume had four base variants and the cover letter had **nothing**. A
 * letter was generated from the profile prose plus whichever resume variant was
 * chosen plus the job description, which means the voice came from nowhere: the
 * only description of how a letter should sound was several hundred words of
 * prompt text listing banned openers.
 *
 * That asymmetry is the gap. A resume is tailored from an artifact, so it
 * cannot invent a job. A letter was assembled from adjectives, so its register
 * was whatever the model reached for that run, and correcting it meant adding
 * another banned phrase to the list.
 *
 * ## Why this is a reference and never a template
 *
 * The sample is about a different employer. Everything in it that reads like a
 * fact - a company, a project, a number, a reason for applying - belongs to
 * that application and would be false in this one. So the instruction below is
 * emphatic and specific rather than a polite "use it as inspiration": the
 * plausible failure here is a well-written paragraph about the wrong company,
 * which is exactly the class of error this app takes most seriously.
 */

export type CoverLetterVoice = { name: string; content: string };

/**
 * The sample to write in the style of, or null when none is stored.
 *
 * Prefers the one marked default, then the most recently updated, matching how
 * a resume variant is chosen. Absence is ordinary: an instance with no sample
 * writes letters exactly as it did before this existed.
 */
export async function coverLetterVoice(): Promise<CoverLetterVoice | null> {
  try {
    const sample =
      (await prisma.coverLetterSample.findFirst({ where: { isDefault: true } })) ??
      (await prisma.coverLetterSample.findFirst({ orderBy: { updatedAt: "desc" } }));
    if (!sample?.content?.trim()) return null;
    return { name: sample.name, content: sample.content.trim() };
  } catch {
    // No table yet on an un-migrated deployment. Not having a voice sample is
    // a state, not a failure, and must never stop a document being generated.
    return null;
  }
}

/**
 * What to tell the model about the sample.
 *
 * Kept beside the query so the instruction and the data cannot be wired up
 * separately, which is how the standing preferences ended up stated in four
 * places that disagreed.
 */
export const VOICE_INSTRUCTION = `VOICE REFERENCE. A cover letter he wrote himself is supplied below. Match how it SOUNDS: sentence length and rhythm, how formally it addresses the reader, how it opens, how much it explains versus asserts, whether it uses contractions.

Take NOTHING else from it. Every company, project, figure, product and reason-for-applying in that letter belongs to a different application and is FALSE here. Do not reuse its opening sentence, do not carry across an employer it names, and do not repeat a claim it makes unless the base resume for THIS application also carries it. If a sentence in it cannot be supported by the material for this role, it does not appear in any form.`;

/** The sample as it appears in the user message, or an empty string. */
export function voiceSection(sample: CoverLetterVoice | null): string {
  if (!sample) return "";
  return `\n\nA COVER LETTER HE WROTE (voice reference only, "${sample.name}" - its facts belong to a different application):\n${sample.content}`;
}
