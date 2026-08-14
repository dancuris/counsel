/**
 * Finds the real posting for every tracked application that has no job
 * description, saves it, and evaluates the fit.
 *
 * Most of the pipeline was inventoried from a spreadsheet, so 31 roles were
 * being carried with a company and a title and nothing else - which means they
 * could never be evaluated, and sat in Verify indefinitely.
 *
 * Deliberately conservative: it never overwrites an existing description, never
 * re-evaluates an application that already has a verdict, and runs one company
 * at a time. Board discovery is cached on the company by the resolver, so a
 * second role at the same employer is nearly free.
 *
 * Run: npx tsx --env-file=.env.local scripts/backfill-jds.ts [--limit N] [--dry]
 */
import { prisma } from "../src/lib/prisma";
import { discoverBoard, searchBoard, rankPostings, fetchPostingDetail, type BoardRef, type Provider } from "../src/lib/job-boards";

const PROVIDERS = ["greenhouse", "lever", "ashby", "smartrecruiters", "workday"];
const DRY = process.argv.includes("--dry");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;

async function evaluateApplication(applicationId: string): Promise<string | null> {
  const res = await fetch("http://localhost:3000/api/evaluate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `jst_session=${process.env.BACKFILL_SESSION ?? ""}`,
    },
    body: JSON.stringify({ applicationId }),
    signal: AbortSignal.timeout(180_000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { evaluation?: { recommendation?: string } } | null;
  return data?.evaluation?.recommendation ?? null;
}

async function main() {
  const apps = await prisma.jobApplication.findMany({
    where: { deletedAt: null, status: { not: "CLOSED_REJECTED" }, jobDescriptions: { none: {} } },
    include: { company: true },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  });

  const queue = apps.slice(0, LIMIT);
  console.log(`${queue.length} applications with no job description\n`);

  const tally = { found: 0, noBoard: 0, noMatch: 0, noDescription: 0, evaluated: 0 };
  const verdicts: Record<string, number> = {};

  for (const [i, app] of queue.entries()) {
    const label = `[${i + 1}/${queue.length}] ${app.company.name} - ${app.roleTitle.slice(0, 44)}`;

    let board: BoardRef | null =
      app.company.atsProvider && app.company.atsBoardUrl && PROVIDERS.includes(app.company.atsProvider)
        ? { provider: app.company.atsProvider as Provider, boardUrl: app.company.atsBoardUrl }
        : null;

    if (!board) {
      const found = await discoverBoard(app.company.name);
      board = found.board;
      if (!DRY) {
        await prisma.company.update({
          where: { id: app.companyId },
          data: board
            ? { atsProvider: board.provider, atsBoardUrl: board.boardUrl, atsCheckedAt: new Date() }
            : { atsCheckedAt: new Date() },
        });
      }
      if (!board) {
        tally.noBoard += 1;
        console.log(`${label}\n    no board${found.platform ? ` (${found.platform})` : ""}`);
        continue;
      }
    }

    const ranked = rankPostings(await searchBoard(board, app.roleTitle), app.roleTitle);
    if (ranked.length === 0) {
      tally.noMatch += 1;
      console.log(`${label}\n    ${board.provider}: no posting matching this title (likely closed)`);
      continue;
    }

    const description = await fetchPostingDetail(board, ranked[0]);
    if (!description || description.length < 400) {
      tally.noDescription += 1;
      console.log(`${label}\n    ${board.provider}: matched "${ranked[0].title}" but no readable description`);
      continue;
    }

    tally.found += 1;
    console.log(`${label}\n    ${board.provider}: "${ranked[0].title}" - ${description.split(/\s+/).length} words`);

    if (DRY) continue;

    await prisma.jobDescription.create({ data: { applicationId: app.id, rawText: description } });
    await prisma.jobApplication.update({
      where: { id: app.id },
      data: { postingLink: ranked[0].url, lastCheckedAt: new Date() },
    });

    const verdict = await evaluateApplication(app.id);
    if (verdict) {
      tally.evaluated += 1;
      verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
      console.log(`    evaluated: ${verdict.toUpperCase()}`);
    } else {
      console.log(`    evaluation failed (the description is saved, so it can be retried)`);
    }
  }

  console.log("\n" + "=".repeat(52));
  console.log(`descriptions found : ${tally.found}`);
  console.log(`evaluated          : ${tally.evaluated}  ${JSON.stringify(verdicts)}`);
  console.log(`no board           : ${tally.noBoard}`);
  console.log(`no matching posting: ${tally.noMatch}`);
  console.log(`no description     : ${tally.noDescription}`);
  process.exit(0);
}

main();
