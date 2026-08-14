import { prisma } from "@/lib/prisma";
import { TENANT_ID } from "@/lib/tenant";

export type LabelledValue = { label: string; value: string };

export function parseLabelled(raw: string | null | undefined): LabelledValue[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((x): x is LabelledValue => typeof x?.label === "string" && typeof x?.value === "string")
      .filter((x) => x.value.trim().length > 0);
  } catch {
    return [];
  }
}

/** "Label: value" per line, which is how the Profile textarea edits these. */
export function parseLabelledLines(text: string): LabelledValue[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const i = line.indexOf(":");
      if (i === -1) return { label: "Default", value: line };
      return { label: line.slice(0, i).trim() || "Default", value: line.slice(i + 1).trim() };
    })
    .filter((x) => x.value.length > 0);
}

export function formatLabelledLines(items: LabelledValue[]): string {
  return items.map((i) => `${i.label}: ${i.value}`).join("\n");
}

export type ContactSelection = { addressLabel?: string | null; emailLabel?: string | null };

/**
 * Builds the resume contact block deterministically. The model is never asked
 * to produce this: it has no way to know the details and previously invented
 * "[email/phone placeholders]" in their place. Anything missing is omitted
 * rather than stubbed.
 */
export async function buildContactBlock(
  selection: ContactSelection = {},
  tagline?: string | null
): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: {
      contactName: true,
      contactPhone: true,
      contactLinks: true,
      contactAddresses: true,
      contactEmails: true,
      defaultAddressLabel: true,
      defaultEmailLabel: true,
    },
  });
  if (!profile) return null;

  const addresses = parseLabelled(profile.contactAddresses);
  const emails = parseLabelled(profile.contactEmails);

  const pick = (items: LabelledValue[], wanted?: string | null, fallback?: string | null) =>
    items.find((i) => i.label === wanted) ?? items.find((i) => i.label === fallback) ?? items[0];

  const address = pick(addresses, selection.addressLabel, profile.defaultAddressLabel);
  const email = pick(emails, selection.emailLabel, profile.defaultEmailLabel);

  // The header carries the formal name, the same rule the letterhead uses.
  // MasterFacts is explicit: "Header name (formal): Daniel Curis. Familiar /
  // signature: Dan." The resume was going out headed "Dan Curis".
  const raw = profile.contactName?.trim();
  if (!raw) return null;
  const name = raw.replace(/^Dan\b/, "Daniel");

  // A bare linkedin path, not a full URL: "https://www.linkedin.com/in/example/"
  // eats a third of the contact line and reads like a pasted address bar.
  const links = (profile.contactLinks ?? "").replace(/https?:\/\/(www\.)?/gi, "").replace(/\/$/, "").trim();

  const detail = [address?.value, profile.contactPhone?.trim(), email?.value, links]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v))
    .join(" | ");

  // Name, then the tailored positioning line, then the fixed details - which
  // is the shape Dan's own strongest resumes use.
  const lines = [`## ${name}`];
  if (tagline?.trim()) lines.push(tagline.trim());
  if (detail) lines.push(detail);
  return lines.join("\n");
}


/**
 * The letterhead for a cover letter, assembled from the same Profile fields as
 * the resume contact block but in the shape Dan's own letters use:
 *
 *   ALEX MORENO
 *   Southport, CT  |  (203) 555-0142  |  alex@example.com  |  linkedin.com/in/example
 *
 *   August 4, 2026
 *   Dear Hiring Manager,
 *
 * Note the name is set in full and uppercase - his letters say DANIEL CURIS
 * where the resume says Dan Curis - and the links are stripped of their scheme,
 * which is how they appear on the letters themselves.
 */
/**
 * The close of a cover letter.
 *
 * `buildLetterHead` adds the salutation and nothing ever added the sign-off, so
 * every letter this app has produced ended on the last sentence of the body
 * with no "Sincerely" and no name. The model is explicitly told not to write
 * one - "the app adds his name, contact details, the date and the greeting" -
 * so the omission was silent on both sides: the model obeyed and the app
 * forgot.
 *
 * The formal name, matching the letterhead. MasterFacts is explicit that the
 * header name is Daniel and the familiar name is Dan.
 */
export async function buildLetterSignOff(): Promise<string> {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: { contactName: true },
  });
  const name = (profile?.contactName ?? "Daniel Curis").trim().replace(/^Dan\b/, "Daniel");
  return `Sincerely,\n\n${name}`;
}

