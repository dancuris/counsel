import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { searchLinkedInJobs } from "@/lib/linkedin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Finds candidate LinkedIn postings for a role already in the pipeline.
 *
 * Returns the whole ranked list rather than picking. The top hit for a real
 * JPMorgan role was, before ranking, a different job at the same employer -
 * four of them were - so the choice belongs to a person. `suggested` marks the
 * one worth defaulting to, and `exact` says whether it is safe to take without
 * looking.
 */
export async function GET(request: NextRequest) {
  const applicationId = request.nextUrl.searchParams.get("applicationId");
  if (!applicationId) return NextResponse.json({ error: "applicationId is required." }, { status: 400 });

  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { company: true },
  });
  if (!application) return NextResponse.json({ error: "Application not found." }, { status: 404 });

  const candidates = await searchLinkedInJobs(application.roleTitle, application.company.name);
  return NextResponse.json({
    roleTitle: application.roleTitle,
    company: application.company.name,
    candidates,
    suggested: candidates[0]?.score >= 0.5 ? candidates[0].jobId : null,
  });
}
