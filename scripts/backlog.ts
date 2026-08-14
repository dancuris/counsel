/**
 * What has been asked for and said yes to.
 *
 *   npx tsx --env-file=.env.local scripts/backlog.ts
 *
 * This is the read side of the feature-request loop. Somebody on an instance
 * asks for something, it arrives on the operator's deployment, and approving it
 * there is supposed to turn into work here. Without this script that last step
 * depends on Dan remembering to mention it, which is the failure mode CLAUDE.md
 * already names about the story gate: a habit that depends on remembering is
 * not a habit.
 *
 * It works at all because this machine's `.env.local` points at the production
 * database, so there is no export, no API and nothing to keep in sync.
 */

import { prisma } from "@/lib/prisma";
import { ACTIVE_STATUSES } from "@/lib/requests";

function ago(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

async function main() {
  const [backlog, waiting] = await Promise.all([
    prisma.featureRequest.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      // Oldest first: the backlog is a queue, and the thing somebody has been
      // waiting longest for is the thing to do next.
      orderBy: { createdAt: "asc" },
    }),
    prisma.featureRequest.count({ where: { status: "new" } }),
  ]);

  if (backlog.length === 0) {
    console.log(waiting > 0 ? `\nNothing approved yet. ${waiting} waiting on a decision at /requests.\n` : "\nBacklog is empty.\n");
    await prisma.$disconnect();
    return;
  }

  console.log(`\n${backlog.length} approved or queued${waiting > 0 ? `, and ${waiting} still undecided at /requests` : ""}\n`);

  for (const request of backlog) {
    const who = request.requester ? `${request.requester} on ${request.instance}` : request.instance;
    console.log(`[${request.status}] ${request.title}`);
    console.log(`   asked by ${who}, ${ago(request.createdAt)}`);
    for (const line of request.body.split("\n")) {
      if (line.trim()) console.log(`   ${line.trim()}`);
    }
    console.log("");
  }

  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
