/**
 * Finds the LinkedIn posting behind roles that have no usable job description.
 *
 * 58 of 88 applications have none, which means their evaluations were made on a
 * title alone. Most of that is archive; the ones worth the calls are the live
 * statuses, so those are the default.
 *
 * Conservative on purpose, for the same reason scripts/link-drive.ts is. A
 * search for one real JPMorgan role returned four different jobs at the same
 * employer ranked above the right one. A wrong job description is worse than
 * none: it is invisible once attached, and it produces a confident, correctly
 * formatted resume for a role nobody read. So only an exact normalised title at
 * the matching employer is written automatically. Everything else is reported
 * for a person to settle in the app, where the candidates can be seen.
 *
 * Run: npx tsx --env-file=.env.local scripts/match-linkedin.ts [--apply] [--all] [--limit N]
 */
import { prisma } from "../src/lib/prisma";
import { searchLinkedInJobs, fetchLinkedInPosting, canonicalLinkedInUrl } from "../src/lib/linkedin";
import { persistJobDescriptionDocument } from "../src/lib/job-description";

const APPLY = process.argv.includes("--apply");
const ALL = process.argv.includes("--all");
const limitArg = process.argv.indexOf("--limit");
const LIMIT = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity;

const LIVE = ["LIVE_POSTING_FOUND", "APPLIED", "INTERVIEWING", "VERIFY", "OFFER"];

// One request at a time with a pause between. This is a handful of lookups on
// Dan's own shortlist, run by hand; it should look like a person reading job
// ads, because that is what it is.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const apps = await prisma.jobApplication.findMany({
    where: { deletedAt: null, ...(ALL ? {} : { status: { in: LIVE } }) },
    include: { company: true, jobDescriptions: { orderBy: { pastedAt: "desc" }, take: 1 } },
    orderBy: { updatedAt: "desc" },
  });

  const needing = apps
    .filter((a) => (a.jobDescriptions[0]?.rawText ?? "").trim().length < 400)
    .slice(0, LIMIT);

  console.log(`${needing.length} roles with no usable job description${ALL ? "" : " (live statuses only)"}\n`);

  const confident: string[] = [];
  const review: string[] = [];
  const nothing: string[] = [];

  for (const [i, app] of needing.entries()) {
    const label = `${app.company.name} - ${app.roleTitle.slice(0, 44)}`;
    process.stdout.write(`[${i + 1}/${needing.length}] ${label}\n`);

    const candidates = await searchLinkedInJobs(app.roleTitle, app.company.name);
    await sleep(1200);

    if (candidates.length === 0) {
      nothing.push(`${label} - nothing came back, the posting has probably closed`);
      continue;
    }

    const best = candidates[0];
    if (best.exact) {
      confident.push(`${label}\n      -> ${best.title} (${best.company})  ${best.url}`);
      if (APPLY) {
        const posting = await fetchLinkedInPosting(best.jobId);
        if (posting?.description.trim()) {
          await persistJobDescriptionDocument(app.id, posting.description);
          await prisma.jobApplication.update({
            where: { id: app.id },
            data: {
              postingLink: posting.applyUrl ?? canonicalLinkedInUrl(posting.jobId),
              lastCheckedAt: new Date(),
            },
          });
          console.log(`      written (${posting.description.length} chars)`);
        } else {
          console.log("      exact match but the posting would not read - left alone");
        }
        await sleep(1200);
      }
      continue;
    }

    review.push(
      `${label}\n` +
        candidates
          .slice(0, 3)
          .map((c) => `      ${Math.round(c.score * 100)}%  ${c.title} (${c.company})  ${c.url}`)
          .join("\n")
    );
  }

  const section = (title: string, rows: string[]) => {
    if (rows.length === 0) return;
    console.log("\n" + "=".repeat(60));
    console.log(title);
    for (const r of rows) console.log("  " + r);
  };

  section(
    APPLY ? "Exact title at the right employer - written:" : "Exact title at the right employer - would be written:",
    confident
  );
  section("Needs your call. Settle these in the app, where you can see them:", review);
  section("Nothing found:", nothing);

  console.log("\n" + "=".repeat(60));
  console.log(`confident: ${confident.length}   needs a decision: ${review.length}   nothing: ${nothing.length}`);
  if (!APPLY) console.log("dry run - nothing written. Re-run with --apply.");
  process.exit(0);
}

main();
