import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage, cachedSystem } from "@/lib/anthropic";
import { generateStructured } from "@/lib/ai";
import { buildProfileContext } from "@/lib/profile-context";
import { formatDateTime } from "@/lib/format";
import { syncDocumentToDriveQuietly } from "@/lib/google-drive";

// Prep docs are long, so this can run well past the default serverless
// window; the model call is streamed for the same reason.
export const maxDuration = 300;

const PREP_TOOL = {
  name: "submit_interview_prep",
  description: "Submit a structured interview prep package for this specific role.",
  // strict mode makes the API enforce this schema. Without it the model can
  // return a field in the wrong shape entirely (it once returned focusAreas
  // as one long string rather than an array of objects).
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      roleSnapshot: {
        type: "string",
        description:
          "3-5 sentences: what this role actually is, who it reports to, what they are really hiring for, and which of the candidate's two lanes it sits in.",
      },
      companyBrief: {
        type: "string",
        description:
          "3-6 sentences of business context on the company relevant to this role. Only state things supported by the job description or widely-known general background. Do not invent financials, headcounts, or recent events.",
      },
      positioningAngle: {
        type: "string",
        description:
          "How the candidate should frame himself for THIS role specifically, including the single strongest through-line to lead with and any framing traps to avoid.",
      },
      focusAreas: {
        type: "array",
        description: "The 4-7 areas this interview will most likely dig into.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            area: { type: "string" },
            whyItMatters: { type: "string", description: "One or two sentences on why they will probe here." },
            preparedAnswer: {
              type: "string",
              description:
                "The answer the candidate should actually give, in his own plain voice, first person, ready to say out loud. Use only verified metrics.",
            },
            likelyFollowUps: { type: "array", items: { type: "string" } },
          },
          required: ["area", "whyItMatters", "preparedAnswer", "likelyFollowUps"],
        },
      },
      toughQuestions: {
        type: "array",
        description: "The hardest questions or objections for this specific role, and how to handle each honestly.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            question: { type: "string" },
            howToHandle: { type: "string" },
          },
          required: ["question", "howToHandle"],
        },
      },
      starStories: {
        type: "array",
        description: "3-5 STAR stories from the candidate's real background, chosen for this role.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string" },
            situation: { type: "string" },
            action: { type: "string" },
            result: { type: "string" },
          },
          required: ["title", "situation", "action", "result"],
        },
      },
      questionsToAsk: {
        type: "array",
        description: "6-10 sharp questions for the candidate to ask them, specific to this role and company.",
        items: { type: "string" },
      },
    },
    required: [
      "roleSnapshot",
      "companyBrief",
      "positioningAngle",
      "focusAreas",
      "toughQuestions",
      "starStories",
      "questionsToAsk",
    ],
  },
};

type PrepInput = {
  roleSnapshot: string;
  companyBrief: string;
  positioningAngle: string;
  focusAreas: { area: string; whyItMatters: string; preparedAnswer: string; likelyFollowUps: string[] }[];
  toughQuestions: { question: string; howToHandle: string }[];
  starStories: { title: string; situation: string; action: string; result: string }[];
  questionsToAsk: string[];
};

// Never trust the shape of tool output. Iterating a value that turned out to
// be a string rather than an array walks it character by character, which is
// how a 318,000-character prep document full of "undefined" once got saved.
function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// Flattens the structured prep into the shared markdown-lite contract
// (## headings, - bullets) so it renders through the same docx/pdf path as
// every other Document.
function buildPrepContent(input: PrepInput, companyName: string, roleTitle: string): string {
  const out: string[] = [];
  out.push(`## ${companyName} - ${roleTitle}`);
  out.push("Interview prep");
  out.push("");

  out.push("## Role snapshot");
  out.push(asText(input.roleSnapshot));
  out.push("");

  out.push("## Company brief");
  out.push(asText(input.companyBrief));
  out.push("");

  out.push("## How to position yourself");
  out.push(asText(input.positioningAngle));
  out.push("");

  out.push("## Focus areas");
  for (const area of asList<PrepInput["focusAreas"][number]>(input.focusAreas)) {
    out.push(`## ${asText(area?.area)}`);
    out.push(`Why they will probe here: ${asText(area?.whyItMatters)}`);
    out.push("");
    out.push(asText(area?.preparedAnswer));
    const followUps = asList<string>(area?.likelyFollowUps);
    if (followUps.length) {
      out.push("");
      out.push("Likely follow-ups:");
      for (const f of followUps) out.push(`- ${asText(f)}`);
    }
    out.push("");
  }

  out.push("## Tough questions and objections");
  for (const q of asList<PrepInput["toughQuestions"][number]>(input.toughQuestions)) {
    out.push(asText(q?.question));
    out.push(`- ${asText(q?.howToHandle)}`);
    out.push("");
  }

  out.push("## STAR stories");
  for (const s of asList<PrepInput["starStories"][number]>(input.starStories)) {
    out.push(asText(s?.title));
    out.push(`- Situation: ${asText(s?.situation)}`);
    out.push(`- Action: ${asText(s?.action)}`);
    out.push(`- Result: ${asText(s?.result)}`);
    out.push("");
  }

  out.push("## Questions to ask them");
  for (const q of asList<string>(input.questionsToAsk)) out.push(`- ${asText(q)}`);

  return out.join("\n");
}