export async function buildLetterHead(
  selection: ContactSelection = {},
  recipient: { company?: string | null; division?: string | null; location?: string | null; role?: string | null } = {},
  salutation = "Dear Hiring Team,"
): Promise<string | null> {
  const profile = await prisma.profile.findUnique({
    where: { id: TENANT_ID },
    select: {
      contactName: true,
      contactPhone: true,
      contactLinks: true,
      contactAddresses: true,
      contactEmails: true,
      defaultAddressLabel: true,
      defaultEmailLabel: true,
    },
  });
  if (!profile?.contactName?.trim()) return null;

  const addresses = parseLabelled(profile.contactAddresses);
  const emails = parseLabelled(profile.contactEmails);
  const pick = (items: LabelledValue[], wanted?: string | null, fallback?: string | null) =>
    items.find((i) => i.label === wanted) ?? items.find((i) => i.label === fallback) ?? items[0];

  const email = pick(emails, selection.emailLabel, profile.defaultEmailLabel);

  // The letter uses the same address as the resume. This used to pick the
  // shortest one in the same state, on the reasoning that a letter carries the
  // city and not the street - which produced "Southport, CT" on the letter and
  // the full address on the resume, from one profile setting. Dan asked for the
  // full address, and one setting meaning two different things is worse than
  // either answer.
  const address = pick(addresses, selection.addressLabel, profile.defaultAddressLabel);

  // "Dan Curis" -> "DANIEL CURIS": the letters use his full first name.
  const name = profile.contactName.trim().replace(/^Dan\b/, "Daniel").toUpperCase();
  const links = (profile.contactLinks ?? "").replace(/https?:\/\/(www\.)?/gi, "").replace(/\/$/, "").trim();

  const detail = [address?.value, profile.contactPhone?.trim(), email?.value, links]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v))
    .join("  ·  ");

  const date = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  // Recipient block in the order Dan's own letters use: the addressee first,
  // then the employer, then the location. Company-first reads like a mailing
  // label rather than a letter to a person.
  const recipientLines = [recipient.division, recipient.company, recipient.location]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v));

  // A subject line, which every strong letter in the Jobs folder carries. A
  // recruiter holding several openings should not have to infer which one this
  // is from the first paragraph.
  const subject = recipient.role?.trim() ? `Re: ${recipient.role.trim()}` : null;

  return [`## ${name}`, detail, "", date, ...recipientLines, subject, salutation]
    .filter((v): v is string => Boolean(v))
    .join("\n");
}

/**
 * Removes any contact block the model produced despite being told not to.
 * This is not belt-and-braces tidying: a generated resume once carried an
 * invented phone number and email address directly beneath the
 * real details, which is the single worst thing this app could put in front
 * of a recruiter. Only leading lines are considered, so a real email inside
 * an achievement bullet is untouched.
 */
