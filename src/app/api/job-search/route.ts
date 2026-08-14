import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage } from "@/lib/anthropic";
import { discoverBoard, searchBoard, rankPostings, fetchPostingDetail, type BoardRef, type Provider } from "@/lib/job-boards";
import { cleanInlineText } from "@/lib/text";
import { generateStructured } from "@/lib/ai";

export const maxDuration = 300;

/**
 * Paste what LinkedIn showed you - "VP, Owned & Operated Channels / GoTo Foods
 * Atlanta, GA" - and this finds the same req on the employer's own board and
 * brings back the full description.
 *
 * The point is to remove the copy-paste step entirely. LinkedIn truncates the
 * description and hides the requisition detail; the employer's board has both.
 */

const PROVIDERS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workday"];

const PARSE_TOOL = {
  name: "parse_listing",
  description: "Pull the employer and role out of a pasted job listing line.",
  strict: true,
  input_schema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      company: { type: "string", description: "Employer name only, no tagline or descriptor." },
      roleTitle: { type: "string", description: "The role title, cleaned of company and location." },
      location: { type: "string", description: "Location if stated, otherwise empty." },
    },
    required: ["company", "roleTitle", "location"],
  },
};

const asText = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const pasted = asText(body?.text);
  if (!pasted) return NextResponse.json({ error: "Paste a job title and company." }, { status: 400 });

  // A listing copied out of LinkedIn arrives as one blob with the company,
  // title, location and often a posting age all run together. Splitting it by
  // punctuation is unreliable; the model does it correctly.
  let company = "";
  let roleTitle = "";
  let location = "";
  try {
    const parsed = await generateStructured<Record<string, unknown>>({
      model: body?.model,
      maxTokens: 400,
      toolName: "parse_listing",
      schema: PARSE_TOOL.input_schema as unknown as Record<string, unknown>,
      system: "Extract the employer and role from a pasted job listing. Return the company name alone, without descriptors.",
      user: pasted,
    });
    {
      const inp = parsed.data;
      // Cleaned, not just trimmed: a listing copied out of a browser carries
      // entities and the odd stray tag, and these three are display fields.
      company = cleanInlineText(asText(inp.company));
      roleTitle = cleanInlineText(asText(inp.roleTitle));
      location = cleanInlineText(asText(inp.location));
    }
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }
  if (!company || !roleTitle) {
    return NextResponse.json({ error: "Couldn't read a company and role out of that." }, { status: 422 });
  }

  // Reuse a board already discovered for this employer.
  const existing = await prisma.company.findFirst({
    where: { name: { equals: company, mode: "insensitive" } },
  });
  let board: BoardRef | null =
    existing?.atsProvider && existing.atsBoardUrl && PROVIDERS.includes(existing.atsProvider)
      ? { provider: existing.atsProvider as Provider, boardUrl: existing.atsBoardUrl }
      : null;
  let careersUrl: string | undefined;
  let platform: string | undefined;

  if (!board) {
    const found = await discoverBoard(company);
    board = found.board;
    careersUrl = found.careersUrl;
    platform = found.platform;
    if (board && existing) {
      await prisma.company.update({
        where: { id: existing.id },
        data: { atsProvider: board.provider, atsBoardUrl: board.boardUrl, atsCheckedAt: new Date() },
      });
    }
  }

  if (!board) {
    return NextResponse.json({
      company,
      roleTitle,
      location,
      board: null,
      postings: [],
      careersUrl: careersUrl ?? null,
      message: platform
        ? `${company} posts through ${platform}, which has no public board to search.`
        : `No searchable board for ${company}.`,
    });
  }

  const all = await searchBoard(board, roleTitle);
  const ranked = rankPostings(all, roleTitle);

  // Fetch the description for the best match now rather than on a second click:
  // the whole point is that one paste produces something ready to evaluate.
  let description: string | null = null;
  if (ranked.length > 0) description = await fetchPostingDetail(board, ranked[0]);

  return NextResponse.json({
    company,
    roleTitle,
    location,
    board,
    scanned: all.length,
    postings: ranked,
    description,
    descriptionFor: ranked[0]?.url ?? null,
    message: ranked.length ? null : `Found ${company}'s ${board.provider} board but nothing matching "${roleTitle}".`,
  });
}

/** Creates the application from a chosen posting, JD included. */
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const company = cleanInlineText(asText(body?.company));
  const roleTitle = cleanInlineText(asText(body?.roleTitle));
  const url = asText(body?.url);
  const description = asText(body?.description);
  if (!company || !roleTitle) {
    return NextResponse.json({ error: "company and roleTitle are required." }, { status: 400 });
  }

  const co = await prisma.company.upsert({
    where: { name: company },
    update: {},
    create: { name: company, driveFolderName: company },
  });

  const duplicate = await prisma.jobApplication.findFirst({
    where: { companyId: co.id, roleTitle, deletedAt: null },
  });
  if (duplicate) return NextResponse.json({ applicationId: duplicate.id, duplicate: true });

  const application = await prisma.jobApplication.create({
    data: {
      companyId: co.id,
      roleTitle,
      status: "LIVE_POSTING_FOUND",
      postingLink: url || null,
      lastCheckedAt: new Date(),
    },
  });
  if (description) {
    await prisma.jobDescription.create({ data: { applicationId: application.id, rawText: description } });
  }

  return NextResponse.json({ applicationId: application.id, duplicate: false });
}
