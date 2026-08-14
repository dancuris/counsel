import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { discoverBoard, searchBoard, rankPostings, type BoardRef, type Provider } from "@/lib/job-boards";

export const maxDuration = 120;

const PROVIDERS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workday"];

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = typeof body?.applicationId === "string" ? body.applicationId : "";
  if (!applicationId) return NextResponse.json({ error: "applicationId is required." }, { status: 400 });

  const application = await prisma.jobApplication.findUnique({
    where: { id: applicationId },
    include: { company: true },
  });
  if (!application || application.deletedAt) {
    return NextResponse.json({ error: "Application not found." }, { status: 404 });
  }

  const { company } = application;

  // Discovery is several network round trips, and the answer effectively never
  // changes, so it is cached on the company after the first successful find.
  let board: BoardRef | null =
    company.atsProvider && company.atsBoardUrl && PROVIDERS.includes(company.atsProvider)
      ? { provider: company.atsProvider as Provider, boardUrl: company.atsBoardUrl }
      : null;

  if (!board || body?.rediscover) {
    const found = await discoverBoard(company.name);
    board = found.board;
    if (board) {
      await prisma.company.update({
        where: { id: company.id },
        data: { atsProvider: board.provider, atsBoardUrl: board.boardUrl, atsCheckedAt: new Date() },
      });
    } else {
      await prisma.company.update({ where: { id: company.id }, data: { atsCheckedAt: new Date() } });
      // A verified careers URL is still worth returning. Most large employers
      // now run a client-rendered portal with no public board, and a link to
      // the right page beats reporting nothing at all.
      return NextResponse.json({
        board: null,
        postings: [],
        careersUrl: found.careersUrl ?? null,
        message: found.platform
          ? `${company.name} posts through ${found.platform}, which has no public board to search. Their careers site is linked below.`
          : found.careersUrl
            ? `No searchable board for ${company.name} - their careers site renders postings in the browser. Linked below.`
            : `Couldn't find a job board for ${company.name}.`,
      });
    }
  }

  const postings = await searchBoard(board, application.roleTitle);
  const ranked = rankPostings(postings, application.roleTitle);

  return NextResponse.json({
    board,
    scanned: postings.length,
    postings: ranked,
    message: ranked.length
      ? null
      : `Found ${company.name}'s ${board.provider} board but no posting matching "${application.roleTitle}". It may have closed.`,
  });
}

/** Records the chosen posting as this application's canonical link. */
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const applicationId = typeof body?.applicationId === "string" ? body.applicationId : "";
  const url = typeof body?.url === "string" ? body.url.trim() : "";
  if (!applicationId || !/^https:\/\//.test(url)) {
    return NextResponse.json({ error: "applicationId and an https url are required." }, { status: 400 });
  }

  await prisma.jobApplication.update({
    where: { id: applicationId },
    data: { postingLink: url, lastCheckedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