// Rejects a response that came back structurally wrong instead of persisting
// it. Saving garbage is worse than failing: the bad document then renders
// inline on the application page and has to be hunted down by hand.
function validatePrep(input: PrepInput): string | null {
  if (!asText(input?.roleSnapshot)) return "missing role snapshot";
  const areas = asList<PrepInput["focusAreas"][number]>(input?.focusAreas);
  if (!Array.isArray(input?.focusAreas)) return "focus areas came back in the wrong shape";
  if (areas.length === 0) return "no focus areas";
  if (areas.length > 20) return `an implausible ${areas.length} focus areas`;
  if (!areas.some((a) => asText(a?.area) && asText(a?.preparedAnswer))) return "focus areas were empty";
  return null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = body?.applicationId;
  if (typeof applicationId !== "string") {
    return NextResponse.json({ error: "applicationId is required." }, { status: 400 });
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: {
      company: true,
      jobDescriptions: { orderBy: { pastedAt: "desc" }, take: 1 },
      evaluations: { orderBy: { generatedAt: "desc" }, take: 1 },
      contacts: { orderBy: { createdAt: "desc" } },
      interviewNotes: { orderBy: { createdAt: "desc" }, include: { interviewers: true } },
    },
  });
  if (!application) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }
  const jd = application.jobDescriptions[0];
  if (!jd) {
    return NextResponse.json({ error: "Save a job description first." }, { status: 400 });
  }

  const profileContext = await buildProfileContext();
  const evaluation = application.evaluations[0];

  const contactLines = application.contacts
    .map((c) => `- ${c.name}${c.role ? ` (${c.role})` : ""}${c.notes ? ` - ${c.notes}` : ""}`)
    .join("\n");
  const roundLines = application.interviewNotes
    .map((n) => {
      const who = n.interviewers.map((i) => i.name).join(", ");
      return `- ${n.roundName}${n.date ? ` on ${formatDateTime(n.date)}` : ""}${who ? ` with ${who}` : ""}${
        n.notes ? `\n  Notes: ${n.notes}` : ""
      }`;
    })
    .join("\n");

  const userContent = [
    `Company: ${application.company.name}`,
    `Role: ${application.roleTitle}`,
    application.salaryRange ? `Stated comp: ${application.salaryRange}` : null,
    `\nJob description:\n${jd.rawText}`,
    evaluation
      ? `\nPrior fit evaluation (recommendation: ${evaluation.recommendation}):\n${evaluation.fitSummary}\nGaps identified: ${evaluation.gaps}`
      : null,
    contactLines ? `\nKnown contacts / likely interviewers:\n${contactLines}` : null,
    roundLines ? `\nInterview rounds already logged:\n${roundLines}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  /**
   * Through the provider router, not the Anthropic client directly.
   *
   * This route built its own client and ignored `providerFor` entirely, so
   * picking Gemini in the model dropdown changed the label and nothing else:
   * the request still went to Anthropic. Dan found it the way these are always
   * found, by switching to Gemini when the Claude balance ran out and getting
   * an Anthropic billing error back.
   *
   * Going through `generateStructured` also buys the fallback the wrapper
   * already had: when Claude is out of credit or rate limited it retries on
   * Gemini, which is the difference between a degraded app and a dead one two
   * hours before an interview.
   */
  let prepInput: PrepInput;
  try {
    const result = await generateStructured<PrepInput>({
      model: body?.model,
      maxTokens: 8000,
      toolName: "submit_interview_prep",
      schema: PREP_TOOL.input_schema as unknown as Record<string, unknown>,
      system: cachedSystem(profileContext, `You are preparing the candidate below for a real interview for the specific role given. This is a working document he will actually study and speak from, so be concrete and specific to this role, not generic interview advice.

Rules:
- Write prepared answers in his plain first-person voice, ready to say out loud. No em-dashes or en-dashes anywhere. No AI-sounding or over-eager phrasing. No preachy closing lines.
- Use ONLY the verified metrics listed in his positioning. Never infer, estimate, or invent any other number, and never attribute a company's public statistics to him personally.
- Be honest about gaps rather than papering over them. Where there is a real seam, give him the honest framing that addresses it directly.
- Do not invent facts about the company (financials, recent events, named executives) that are not in the job description. Where useful context is genuinely uncertain, say it should be confirmed with the recruiter.`),
      user: userContent,
    });
    prepInput = result.data;
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }

  const problem = validatePrep(prepInput);
  if (problem) {
    return NextResponse.json(
      { error: `Claude returned a malformed prep package (${problem}). Nothing was saved, try again.` },
      { status: 502 }
    );
  }

  const content = buildPrepContent(prepInput, application.company.name, application.roleTitle);

  const doc = await prisma.document.create({
    data: { applicationId: application.id, type: "interview_prep", content, isAtsSafe: false },
  });

  const drive = await syncDocumentToDriveQuietly(doc.id);

  return NextResponse.json({ document: doc, drive });
}
