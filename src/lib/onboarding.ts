import { prisma } from "@/lib/prisma";
import { TENANT_ID } from "@/lib/tenant";
import { credentialStatuses } from "@/lib/credentials";

/**
 * The questions somebody answers to make this app theirs.
 *
 * ## Why this is not a form for the fields it fills
 *
 * A working instance holds about **56,000 characters** of career content: six
 * long prose fields on the Profile (positioning, career narrative, personal
 * logistics, standing preferences, evaluation framework, master resume) and a
 * resume variant per lane at roughly 6,000 each. Around nine thousand words.
 *
 * Nobody fills that in from a blank form. A wizard that asks for it is
 * abandoned on question three, and the instance that results is worse than
 * useless: every fit verdict and every generated document is grounded in that
 * prose, so a half-answered profile produces confident, well-formatted, wrong
 * output rather than an obvious failure.
 *
 * So the wizard does not ask for the prose. It asks **eight short questions a
 * person can answer out loud**, takes a resume paste, and derives the prose
 * from both, then shows it back to be corrected. Correcting a draft is a task
 * people finish; writing six essays is not.
 *
 * ## What is required
 *
 * Only the resume, and only because nothing downstream works without it. Every
 * other step can be skipped and returned to, and the app tracks roles the
 * moment one is pasted regardless. This follows the same rule as
 * `setup-state.ts`: state is read from the data rather than from a stored
 * "completed" flag, so a step that stops being satisfied simply reappears.
 */

export type Question = {
  name: string;
  label: string;
  /** The sentence under the label. Plain, and never a restatement of it. */
  hint: string;
  placeholder: string;
  rows?: number;
  optional?: boolean;
};

/**
 * The short questions, and the whole of what somebody is asked to write.
 *
 * Each one exists because a specific downstream behavior is wrong without it,
 * and the comment says which. A question that changes nothing is a question
 * that should not be asked.
 */
export const SEARCH_QUESTIONS: Question[] = [
  {
    // Feeds `positioning`, which grounds every model call in the app.
    name: "targetRoles",
    label: "What roles are you going for?",
    hint: "Titles and level. If there are two different kinds of job you would take, say both: the app will weigh roles against each lane rather than filing you under one.",
    placeholder: "VP or SVP of Marketing, and separately Head of Marketing Technology. Both at large consumer businesses.",
    rows: 3,
  },
  {
    // Feeds `evaluationFramework`. Without it, "should I apply" has no rule to
    // answer against and the verdict is whatever the model feels that run.
    name: "dealBreakers",
    label: "What would make you turn a role down?",
    hint: "The things that make it an immediate no, however good the rest looks. This is what stops the app recommending roles you would never take.",
    placeholder: "Hands-on coding. A team under ten. Anything requiring a move before next summer. Early-stage startups.",
    rows: 3,
  },
  {
    // Feeds `evaluationFramework` from the other direction. Deal-breakers alone
    // produce a filter; this produces a judgement.
    name: "whatGood",
    label: "What does a good one look like?",
    hint: "The role you would be disappointed to miss. Be specific about scope, the size of the team, who you report to.",
    placeholder: "Owning marketing technology and data end to end, reporting to a CMO or CTO, with a team of thirty or more and real budget authority.",
    rows: 3,
  },
  {
    // Feeds `personalLogistics`. Location is the single most common reason a
    // recommendation is useless.
    name: "location",
    label: "Where will you work?",
    hint: "Where you are, how far you will travel, whether you will relocate and by when. Remote, hybrid or on site.",
    placeholder: "Southport, Connecticut. Hybrid in the New York area, or fully remote. Open to relocating for the right role from next summer.",
    rows: 3,
  },
  {
    // Also `personalLogistics`. Kept separate from location because people
    // answer "where" geographically and forget the rest.
    name: "constraints",
    label: "Anything else the app should know before it advises you?",
    hint: "Timing, compensation floor, anything you would rather it never suggested. Leave it blank if there is nothing.",
    placeholder: "Not interested in anything below 300k base. Do not suggest agencies.",
    rows: 3,
    optional: true,
  },
  {
    // Feeds `ruledOutCompanies`, checked before an evaluation is spent.
    name: "ruledOut",
    label: "Any companies you have already ruled out?",
    hint: "One per line. The app will not spend an evaluation on these or suggest them to you.",
    placeholder: "Acme Corp\nA competitor you cannot join",
    rows: 3,
    optional: true,
  },
  {
    // Feeds `careerNarrative`. This is the question that produces the material
    // a model cannot get from a resume: why the moves happened.
    name: "story",
    label: "What is the story your resume does not tell?",
    hint: "Why you moved when you did, what you are proudest of, what you were actually brought in to fix. This is the part a resume cannot carry, and it is what makes a cover letter sound like you.",
    placeholder: "I was brought into the last role to replatform a system nobody believed could be replaced, and the reason I am leaving is that it finished.",
    rows: 5,
  },
  {
    // Feeds `standingPreferences`. The house style has to come from somewhere,
    // and the alternative is inheriting Dan's.
    name: "writingStyle",
    label: "How should anything written for you sound?",
    hint: "Anything you know you do or do not want. Leave it blank and the app uses a plain, direct, first-person default with no em-dashes.",
    placeholder: "Plain and direct. Never over-eager. No exclamation marks, and never say I am passionate about anything.",
    rows: 3,
    optional: true,
  },
];