export function stripContactLines(body: string, name?: string | null): string {
  const lines = body.split("\n");
  const head = lines.slice(0, 8);

  const isDefinite = (line: string) => {
    const t = line.replace(/^#+\s*/, "").trim();
    if (!t) return false;
    if (/@/.test(t)) return true;
    if (/linkedin\.com/i.test(t)) return true;
    if (/\(?\d{3}\)?[.\-\s]\d{3}[.\-\s]\d{4}/.test(t)) return true;
    if (name && t.toLowerCase() === name.toLowerCase()) return true;
    return false;
  };

  // A bare "Southport, CT" carries no email, phone or name, so testing lines
  // one at a time stops at it and leaves the fabricated block that follows.
  // Instead: if anything in the header region is definitely contact detail,
  // drop everything above the first real section heading.
  if (!head.some(isDefinite)) return body;

  const firstHeading = lines.findIndex((l) => /^##\s+\S/.test(l) && !isDefinite(l));
  if (firstHeading === -1) {
    return lines.filter((l) => !isDefinite(l)).join("\n").trimStart();
  }
  return lines.slice(firstHeading).join("\n").trimStart();
}


/**
 * Removes a role sub-heading from PROFESSIONAL EXPERIENCE when the same
 * employer is already covered under EARLIER EXPERIENCE. The prompt forbids
 * this, but the model kept doing it, listing the agency years twice.
 */
export function dedupeEarlierExperience(body: string): string {
  const lines = body.split("\n");
  const earlierStart = lines.findIndex((l) => /^##\s+EARLIER EXPERIENCE/i.test(l));
  if (earlierStart === -1) return body;

  const earlierText = lines
    .slice(earlierStart)
    .join(" ")
    .toLowerCase();

  const out: string[] = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i >= earlierStart) {
      out.push(line);
      continue;
    }
    if (/^###\s+/.test(line)) {
      // A role heading whose employer names already appear under Earlier
      // Experience is a duplicate; drop it and the block beneath it.
      const words = line
        .replace(/^###\s+/, "")
        .split(/[|·,]/)
        .map((w) => w.trim().toLowerCase())
        .filter((w) => w.length > 3);
      skipping = words.length > 0 && words.every((w) => earlierText.includes(w));
      if (skipping) continue;
    } else if (skipping && (/^##\s+/.test(line) || /^###\s+/.test(line))) {
      skipping = false;
    }
    if (!skipping) out.push(line);
  }
  return out.join("\n");
}


/**
 * Strips the trailing clause where a bullet stops stating a fact and starts
 * arguing its own relevance: "..., the same matrixed-influence model this role
 * requires". Three separate prompt rules failed to stop the model adding
 * these, and a senior reader marks them down as padding, so they are removed
 * here instead. Only a final comma-clause is considered, and only when it
 * clearly refers to the posting rather than continuing the fact.
 */
const SELF_REFERENTIAL =
  /\brole\b|\bthis position\b|direct precedent|direct parallel|\bexactly\b|\bprecisely\b|directly relevant|the same (kind|discipline|model|operational)|discipline .*\bdemands?\b|what this (role|job|position)/i;

export function stripRelevanceClaims(text: string): string {
  const parts = text.split(",");
  if (parts.length < 2) return text.trim();

  const last = parts[parts.length - 1];
  // Guard against cutting a short continuation like ", and scaled it".
  if (SELF_REFERENTIAL.test(last) && last.trim().split(/\s+/).length >= 4) {
    return parts.slice(0, -1).join(",").trim().replace(/[,;]\s*$/, "") + ".";
  }
  return text.trim();
}

// Outcome verbs paired with a metric noun assert a result. On this resume that
// is only defensible when a number backs it: the candidate has scale figures
// (portfolio, headcount, transactions) but no satisfaction, resolution or
// deflection metrics, and a claim he cannot quantify in interview is worse
// than no claim at all.
const OUTCOME_VERB = /\b(improv\w+|increas\w+|reduc\w+|accelerat\w+|boost\w+|lift\w+|enhanc\w+|drove|driving|grew|growing|cut|cutting)\b/i;
const METRIC_NOUN =
  /\b(resolution|satisfaction|nps|csat|ces|retention|churn|loyalty|conversion|efficiency|productivity|engagement|adoption|deflection|containment|handle time|wait time|response time|turnaround|throughput|uptime|availability|cost|revenue|margin|sales|score|rate)\b/i;

/**
 * Removes clauses that claim an outcome without a number behind it. Only
 * clause-level surgery: a sentence keeps every part that states what was
 * built, run or led.
 */
export function stripUnevidencedOutcomes(text: string): string {
  const clauses = text.split(/,\s*/);
  if (clauses.length < 2) return text.trim();

  const offends = (part: string) =>
    OUTCOME_VERB.test(part) && METRIC_NOUN.test(part) && !/\d/.test(part);

  let changed = false;
  const kept = clauses
    .map((clause, i) => {
      if (i === 0) return clause; // never drop the opening claim
      if (!offends(clause)) return clause;
      // "compressing agent onboarding and improving first-contact resolution"
      // is one clause holding a defensible fact and an indefensible claim.
      // Split on "and" so only the offending half goes.
      const parts = clause.split(/\s+and\s+/);
      if (parts.length > 1) {
        const survivors = parts.filter((part) => !offends(part));
        if (survivors.length > 0 && survivors.length < parts.length) {
          changed = true;
          return survivors.join(" and ");
        }
      }
      changed = true;
      return null;
    })
    .filter((c): c is string => c !== null);

  if (!changed) return text.trim();
  return kept.join(", ").replace(/[,;]\s*$/, "").replace(/\.?$/, ".");
}

// British spellings kept reaching the final document - centre, prioritisation,
// traveller - partly from the base resumes I wrote and partly from the model
// drifting when the employer is Canadian. Normalising at assembly means it
// cannot depend on remembering, or on the model complying.
const US_SPELLING: [RegExp, string][] = [
  [/\btravell(er|ers|ing|ed)\b/gi, "travel$1"],
  // "centred" is "centered", not "centerd". The British form drops an e that
  // the American one keeps, so the suffix cannot be carried across unchanged -
  // which is what the single `centre(s|d)?` rule here used to do.
  [/\bcentred\b/gi, "centered"],
  [/\bcentring\b/gi, "centering"],
  [/\bcentre(s)?\b/gi, "center$1"],
  // -ise/-isation verbs, listed explicitly rather than by suffix so that
  // "expertise", "promise" and "franchise" are never touched.
  [/\b(priorit|organ|recogn|modern|optim|real|standard|personal|special|maxim|minim|central|digit)is(e|es|ed|er|ers|ing|ation|ations)\b/gi, "$1iz$2"],
  [/\banalys(e|es|ed|ing|is)\b/gi, "analyz$1"],
  [/\bbehaviour(s|al)?\b/gi, "behavior$1"],
  [/\bfavour(s|ed|ing|able)?\b/gi, "favor$1"],
  [/\blabour(s|ed|ing)?\b/gi, "labor$1"],
  [/\bprogramme(s)?\b/gi, "program$1"],
  [/\blicence\b/gi, "license"],
  [/\bdefence\b/gi, "defense"],
  [/\bfulfil\b/gi, "fulfill"],
  [/\bjudgement\b/gi, "judgment"],
  // Added after British spellings kept reaching Dan's drafts despite the
  // prompt asking for US English. The list was too short to be the enforcement
  // it claimed to be: "whilst", "amongst" and "-ce" nouns all sailed through.
  [/\bwhilst\b/gi, "while"],
  [/\bamongst\b/gi, "among"],
  [/\bamidst\b/gi, "amid"],
  [/\btowards\b/gi, "toward"],
  [/\bcolour(s|ed|ing|ful)?\b/gi, "color$1"],
  [/\bhonour(s|ed|ing|able)?\b/gi, "honor$1"],
  [/\bneighbour(s|ing|hood|hoods)?\b/gi, "neighbor$1"],
  [/\bendeavour(s|ed|ing)?\b/gi, "endeavor$1"],
  [/\brumour(s|ed)?\b/gi, "rumor$1"],
  [/\bcatalogue(s|d)?\b/gi, "catalog$1"],
  [/\bdialogue(s|d)?\b/gi, "dialog$1"],
  [/\bpractise(s|d|ing)?\b/gi, "practice$1"],
  [/\boffence(s)?\b/gi, "offense$1"],
  [/\bpretence\b/gi, "pretense"],
  [/\benrol\b/gi, "enroll"],
  [/\benrolment\b/gi, "enrollment"],
  [/\bfulfilment\b/gi, "fulfillment"],
  [/\binstalment(s)?\b/gi, "installment$1"],
  [/\bskilful\b/gi, "skillful"],
  [/\bwilful\b/gi, "willful"],
  [/\bmarvellous\b/gi, "marvelous"],
  [/\bcancell(ed|ing)\b/gi, "cancel$1"],
  [/\bmodell(ed|ing)\b/gi, "model$1"],
  [/\blabell(ed|ing)\b/gi, "label$1"],
  [/\bsignall(ed|ing)\b/gi, "signal$1"],
  [/\bfocuss(ed|ing)\b/gi, "focus$1"],
  [/\bcheque(s)?\b/gi, "check$1"],
  [/\bstorey(s)?\b/gi, "story$1"],
  [/\bmanoeuvre(s|d)?\b/gi, "maneuver$1"],
  [/\bemphasis(e|es|ed|ing)\b/gi, "emphasiz$1"],
  [/\bapologis(e|es|ed|ing)\b/gi, "apologiz$1"],
  [/\bsummaris(e|es|ed|ing)\b/gi, "summariz$1"],
  [/\bcategoris(e|es|ed|ing)\b/gi, "categoriz$1"],
  [/\bcustomis(e|es|ed|ing|ation)\b/gi, "customiz$1"],
  [/\butilis(e|es|ed|ing|ation)\b/gi, "utiliz$1"],
  // `specialist` is spelled the same on both sides of the Atlantic and had a
  // rule here that replaced it with itself. Harmless in lower case and not in
  // upper: the wrapper rebuilt "SPECIALIST" as "SpecialisT", because the
  // captured group kept its own case while the rest was lowered. No rule at
  // all is the correct amount of rule.
];

/**
 * Applies US spelling, preserving the original capitalization of each match.
 *
 * Three cases, not two. The first version only asked "does it start with a
 * capital", so an all-caps word came back title-cased with whatever case the
 * captured group happened to carry: `SPECIALIST` became `SpecialisT`. This
 * corpus is full of deliberate all-caps - `PROJECT MANAGEMENT organisation`,
 * `AS DIRECTOR` - and it runs over every note Dan sends, so mangling emphasis
 * is not a rare edge.
 */
export function toUSSpelling(text: string): string {
  let out = text;
  for (const [pattern, replacement] of US_SPELLING) {
    out = out.replace(pattern, (match: string, ...groups: unknown[]) => {
      const raw = replacement
        .replace(/\$(\d)/g, (_, i: string) => String(groups[Number(i) - 1] ?? ""))
        .toLowerCase();
      // ALL CAPS stays all caps; Title Case stays title case; the rest lowers.
      if (match.length > 1 && match === match.toUpperCase() && /[A-Z]/.test(match)) return raw.toUpperCase();
      if (/^[A-Z]/.test(match)) return raw.charAt(0).toUpperCase() + raw.slice(1);
      return raw;
    });
  }
  return out;
}

// Roles that have ended, written in the present tense, is the one document
// error that actively misleads a reader. Dan came off Delta's books on 30 June
// 2026 and the generator still wrote "At Delta, I own a $400M+ portfolio".
// The prompt now carries the dates, but a prompt rule is not a guarantee and
// the cost of it slipping through is a recruiter concluding he misrepresented
// his employment.
const PRESENT_TO_PAST: Record<string, string> = {
  own: "owned",
  owns: "owned",
  lead: "led",
  leads: "led",
  manage: "managed",
  manages: "managed",
  run: "ran",
  runs: "ran",
  direct: "directed",
  directs: "directed",
  oversee: "oversaw",
  oversees: "oversaw",
  build: "built",
  builds: "built",
  drive: "drove",
  drives: "drove",
  head: "headed",
  heads: "headed",
  report: "reported",
  reports: "reported",
  hold: "held",
  holds: "held",
};

/**
 * Rewrites present-tense first-person verbs to past tense, but only inside a
 * sentence that names an employer he has left. Sentence-scoped on purpose: a
 * present-tense verb about the target employer ("this role owns the roadmap")
 * is correct and must survive.
 */
export function pastTenseFinishedRoles(text: string, finishedEmployers: string[]): string {
  if (finishedEmployers.length === 0) return text;
  const namePattern = new RegExp(finishedEmployers.map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");

  // Split by LINE, not by paragraph, and rejoin on the same break.
  //
  // Splitting straight to sentences swallowed the newlines and flattened every
  // cover letter into one block. Splitting by paragraph fixed the letters and
  // left the resume broken in a way nobody noticed for a while: a role block is
  // several newline-separated lines inside a single paragraph, so every bullet
  // in it was sentence-split and rejoined with a space. A whole company's
  // bullets came out as one run-on line with the nested job title buried
  // mid-sentence. Rewriting tense inside a line is fine; merging lines never is.
  return text
    .split("\n")
    .map((line) => rewriteSentences(line, namePattern))
    .join("\n");
}

function rewriteSentences(paragraph: string, namePattern: RegExp): string {
  return paragraph
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => {
      if (!namePattern.test(sentence)) return sentence;
      let out = sentence.replace(
        /\bI(?:'m| am)\s+currently\s+(\w+ing)\b/gi,
        (_m, verb: string) => `I ${PRESENT_TO_PAST[verb.replace(/ing$/, "")] ?? verb.replace(/ing$/, "ed")}`
      );
      out = out.replace(/\bI\s+(own|owns|lead|leads|manage|manages|run|runs|direct|directs|oversee|oversees|build|builds|drive|drives|head|heads|report|reports|hold|holds)\b/gi, (m, verb: string) => {
        const past = PRESENT_TO_PAST[verb.toLowerCase()];
        return past ? m.replace(verb, past) : m;
      });
      return out;
    })
    .join(" ");
}

// A paragraph that opens by flagging his own weakness reads as a man talking
// himself out of the job. The prompt forbids these, but the model kept finding
// new phrasings for the same move, so the openers are stripped here too.
const SELF_DEPRECATING_OPENERS: RegExp[] = [
  // Bounded deliberately. An unbounded [^,.:]* ran all the way to the sentence's
  // own full stop and deleted the content it was meant to be introducing.
  /^Where I (?:would|want|need)[^.:!?]{0,60}[.:]\s+/i,
  /^I (?:should|want to|need to) be (?:fully )?(?:upfront|honest|candid|direct)(?: with you)? (?:that|about this)[,:]?\s+/i,
  /^To be (?:fully )?(?:honest|candid|direct)(?: with you)?[,:]\s+/i,
  /^In (?:the interest of|fairness|all candour|all candor)[^.:!?]{0,40}[,.:]\s+/i,
  /^I want to be (?:honest|candid|direct)[^.:!?]{0,40}[.:]\s+/i,
];

/** Removes an apologetic preamble from the start of any paragraph. */
export function stripSelfDeprecatingOpeners(text: string): string {
  return text
    .split(/\n\n/)
    .map((paragraph) => {
      for (const opener of SELF_DEPRECATING_OPENERS) {
        const stripped = paragraph.replace(opener, "").trim();
        // Never strip down to nothing: the preamble is only a preamble if real
        // content follows it.
        if (stripped !== paragraph.trim() && stripped.length > 30) {
          return stripped.charAt(0).toUpperCase() + stripped.slice(1);
        }
      }
      return paragraph;
    })
    .join("\n\n");
}

/**
 * The house language rules, applied rather than asked for.
 *
 * "No em-dashes or en-dashes" and "US spelling" have been in the prompts from
 * the start and both still leaked: toUSSpelling ran in exactly one route, and
 * nothing removed a literal em-dash from model output at all. A rule stated in
 * a prompt is a request; this is the enforcement, and it belongs on every path
 * that produces prose Dan sends to someone.
 *
 * Sentences ending in a preposition are deliberately NOT rewritten here. That
 * needs judgement about the whole clause, and a mechanical fix would produce
 * worse sentences than the ones it repaired. It stays a prompt rule and a
 * review finding.
 */
export function enforceHouseLanguage(text: string, protect: readonly string[] = []): string {
  /**
   * Names are not spelled wrong, they are spelled how they are spelled.
   *
   * The normalizer rewrites any word it recognises, and it cannot tell Dan's
   * prose from an employer's name. `\bcentre\b` does not know that "Guest
   * Experience Centre" is what a Canadian employer in the pipeline calls its
   * department, and that they were interviewing at the time. Renaming a company
   * inside a letter addressed to that company is worse than any spelling it
   * would fix.
   *
   * Masked before the pass and restored after, rather than trying to make the
   * patterns name-aware: the list of names is knowable at the call site and the
   * patterns cannot be.
   *
   * Longest first, so a multi-word employer name is masked whole rather than
   * being half-consumed by a shorter entry that overlaps it.
   */
  const terms = [...protect].filter((t) => t.trim().length > 2).sort((a, b) => b.length - a.length);
  const held: string[] = [];
  let masked = text;
  for (const term of terms) {
    const pattern = new RegExp(escapeRegex(term), "gi");
    masked = masked.replace(pattern, (hit) => {
      held.push(hit);
      // A control character no prose contains, so no rule can match inside it.
      return `\u0000${held.length - 1}\u0000`;
    });
  }

  const cleaned = applyHouseLanguage(masked);
  return cleaned.replace(/\u0000(\d+)\u0000/g, (_, i) => held[Number(i)] ?? "");
}

/** Escapes a literal for use inside a RegExp. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function applyHouseLanguage(text: string): string {
  return toUSSpelling(text)
    // An em-dash between clauses becomes a plain hyphen with spaces, which is
    // what the rest of this codebase already writes.
    .replace(/\s*—\s*/g, " - ")
    // An en-dash in a range is a hyphen with no spaces: "2013-2022", not
    // "2013 - 2022", which is how every date line here is written.
    .replace(/(\d)\s*–\s*(\d)/g, "$1-$2")
    .replace(/\s*–\s*/g, " - ");
}
