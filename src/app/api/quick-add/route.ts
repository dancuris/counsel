import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getClaudeErrorMessage } from "@/lib/anthropic";
import { persistJobDescriptionDocument } from "@/lib/job-description";
import { cleanInlineText } from "@/lib/text";
import { generateStructured } from "@/lib/ai";

export const maxDuration = 300;

const EXTRACT_TOOL = {
  name: "submit_extraction",
  description: "Submit the employer name and role title found in this job posting.",
  input_schema: {
    type: "object" as const,
    properties: {
      companyName: {
        type: "string",
        description: "The actual hiring company. If this posting came through a staffing/recruiting agency, name the employer being staffed for, not the agency, if it's determinable.",
      },
      roleTitle: { type: "string", description: "The job title as posted." },
      salaryRange: { type: "string", description: "Salary range as stated in the posting, if any. Empty string if not stated." },
    },
    required: ["companyName", "roleTitle", "salaryRange"],
  },
};

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const jobDescription = body?.jobDescription;
  if (typeof jobDescription !== "string" || !jobDescription.trim()) {
    return NextResponse.json({ error: "Paste a job description first." }, { status: 400 });
  }

  let message;
  try {
    message = await generateStructured<Record<string, unknown>>({
      model: body?.model,
      maxTokens: 300,
      toolName: "submit_extraction",
      schema: EXTRACT_TOOL.input_schema as unknown as Record<string, unknown>,
      system: "Extract the employer name and role title from this job posting text.",
      user: jobDescription,
    });
  } catch (e) {
    return NextResponse.json({ error: getClaudeErrorMessage(e) }, { status: 502 });
  }

  const input = message.data as unknown as { companyName: string; roleTitle: string; salaryRange?: string };
  // Whatever markup was in the paste comes back through the extraction, so the
  // fields are cleaned before they are stored rather than on the way out.
  const companyName = cleanInlineText(input.companyName);
  const roleTitle = cleanInlineText(input.roleTitle);
  if (!companyName || !roleTitle) {
    return NextResponse.json({ error: "Could not read the company/role from that posting." }, { status: 502 });
  }

  // SQLite has no reliable case-insensitive `equals` filter, and the
  // company list is small, so compare in memory rather than reaching for
  // Postgres-only query options that wouldn't also work locally.
  const existingCompanies = await prisma.company.findMany({ select: { id: true, name: true } });
  const match = existingCompanies.find((c) => c.name.toLowerCase() === companyName.toLowerCase());
  const company = match
    ? match
    : await prisma.company.create({ data: { name: companyName } });

  const application = await prisma.jobApplication.create({
    data: {
      companyId: company.id,
      roleTitle,
      status: "LIVE_POSTING_FOUND",
      salaryRange: cleanInlineText(input.salaryRange) || null,
    },
  });

  await persistJobDescriptionDocument(application.id, jobDescription);

  return NextResponse.json({ applicationId: application.id });
}