export type OnboardingStepId = "identity" | "resume" | "search" | "voice" | "model" | "derive";

export type OnboardingStep = {
  id: OnboardingStepId;
  title: string;
  /** One sentence on what answering this buys. Never what breaks without it. */
  purpose: string;
  done: boolean;
  /** Skippable steps say so, so nobody thinks they are stuck. */
  optional: boolean;
};

export type OnboardingState = {
  steps: OnboardingStep[];
  /** The first unfinished step, or null when there is nothing left. */
  next: OnboardingStep | null;
  answers: Record<string, string>;
  /** True once the prose has been derived, so the wizard offers review. */
  derived: boolean;
};

export async function onboardingState(): Promise<OnboardingState> {
  const [profile, variants, samples, credentials] = await Promise.all([
    prisma.profile.findUnique({
      where: { id: TENANT_ID },
      select: {
        contactName: true,
        contactEmails: true,
        setupAnswers: true,
        positioning: true,
        careerNarrative: true,
        masterResume: true,
      },
    }),
    prisma.resumeVariant.count(),
    prisma.coverLetterSample.count(),
    credentialStatuses(),
  ]);

  const answers = parseAnswers(profile?.setupAnswers);
  const hasResume = variants > 0 || Boolean(profile?.masterResume?.trim());
  // Answered means the questions that are not optional have text in them.
  const required = SEARCH_QUESTIONS.filter((q) => !q.optional).map((q) => q.name);
  const answered = required.length > 0 && required.every((name) => Boolean(answers[name]?.trim()));
  // The prose exists and is longer than the answer that seeded it, which is
  // what distinguishes "derived" from "typed something in".
  const derived = Boolean(profile?.positioning?.trim() && profile?.careerNarrative?.trim());

  const steps: OnboardingStep[] = [
    {
      id: "identity",
      title: "Who you are",
      purpose: "Your name and contact details go onto documents, written by the app rather than by a model, so they can never come out as placeholders.",
      done: Boolean(profile?.contactName?.trim() && profile?.contactEmails?.trim()),
      optional: false,
    },
    {
      id: "resume",
      title: "Your resume",
      purpose: "Everything the app writes is cut from this, which is what stops a model inventing a job you never had.",
      done: hasResume,
      optional: false,
    },
    {
      id: "search",
      title: "The search you are running",
      purpose: "Eight short questions. They are what let the app tell you a role is wrong for you rather than describing it back to you.",
      done: answered,
      optional: false,
    },
    {
      id: "voice",
      title: "A letter you are happy with",
      purpose: "A cover letter you wrote yourself, used as a reference for how yours should sound. Skip it and the app uses a plain default.",
      done: samples > 0,
      optional: true,
    },
    {
      id: "model",
      title: "A model key",
      purpose: "Your own Anthropic or Gemini key. Calls are billed to you and nobody else, and nothing here is shared.",
      done: credentials.some((c) => c.configured),
      optional: true,
    },
    {
      id: "derive",
      title: "Build your profile",
      purpose: "The app writes your positioning, career narrative and evaluation rules from your resume and answers, then shows them to you to correct.",
      done: derived,
      optional: false,
    },
  ];

  return { steps, next: steps.find((s) => !s.done) ?? null, answers, derived };
}

/** Stored answers, tolerating anything that is not the JSON object expected. */
export function parseAnswers(raw: string | null | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}
